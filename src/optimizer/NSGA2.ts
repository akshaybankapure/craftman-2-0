/**
 * NSGA-II (Non-dominated Sorting Genetic Algorithm II).
 *
 * WHAT IT OPTIMIZES (the key design decision):
 *   NSGA-II here does NOT generate geometry. It searches the space of SOLVER
 *   PARAMETERS — a real-valued genome of things like per-room area targets,
 *   adjacency stiffness, and orthogonality stiffness. Each candidate genome is
 *   decoded into a SolveProblem, the deterministic ConstraintSolver runs it to a
 *   feasible layout, and that layout is scored on the 4 objectives.
 *
 *   This separation is the whole point: "generate options" is the slow batch GA,
 *   "edit one option" is the instant solver. The GA can only ever produce
 *   FEASIBLE layouts because feasibility is guaranteed by the solver, not the GA.
 *
 * This is a faithful NSGA-II: fast non-dominated sort + crowding-distance
 * tournament selection + SBX crossover + polynomial mutation + elitist (mu+lambda)
 * survival. It runs in a Web Worker in the app so the UI never blocks.
 */

import type { ObjectiveScores } from '../types/index.ts';

export type Genome = number[]; // each gene in [0,1], decoded by the problem builder

export interface Individual {
  genome: Genome;
  objectives: number[]; // minimization
  rank: number;
  crowding: number;
}

export interface NSGAOptions {
  populationSize: number;
  generations: number;
  crossoverProb: number;
  mutationProb: number;
  /** SBX / polynomial-mutation distribution indices. */
  etaC: number;
  etaM: number;
  seed: number;
}

export const DEFAULT_NSGA_OPTIONS: NSGAOptions = {
  populationSize: 40,
  generations: 30,
  crossoverProb: 0.9,
  mutationProb: 0.15,
  etaC: 15,
  etaM: 20,
  seed: 1,
};

/** The host supplies how to decode a genome and evaluate it. Keeps the GA pure
 *  and independent of the floor-plan domain. */
export interface Evaluator {
  geneCount: number;
  evaluate: (genome: Genome) => ObjectiveScores;
}

// --- Deterministic PRNG (mulberry32) so runs are reproducible for demos -------
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dominates(a: number[], b: number[]): boolean {
  let better = false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] > b[i]) return false;
    if (a[i] < b[i]) better = true;
  }
  return better;
}

/** Deb's fast non-dominated sort. Returns fronts as arrays of population indices. */
function fastNonDominatedSort(pop: Individual[]): number[][] {
  const S: number[][] = pop.map(() => []);
  const n = new Array(pop.length).fill(0);
  const fronts: number[][] = [[]];

  for (let p = 0; p < pop.length; p++) {
    for (let q = 0; q < pop.length; q++) {
      if (p === q) continue;
      if (dominates(pop[p].objectives, pop[q].objectives)) S[p].push(q);
      else if (dominates(pop[q].objectives, pop[p].objectives)) n[p]++;
    }
    if (n[p] === 0) {
      pop[p].rank = 0;
      fronts[0].push(p);
    }
  }

  let i = 0;
  while (fronts[i].length > 0) {
    const next: number[] = [];
    for (const p of fronts[i]) {
      for (const q of S[p]) {
        n[q]--;
        if (n[q] === 0) {
          pop[q].rank = i + 1;
          next.push(q);
        }
      }
    }
    i++;
    fronts.push(next);
  }
  fronts.pop();
  return fronts;
}

/** Crowding distance within a front (preserves diversity along the Pareto front). */
function assignCrowding(pop: Individual[], front: number[]): void {
  const l = front.length;
  if (l === 0) return;
  for (const idx of front) pop[idx].crowding = 0;
  const m = pop[front[0]].objectives.length;
  for (let obj = 0; obj < m; obj++) {
    front.sort((a, b) => pop[a].objectives[obj] - pop[b].objectives[obj]);
    pop[front[0]].crowding = Infinity;
    pop[front[l - 1]].crowding = Infinity;
    const min = pop[front[0]].objectives[obj];
    const max = pop[front[l - 1]].objectives[obj];
    const range = max - min || 1;
    for (let k = 1; k < l - 1; k++) {
      pop[front[k]].crowding +=
        (pop[front[k + 1]].objectives[obj] -
          pop[front[k - 1]].objectives[obj]) /
        range;
    }
  }
}

export class NSGA2 {
  private opts: NSGAOptions;
  private evalr: Evaluator;
  private rand: () => number;

