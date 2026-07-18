import type { ProgramSpec } from '../types/index.ts';
import { buildAreaBudgets, InfeasibleProgrammeError } from './budget/areaBudget.ts';
import { createCorridorSpine } from './circulation/corridorSpine.ts';
import { placeDoors } from './doors/placeDoors.ts';
import { embedRooms, pickLayoutStyle, type LayoutStyle } from './embedding/embedRooms.ts';
import { computeSharedWalls } from './geometry/sharedWalls.ts';
import { buildPortalGraph, buildRoutes } from './graph/portalGraph.ts';
import { lexicoScores, optimizeValidPlan } from './optimize/validPlanOptimizer.ts';
import { DEFAULT_DESIGN_PREFS, type DesignPrefs } from './optimize/designPrefs.ts';
import {
  DEFAULT_METRIC_ORDER,
  type MetricKey,
  sortPlansByPriority,
} from './optimize/metrics.ts';
import { dedupePlans, geometricSimilarity } from './dedupe/planSignature.ts';
import { generateAccessTree } from './topology/generateAccessTrees.ts';
import { floorPlanToSolveProblem } from './toFloorGraph.ts';
import { validateFloorPlan } from './validate/validateFloorPlan.ts';
import type {
  DoorConfig,
  EntranceDirection,
  FloorPlan,
  ValidationResult,
} from './types.ts';
import { DEFAULT_DOOR_CONFIG } from './types.ts';
import type { SolveProblem } from '../types/index.ts';

export interface GenerateOptions {
  seeds?: number;
  retain?: number;
  optimizeIterations?: number;
  doorConfig?: DoorConfig;
  baseSeed?: number;
  /** Soft ranking priority (first = primary). Defaults to balanced lexico order. */
  metricPriority?: MetricKey[];
  /** User design preferences that parameterize soft scores. */
  designPrefs?: DesignPrefs;
}

export interface GenerateResult {
  plans: FloorPlan[];
  infeasible?: string;
  attempts: number;
  validCount: number;
}

/**
 * Topology-first multi-seed generator.
 * Only returns hard-validated plans.
 */
export function generateFloorPlanOptions(
  spec: ProgramSpec,
  outlineW: number,
  outlineH: number,
  entranceDir: EntranceDirection,
  options: GenerateOptions = {},
): GenerateResult {
  const seeds = options.seeds ?? 60;
  const retain = options.retain ?? 6;
  const optimizeIterations = options.optimizeIterations ?? 40;
  const doorConfig = options.doorConfig ?? DEFAULT_DOOR_CONFIG;
  const baseSeed = options.baseSeed ?? 42;
  const metricPriority = options.metricPriority?.length
    ? options.metricPriority
    : DEFAULT_METRIC_ORDER;
  const designPrefs = options.designPrefs ?? DEFAULT_DESIGN_PREFS;

  const valid: FloorPlan[] = [];
  let attempts = 0;
  let infeasible: string | undefined;

  const styles: LayoutStyle[] = [
    'classic', 'offset', 'livingFront', 'wetCluster', 'splitWings', 'gallery',
  ];

  for (let i = 0; i < seeds; i++) {
    attempts++;
    const seed = baseSeed + i * 9973;
    const style = styles[i % styles.length];
    try {
      const plan = generateOne(
        spec,
        outlineW,
        outlineH,
        entranceDir,
        seed,
        i % 5,
        doorConfig,
        style,
      );
      if (!plan) continue;
      if (!plan.validation.valid) continue;

      const optimized = optimizeValidPlan(plan, optimizeIterations, designPrefs);
      if (optimized.validation.valid) {
        const lex = lexicoScores(optimized, designPrefs);
        optimized.scores = {
          areaError: lex[0],
          daylight: lex[1],
          privacy: lex[2],
          corridorEfficiency: lex[3],
          wetClustering: lex[4],
          shapeQuality: lex[5],
          lexico: lex,
        };
        valid.push(optimized);
      }
    } catch (e) {
      if (e instanceof InfeasibleProgrammeError) {
        infeasible = e.message;
        return { plans: [], infeasible, attempts, validCount: 0 };
      }
    }
  }

  // Slightly looser geometric dedupe so creative variants survive
  const unique = dedupePlans(valid, 0.88);
  const ranked = sortPlansByPriority(unique, metricPriority);

  // Prefer a diverse retained set over the N most similar top scores
  const plans = pickDiversePlans(ranked, retain, metricPriority);

  return {
    plans,
    infeasible: plans.length === 0 ? infeasible ?? 'No valid layouts found for this programme' : undefined,
    attempts,
    validCount: valid.length,
  };
}

