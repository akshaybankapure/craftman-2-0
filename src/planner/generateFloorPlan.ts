import type { ProgramSpec } from '../types/index.ts';
import { buildAreaBudgets, InfeasibleProgrammeError } from './budget/areaBudget.ts';
import { createCorridorSpine } from './circulation/corridorSpine.ts';
import { placeDoors } from './doors/placeDoors.ts';
import { embedRooms } from './embedding/embedRooms.ts';
import { computeSharedWalls } from './geometry/sharedWalls.ts';
import { buildPortalGraph, buildRoutes } from './graph/portalGraph.ts';
import { compareLexico, lexicoScores, optimizeValidPlan } from './optimize/validPlanOptimizer.ts';
import { dedupePlans } from './dedupe/planSignature.ts';
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
  const seeds = options.seeds ?? 40;
  const retain = options.retain ?? 6;
  const optimizeIterations = options.optimizeIterations ?? 60;
  const doorConfig = options.doorConfig ?? DEFAULT_DOOR_CONFIG;
  const baseSeed = options.baseSeed ?? 42;

  const valid: FloorPlan[] = [];
  let attempts = 0;
  let infeasible: string | undefined;

  for (let i = 0; i < seeds; i++) {
    attempts++;
    const seed = baseSeed + i * 9973;
    try {
      const plan = generateOne(
        spec,
        outlineW,
        outlineH,
        entranceDir,
        seed,
        i % 4,
        doorConfig,
      );
      if (!plan) continue;
      if (!plan.validation.valid) continue;

      const optimized = optimizeValidPlan(plan, optimizeIterations);
      if (optimized.validation.valid) {
        optimized.scores = {
          areaError: lexicoScores(optimized)[0],
          daylight: lexicoScores(optimized)[1],
          privacy: lexicoScores(optimized)[2],
          corridorEfficiency: lexicoScores(optimized)[3],
          wetClustering: lexicoScores(optimized)[4],
          shapeQuality: lexicoScores(optimized)[5],
          lexico: lexicoScores(optimized),
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

  const unique = dedupePlans(valid);
  unique.sort((a, b) =>
    compareLexico(a.scores?.lexico ?? lexicoScores(a), b.scores?.lexico ?? lexicoScores(b)),
  );

  return {
    plans: unique.slice(0, retain),
    infeasible: unique.length === 0 ? infeasible ?? 'No valid layouts found for this programme' : undefined,
    attempts,
    validCount: valid.length,
  };
}

export function generateOne(
  spec: ProgramSpec,
  outlineW: number,
  outlineH: number,
  entranceDir: EntranceDirection,
  seed: number,
  variant: number,
  doorConfig: DoorConfig = DEFAULT_DOOR_CONFIG,
): FloorPlan | null {
  // Phase A: topology
  const topology = generateAccessTree(spec, seed, variant);

  // Area budget
  const budgets = buildAreaBudgets(topology, spec.totalAreaTarget);

  const entryId = topology.nodes.find(n => n.category === 'ENTRY')!.id;
  const foyerId = topology.nodes.find(n => n.category === 'FOYER')?.id ?? null;
  const corridorId = topology.nodes.find(n => n.category === 'CORRIDOR')!.id;

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
    shapeVariant: variant,
  });

  // Phase C: embed rooms (structured; spine rects used as hints)
  void entryRect;
  void foyerRect;
  void corridorRects;
  let rooms = embedRooms({
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
