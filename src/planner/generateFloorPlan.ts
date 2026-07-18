import type { ProgramSpec } from '../types/index.ts';
import { resolveContextProfile, type ContextProfile } from '../engine/context/contextProfile.ts';
import { resolveCirculationDemand } from '../engine/circulation/demandModel.ts';
import { growPlanFromMission } from '../engine/geometry/growPlan.ts';
import { validateFurniture } from '../engine/furniture/templates.ts';
import {
  calculateLayoutFingerprint,
  fingerprintKey,
  fingerprintSimilarity,
  isNearDuplicate,
} from '../engine/search/fingerprint.ts';
import { runVirtualOccupantPlaytests } from '../engine/simulation/journeys.ts';
import { FamilyBandit } from '../engine/orchestrator/bandit.ts';
import {
  eligibleFamilies,
  generateMissionGraph,
  generateMissionGraphVariants,
} from '../engine/topology/missionFamilies.ts';
import { ALL_MISSION_FAMILIES, type MissionGraph } from '../engine/topology/missionTypes.ts';
import { missionGraphToAccessTree } from '../engine/topology/toAccessTree.ts';
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
import { geometricSimilarity } from './dedupe/planSignature.ts';
import { generateAccessTree } from './topology/generateAccessTrees.ts';
import { floorPlanToSolveProblem } from './toFloorGraph.ts';
import { validateFloorPlan } from './validate/validateFloorPlan.ts';
import type {
  AccessTree,
  DoorConfig,
  EntranceDirection,
  FloorPlan,
  ValidationResult,
} from './types.ts';
import { DEFAULT_DOOR_CONFIG } from './types.ts';
import type { SolveProblem } from '../types/index.ts';
import type { ResolvedStrategy } from './strategy/architecturalStrategy.ts';

export interface GenerateOptions {
  seeds?: number;
  retain?: number;
  optimizeIterations?: number;
  doorConfig?: DoorConfig;
  baseSeed?: number;
  metricPriority?: MetricKey[];
  metricWeights?: Record<MetricKey, number>;
  designPrefs?: DesignPrefs;
  /** Full architectural strategy — preferred over designPrefs alone. */
  strategy?: ResolvedStrategy;
  /** Region profile for demography-aware topology (default india). */
  region?: 'india' | 'generic';
}

export interface GenerateResult {
  plans: FloorPlan[];
  infeasible?: string;
  attempts: number;
  validCount: number;
}