/** Greedy diverse pick: take best, then farthest from already picked. */
function pickDiversePlans(
  ranked: FloorPlan[],
  retain: number,
  metricPriority: MetricKey[],
): FloorPlan[] {
  if (ranked.length <= retain) return ranked;
  const picked: FloorPlan[] = [ranked[0]];
  const rest = ranked.slice(1);
  while (picked.length < retain && rest.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < rest.length; i++) {
      const minDist = Math.min(...picked.map(p => 1 - geometricSimilarity(p, rest[i])));
      // Mix diversity with quality rank (earlier in list = better)
      const quality = 1 - i / rest.length;
      const score = minDist * 0.75 + quality * 0.25;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    picked.push(rest.splice(bestIdx, 1)[0]);
  }
  return sortPlansByPriority(picked, metricPriority);
}

export function generateOne(
  spec: ProgramSpec,
  outlineW: number,
  outlineH: number,
  entranceDir: EntranceDirection,
  seed: number,
  variant: number,
  doorConfig: DoorConfig = DEFAULT_DOOR_CONFIG,
  layoutStyle?: LayoutStyle,
): FloorPlan | null {
  // Phase A: topology
  const topology = generateAccessTree(spec, seed, variant);

  // Area budget
  const budgets = buildAreaBudgets(topology, spec.totalAreaTarget);

  const entryId = topology.nodes.find(n => n.category === 'ENTRY')!.id;
  const foyerId = topology.nodes.find(n => n.category === 'FOYER')?.id ?? null;
  const corridorId = topology.nodes.find(n => n.category === 'CORRIDOR')!.id;

  const style = layoutStyle ?? pickLayoutStyle(seed, variant);

  // Phase B: circulation spine
  const { spine, entryRect, foyerRect, corridorRects } = createCorridorSpine({
    outlineW,
    outlineH,
    entranceDir,
    corridorId,
    entryId,
    foyerId,
    budgets,
    seed,
    shapeVariant: style === 'offset' ? 2 : style === 'gallery' ? 1 : variant,
  });

  // Phase C: embed with creative layout style
  const rooms = embedRooms({
    tree: topology,
    budgets,
    spine,
    entryRect,
    foyerRect,
    corridorRects,
    outlineW,
    outlineH,
    entranceDir,
    seed,
    layoutStyle: style,
  });

  // Phase D + E — tiling already encodes adjacencies; skip destructive repairs
  const sharedWalls = computeSharedWalls(rooms, doorConfig);
  const placed = placeDoors(topology, rooms, sharedWalls, entranceDir, outlineW, outlineH, doorConfig);

  // Phase F: portal graph
  const portalGraph = buildPortalGraph(rooms, placed.doors, spine);
  const routes = buildRoutes(rooms, placed.doors, portalGraph);

  // Phase G: validate
  const validation = validateFloorPlan({
    rooms,
    topology,
    budgets,
    sharedWalls,
    doors: placed.doors,
    routes,
    entrance: placed.entrance,
    outlineW,
    outlineH,
    missingTopologyEdges: placed.missingEdges,
  });

  const plan: FloorPlan = {
    rooms,
    topology,
    budgets,
    spine,
    sharedWalls,
    doors: placed.doors,
    portalGraph,
    routes,
    entrance: placed.entrance,
    validation,
    seed,
    outlineW,
    outlineH,
  };

  return plan;
}

/** Build a SolveProblem from the best (or first) valid plan — App compatibility. */
export function buildFromSpecTopologyFirst(
  spec: ProgramSpec,
  outlineW: number,
  outlineH: number,
  entranceDir: EntranceDirection = 'S',
  seed = 42,
): { problem: SolveProblem; plan: FloorPlan | null; validation: ValidationResult | null; error?: string } {
  try {
    const result = generateFloorPlanOptions(spec, outlineW, outlineH, entranceDir, {
      seeds: 24,
      retain: 1,
      baseSeed: seed,
      optimizeIterations: 40,
    });
    if (result.plans.length === 0) {
      // Fall through: try a single raw candidate for debug display
      const raw = generateOne(spec, outlineW, outlineH, entranceDir, seed, 0);
      if (raw) {
        return {
          problem: floorPlanToSolveProblem(raw),
          plan: raw,
          validation: raw.validation,
          error: result.infeasible,
        };
      }
      return {
        problem: emptyProblem(outlineW, outlineH),
        plan: null,
        validation: null,
        error: result.infeasible ?? 'Generation failed',
      };
    }
    const plan = result.plans[0];
    return {
      problem: floorPlanToSolveProblem(plan),
      plan,
      validation: plan.validation,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      problem: emptyProblem(outlineW, outlineH),
      plan: null,
      validation: null,
      error: msg,
    };
  }
}

function emptyProblem(outlineW: number, outlineH: number): SolveProblem {
  return {
    graph: { vertices: new Map(), edges: new Map(), faces: new Map() },
    constraints: [],
    outline: [
      { x: 0, y: 0 },
      { x: outlineW, y: 0 },
      { x: outlineW, y: outlineH },
      { x: 0, y: outlineH },
    ],
  };
}