  constructor(evaluator: Evaluator, opts: NSGAOptions = DEFAULT_NSGA_OPTIONS) {
    this.evalr = evaluator;
    this.opts = opts;
    this.rand = mulberry32(opts.seed);
  }

  private newGenome(): Genome {
    return Array.from({ length: this.evalr.geneCount }, () => this.rand());
  }

  private makeIndividual(genome: Genome): Individual {
    const obj = this.evalr.evaluate(genome);
    return {
      genome,
      objectives: [
        obj.areaError,
        obj.circulation,
        obj.daylight,
        obj.structuralIrregularity,
      ],
      rank: 0,
      crowding: 0,
    };
  }

  /** Binary tournament on (rank, crowding). */
  private tournament(pop: Individual[]): Individual {
    const a = pop[Math.floor(this.rand() * pop.length)];
    const b = pop[Math.floor(this.rand() * pop.length)];
    if (a.rank !== b.rank) return a.rank < b.rank ? a : b;
    return a.crowding > b.crowding ? a : b;
  }

  /** Simulated Binary Crossover. */
  private sbx(p1: Genome, p2: Genome): [Genome, Genome] {
    const c1 = [...p1];
    const c2 = [...p2];
    if (this.rand() > this.opts.crossoverProb) return [c1, c2];
    for (let i = 0; i < p1.length; i++) {
      if (this.rand() > 0.5) continue;
      if (Math.abs(p1[i] - p2[i]) < 1e-9) continue;
      const u = this.rand();
      const beta =
        u <= 0.5
          ? Math.pow(2 * u, 1 / (this.opts.etaC + 1))
          : Math.pow(1 / (2 * (1 - u)), 1 / (this.opts.etaC + 1));
      c1[i] = clamp01(0.5 * ((1 + beta) * p1[i] + (1 - beta) * p2[i]));
      c2[i] = clamp01(0.5 * ((1 - beta) * p1[i] + (1 + beta) * p2[i]));
    }
    return [c1, c2];
  }

  /** Polynomial mutation. */
  private mutate(g: Genome): Genome {
    const out = [...g];
    for (let i = 0; i < out.length; i++) {
      if (this.rand() > this.opts.mutationProb) continue;
      const u = this.rand();
      const delta =
        u < 0.5
          ? Math.pow(2 * u, 1 / (this.opts.etaM + 1)) - 1
          : 1 - Math.pow(2 * (1 - u), 1 / (this.opts.etaM + 1));
      out[i] = clamp01(out[i] + delta);
    }
    return out;
  }

  /** Run the full evolution. Returns the final Pareto front (rank 0), each with
   *  its genome + objective scores, sorted for stable browsing. */
  run(onGeneration?: (gen: number, front: Individual[]) => void): Individual[] {
    let pop: Individual[] = Array.from({ length: this.opts.populationSize }, () =>
      this.makeIndividual(this.newGenome())
    );

    for (let gen = 0; gen < this.opts.generations; gen++) {
      // Offspring.
      const offspring: Individual[] = [];
      while (offspring.length < this.opts.populationSize) {
        const p1 = this.tournament(pop);
        const p2 = this.tournament(pop);
        const [c1, c2] = this.sbx(p1.genome, p2.genome);
        offspring.push(this.makeIndividual(this.mutate(c1)));
        if (offspring.length < this.opts.populationSize)
          offspring.push(this.makeIndividual(this.mutate(c2)));
      }

      // Elitist survival from combined parent+offspring (mu+lambda).
      const combined = [...pop, ...offspring];
      const fronts = fastNonDominatedSort(combined);
      const next: Individual[] = [];
      for (const front of fronts) {
        assignCrowding(combined, front);
        if (next.length + front.length <= this.opts.populationSize) {
          for (const idx of front) next.push(combined[idx]);
        } else {
          const remaining = this.opts.populationSize - next.length;
          front
            .sort((a, b) => combined[b].crowding - combined[a].crowding)
            .slice(0, remaining)
            .forEach((idx) => next.push(combined[idx]));
          break;
        }
      }
      pop = next;

      if (onGeneration) {
        const f0 = fastNonDominatedSort(pop)[0].map((i) => pop[i]);
        onGeneration(gen, f0);
      }
    }

    const finalFronts = fastNonDominatedSort(pop);
    return finalFronts[0]
      .map((i) => pop[i])
      .sort((a, b) => a.objectives[0] - b.objectives[0]);
  }
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