/**
 * Multi-layer engine facade.
 * Mission-graph families → AccessTree → (legacy embed for now) → validate → QD filter.
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
  const metricWeights = options.metricWeights;
  const designPrefs = options.designPrefs ?? DEFAULT_DESIGN_PREFS;

  const bedrooms = countType(spec, 'bedroom');
  const bathrooms = countType(spec, 'bathroom') + countType(spec, 'ensuite');

  const ctx = resolveContextProfile({
    spec,
    bhk: bedrooms,
    carpetAreaM2: spec.totalAreaTarget,
    outlineW,
    outlineH,
    entranceDir,
    bathroomCount: Math.max(1, bathrooms),
    hasBalcony: countType(spec, 'balcony') > 0,
    hasUtility: countType(spec, 'utility') > 0,
    region: options.region ?? 'india',
    strategy: options.strategy,
  });

  const missionGraphs = generateMissionGraphVariants(ctx, baseSeed, 2);
  if (missionGraphs.length === 0) {
    return {
      plans: [],
      infeasible: 'No legal mission graphs for programme',
      attempts: 0,
      validCount: 0,
    };
  }

  const families = eligibleFamilies(ctx);
  const bandit = new FamilyBandit(families.length ? families : [...ALL_MISSION_FAMILIES]);
  const graphsByFamily = new Map<string, MissionGraph[]>();
  for (const g of missionGraphs) {
    const list = graphsByFamily.get(g.family) ?? [];
    list.push(g);
    graphsByFamily.set(g.family, list);
  }

  const styles: LayoutStyle[] = [
    'classic', 'offset', 'livingFront', 'wetCluster', 'splitWings', 'gallery',
  ];

  const valid: FloorPlan[] = [];
  let attempts = 0;
  let infeasible: string | undefined;

  for (let i = 0; i < seeds; i++) {
    attempts++;
    const seed = baseSeed + i * 9973;
    const family = bandit.select();
    let mission =
      graphsByFamily.get(family)?.[i % Math.max(1, graphsByFamily.get(family)?.length ?? 1)];
    if (!mission) {
      try {
        mission = generateMissionGraph(family, ctx, seed);
      } catch {
        bandit.record(family, false);
        continue;
      }
    }
    const style = styles[i % styles.length]!;
    try {
      const demand = resolveCirculationDemand(ctx, mission);
      const plan = generateOneFromMission(
        spec,
        outlineW,
        outlineH,
        entranceDir,
        seed,
        i % 5,
        doorConfig,
        style,
        mission,
        ctx,
      );
      if (!plan || !plan.validation.valid) {
        bandit.record(family, false);
        continue;
      }

      plan.debug = {
        ...(plan.debug ?? {}),
        circulationDemand: demand,
        contextReasoning: ctx.reasoning,
        missionFamily: mission.family,
        bandit: bandit.stats(),
      };

      const optimized = optimizeValidPlan(
        plan,
        optimizeIterations,
        designPrefs,
        metricPriority,
        metricWeights,
      );
      if (!optimized.validation.valid) {
        bandit.record(family, false);
        continue;
      }

      // Playability gates: hard for region-growth geometry; soft warnings on strip fallback
      // so the app stays runnable while growth yield improves.
      const strictPlayability = plan.debug?.geometryEngine === 'regionGrowth';
      const furniture = validateFurniture(optimized.rooms, ctx.tier);
      if (!furniture.valid && strictPlayability) {
        bandit.record(family, false);
        continue;
      }

      const playtest = runVirtualOccupantPlaytests(optimized);
      if (!playtest.criticalJourneysPass && strictPlayability) {
        bandit.record(family, false);
        continue;
      }

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
      optimized.missionGraph = mission;
      optimized.fingerprint = calculateLayoutFingerprint(optimized, mission.family);
      optimized.debug = {
        ...(plan.debug ?? {}),
        furnitureUsability: furniture.usabilityScore,
        journeys: playtest.journeys.map(j => ({ name: j.name, ok: j.reachable })),
        geometryEngine: plan.debug?.geometryEngine,
      };
      valid.push(optimized);
      bandit.record(family, true);
    } catch (e) {
      if (e instanceof InfeasibleProgrammeError) {
        infeasible = e.message;
        return { plans: [], infeasible, attempts, validCount: 0 };
      }
      bandit.record(family, false);
    }
  }

  const unique = dedupeByFingerprint(valid, 0.92);
  const ranked = sortPlansByPriority(unique, metricPriority, metricWeights);
  const plans = pickDiversePlans(ranked, retain, metricPriority, metricWeights);

  return {
    plans,
    infeasible:
      plans.length === 0
        ? infeasible ?? 'No valid layouts found for this programme'
        : undefined,
    attempts,
    validCount: valid.length,
  };
}

function dedupeByFingerprint(plans: FloorPlan[], threshold: number): FloorPlan[] {
  const out: FloorPlan[] = [];
  const keys = new Set<string>();
  for (const p of plans) {
    const fp = p.fingerprint ?? calculateLayoutFingerprint(p);
    const key = fingerprintKey(fp);
    if (keys.has(key)) continue;
    if (out.some(o => isNearDuplicate(fp, o.fingerprint ?? calculateLayoutFingerprint(o), threshold))) {
      continue;
    }
    keys.add(key);
    p.fingerprint = fp;
    out.push(p);
  }
  return out;
}

function pickDiversePlans(
  ranked: FloorPlan[],
  retain: number,
  metricPriority: MetricKey[],
  metricWeights?: Record<MetricKey, number>,
): FloorPlan[] {
  if (ranked.length <= retain) return ranked;
  const picked: FloorPlan[] = [ranked[0]!];
  const rest = ranked.slice(1);
  while (picked.length < retain && rest.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < rest.length; i++) {
      const candidate = rest[i]!;
      const fp = candidate.fingerprint ?? calculateLayoutFingerprint(candidate);
      const minDist = Math.min(
        ...picked.map(p => {
          const pf = p.fingerprint ?? calculateLayoutFingerprint(p);
          const fpDist = 1 - fingerprintSimilarity(fp, pf);
          const geoDist = 1 - geometricSimilarity(p, candidate);
          return Math.max(fpDist, geoDist * 0.5);
        }),
      );
      const quality = 1 - i / rest.length;
      const score = minDist * 0.8 + quality * 0.2;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    picked.push(rest.splice(bestIdx, 1)[0]!);
  }
  return sortPlansByPriority(picked, metricPriority, metricWeights);
}

export function generateOneFromMission(
  spec: ProgramSpec,
  outlineW: number,
  outlineH: number,
  entranceDir: EntranceDirection,
  seed: number,
  variant: number,
  doorConfig: DoorConfig,
  layoutStyle: LayoutStyle | undefined,
  mission: MissionGraph,
  ctx?: ContextProfile,
): FloorPlan | null {
  const topology = missionGraphToAccessTree(mission);
  const profile =
    ctx ??
    resolveContextProfile({
      spec,
      bhk: countType(spec, 'bedroom'),
      carpetAreaM2: spec.totalAreaTarget,
      outlineW,
      outlineH,
      entranceDir,
      bathroomCount: Math.max(1, countType(spec, 'bathroom') + countType(spec, 'ensuite')),
      region: 'india',
    });

  const plan = generateOneWithTopology(
    spec,
    outlineW,
    outlineH,
    entranceDir,
    seed,
    variant,
    doorConfig,
    layoutStyle,
    topology,
    mission,
    profile,
  );
  if (plan) {
    plan.missionGraph = mission;
    plan.fingerprint = calculateLayoutFingerprint(plan, mission.family);
  }
  return plan;
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
  const topology = generateAccessTree(spec, seed, variant);
  return generateOneWithTopology(
    spec,
    outlineW,
    outlineH,
    entranceDir,
    seed,
    variant,
    doorConfig,
    layoutStyle,
    topology,
  );
}

function generateOneWithTopology(
  spec: ProgramSpec,
  outlineW: number,
  outlineH: number,
  entranceDir: EntranceDirection,
  seed: number,
  variant: number,
  doorConfig: DoorConfig,
  layoutStyle: LayoutStyle | undefined,
  topology: AccessTree,
  mission?: MissionGraph,
  ctx?: ContextProfile,
): FloorPlan | null {
  const budgets = buildAreaBudgets(topology, spec.totalAreaTarget);
  const style = layoutStyle ?? pickLayoutStyle(seed, variant);

  let rooms: FloorPlan['rooms'] | null = null;
  let spine: FloorPlan['spine'] | null = null;
  let debug: Record<string, unknown> | undefined;

  // Prefer multi-layer growth when we have a mission + context
  let usedGrowth = false;
  if (mission && ctx) {
    const grown = growPlanFromMission({ ctx, mission, topology, budgets, seed });
    if (grown.ok) {
      rooms = grown.rooms;
      spine = grown.spine;
      debug = { ...(grown.debug ?? {}), geometryEngine: 'regionGrowth' };
      usedGrowth = true;
    }
  }

  if (!usedGrowth || !rooms || !spine) {
    const corridorNode = topology.nodes.find(n => n.category === 'CORRIDOR');
    if (!corridorNode) {
      return generateOne(spec, outlineW, outlineH, entranceDir, seed, variant, doorConfig, layoutStyle);
    }
    const entryId = topology.nodes.find(n => n.category === 'ENTRY')!.id;
    const foyerId = topology.nodes.find(n => n.category === 'FOYER')?.id ?? null;
    const built = createCorridorSpine({
      outlineW,
      outlineH,
      entranceDir,
      corridorId: corridorNode.id,
      entryId,
      foyerId,
      budgets,
      seed,
      shapeVariant: style === 'offset' ? 2 : style === 'gallery' ? 1 : variant,
    });
    spine = built.spine;
    rooms = embedRooms({
      tree: topology,
      budgets,
      spine: built.spine,
      entryRect: built.entryRect,
      foyerRect: built.foyerRect,
      corridorRects: built.corridorRects,
      outlineW,
      outlineH,
      entranceDir,
      seed,
      layoutStyle: style,
    });
    debug = { geometryEngine: 'embedRoomsFallback' };
    usedGrowth = false;
  }

  const sharedWalls = computeSharedWalls(rooms, doorConfig);
  const placed = placeDoors(topology, rooms, sharedWalls, entranceDir, outlineW, outlineH, doorConfig);

  const portalGraph = buildPortalGraph(rooms, placed.doors, spine);
  const routes = buildRoutes(rooms, placed.doors, portalGraph);

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

  // If growth produced invalid geometry, fall back to strip embed once
  if (!validation.valid && usedGrowth && mission && ctx) {
    return generateOneWithTopology(
      spec,
      outlineW,
      outlineH,
      entranceDir,
      seed,
      variant,
      doorConfig,
      layoutStyle,
      topology,
      undefined,
      undefined,
    );
  }

  return {
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
    debug,
  };
}

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
    const plan = result.plans[0]!;
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

function countType(spec: ProgramSpec, type: string): number {
  return spec.rooms.filter(r => r.type === type).reduce((s, r) => s + r.count, 0);
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
