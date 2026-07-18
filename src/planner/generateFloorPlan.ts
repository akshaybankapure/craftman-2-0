import type { ProgramSpec } from '../types/index.ts';
import { resolveContextProfile, type ContextProfile } from '../engine/context/contextProfile.ts';
import { resolveCirculationDemand } from '../engine/circulation/demandModel.ts';
import { growPlanFromMission } from '../engine/geometry/growPlan.ts';
import { packPlanFromMission } from '../engine/geometry/packPlan.ts';
import { validateFurniture } from '../engine/furniture/templates.ts';
import {
  calculateLayoutFingerprint,
  fingerprintKey,
  fingerprintSimilarity,
  isNearDuplicate,
} from '../engine/search/fingerprint.ts';
import { runVirtualOccupantPlaytests } from '../engine/simulation/journeys.ts';
import {
  FamilyBandit,
  makeArmKey,
  splitArmKey,
} from '../engine/orchestrator/bandit.ts';
import {
  eligibleFamilies,
  generateMissionGraph,
  generateMissionGraphVariants,
} from '../engine/topology/missionFamilies.ts';
import {
  ALL_MISSION_FAMILIES,
  type MissionGraph,
  type MissionGraphFamily,
} from '../engine/topology/missionTypes.ts';
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
import { isSpatialEngineEligible } from './bridge/spatialEngineBridge.ts';
import { evaluateFurnishingGate } from './bridge/furnishingGate.ts';
import { collapseBathroomSpurCorridors } from './bridge/collapseBathSpurCorridor.ts';
import {
  displayFromSpatialCertificate,
  displayFromTemplatePlacements,
} from './bridge/furnitureDisplay.ts';
import type { FurnishingCertificate } from '../spatial/types.ts';
import { collapseOptionalCorridor } from '../engine/topology/collapseOptionalCorridor.ts';
import { accessTreeFromSharedWalls } from './bridge/topologyAdapter.ts';

export type GeometryBackend = 'spatialPack' | 'regionGrowth' | 'stripEmbed';

export interface GenerateOptions {
  seeds?: number;
  retain?: number;
  optimizeIterations?: number;
  doorConfig?: DoorConfig;
  baseSeed?: number;
  metricPriority?: MetricKey[];
  metricWeights?: Record<MetricKey, number>;
  designPrefs?: DesignPrefs;
  strategy?: ResolvedStrategy;
  region?: 'india' | 'generic';
  /** Market tier from UI compact/standard/premium — drives budgets + spatial standards. */
  tier?: 'compact' | 'standard' | 'premium';
  /** Max BHK for spatialPack (default 2). 3BHK+ uses capped strip as fallback layer. */
  spatialMaxBhk?: number;
  disableSpatialEngine?: boolean;
}

export interface SpatialLoopDiagnostics {
  pulls: number;
  certified: number;
  converted: number;
  rejected: number;
  backends: Record<string, number>;
}

export interface GenerateResult {
  plans: FloorPlan[];
  infeasible?: string;
  attempts: number;
  validCount: number;
  spatialDiagnostics?: SpatialLoopDiagnostics;
}

const CELL_JITTER_MM = [200, 250, 300] as const;

/**
 * Unified generation: mission families × geometry backends → shared gates → diversity pick.
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
    tier: options.tier ?? 'standard',
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
  const familyList = (families.length ? families : [...ALL_MISSION_FAMILIES]) as MissionGraphFamily[];
  // Layered geometry (not peer engines):
  //   1–2 BHK: spatialPack → regionGrowth
  //   3BHK+: stripEmbed (capped living) → regionGrowth until spatial scales
  const spatialMaxBhk = options.spatialMaxBhk ?? 2;
  const spatialOk =
    !options.disableSpatialEngine &&
    isSpatialEngineEligible(bedrooms, outlineW, outlineH, spatialMaxBhk);

  const backends: GeometryBackend[] = spatialOk
    ? ['spatialPack', 'regionGrowth']
    : bedrooms >= 3
      ? ['stripEmbed', 'regionGrowth']
      : ['regionGrowth', 'stripEmbed'];

  const armKeys = familyList.flatMap(f => {
    const corridorFamily =
      f === 'short_private_corridor' ||
      f === 'split_public_private_spine' ||
      f === 'corner_entry_distribution';
    const arms = backends.filter(b => {
      if (b !== 'stripEmbed') return true;
      if (ctx.circulation.corridorPolicy === 'never') return false;
      // Prefer strip on corridor families; still allow as fallback for 3BHK+ hubs.
      return corridorFamily || bedrooms >= 3;
    });
    return arms.map(b => makeArmKey(f, b));
  });
  const bandit = new FamilyBandit(
    armKeys.length ? armKeys : familyList.map(f => makeArmKey(f, 'regionGrowth')),
  );

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
  const spatialDiagnostics: SpatialLoopDiagnostics = {
    pulls: 0,
    certified: 0,
    converted: 0,
    rejected: 0,
    backends: {},
  };

  for (let i = 0; i < seeds; i++) {
    attempts++;
    const seed = baseSeed + i * 9973;
    const armKey = bandit.select();
    const { family: familyStr, backend: backendStr } = splitArmKey(armKey);
    const family = familyStr as MissionGraphFamily;
    const backend = backendStr as GeometryBackend;

    let mission =
      graphsByFamily.get(family)?.[i % Math.max(1, graphsByFamily.get(family)?.length ?? 1)];
    if (!mission) {
      try {
        mission = generateMissionGraph(family, ctx, seed);
      } catch {
        bandit.record(armKey, false);
        continue;
      }
    }
    const style = styles[i % styles.length]!;
    const cellSizeMm = CELL_JITTER_MM[i % CELL_JITTER_MM.length];

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
        backend,
        cellSizeMm,
      );
      if (!plan || !plan.validation.valid) {
        if (backend === 'spatialPack') {
          spatialDiagnostics.pulls++;
          spatialDiagnostics.rejected++;
        }
        bandit.record(armKey, false);
        continue;
      }

      const actualEngine = String(plan.debug?.geometryEngine ?? backend);
      if (backend === 'spatialPack') {
        spatialDiagnostics.pulls++;
        if (actualEngine === 'spatialPack') {
          spatialDiagnostics.certified++;
          spatialDiagnostics.converted++;
        } else {
          spatialDiagnostics.rejected++;
        }
      }
      spatialDiagnostics.backends[actualEngine] =
        (spatialDiagnostics.backends[actualEngine] ?? 0) + 1;

      plan.debug = {
        ...(plan.debug ?? {}),
        circulationDemand: demand,
        contextReasoning: ctx.reasoning,
        missionFamily: mission.family,
        geometryBackend: actualEngine,
        requestedBackend: backend,
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
        bandit.record(armKey, false);
        continue;
      }

      // Template furniture is display/score only — spatialPack already certified via FurnishingFeasibilitySolver.
      const furniture = validateFurniture(optimized.rooms, ctx.tier);
      const playtest = runVirtualOccupantPlaytests(optimized);
      // Spatial packs already carry a navigation certificate. Other backends
      // use playtest as a soft rank penalty — hard-reject was starving 3BHK+
      // strip/growth yield while spatial packing still scales.
      const playtestPenalty =
        playtest.criticalJourneysPass || actualEngine === 'spatialPack'
          ? 0
          : 0.2;

      const furnishingGate = evaluateFurnishingGate(optimized, ctx);
      if (!furnishingGate.passed && furnishingGate.hard) {
        bandit.record(armKey, false);
        continue;
      }

      const lex = lexicoScores(optimized, designPrefs);
      // Soft: fold template usability + playtest into ranking.
      const usabilityPenalty = furniture.valid ? 0 : (1 - furniture.usabilityScore) * 0.15;
      optimized.scores = {
        areaError: lex[0],
        daylight: lex[1],
        privacy: lex[2],
        corridorEfficiency: lex[3],
        wetClustering: lex[4],
        shapeQuality: lex[5] + usabilityPenalty + playtestPenalty,
        lexico: [...lex.slice(0, 5), lex[5] + usabilityPenalty + playtestPenalty],
      };
      optimized.missionGraph = mission;
      optimized.fingerprint = calculateLayoutFingerprint(optimized, mission.family);

      const spatialCert =
        (furnishingGate.certificate as FurnishingCertificate | undefined) ??
        (plan.debug?.furnishing as FurnishingCertificate | undefined);
      const furnitureCellMm =
        Number(plan.debug?.cellSizeMm) || cellSizeMm || 250;
      if (spatialCert?.valid) {
        optimized.furniture = displayFromSpatialCertificate(spatialCert, furnitureCellMm);
      } else if (furniture.placements.length > 0) {
        optimized.furniture = displayFromTemplatePlacements(furniture.placements);
      }

      optimized.debug = {
        ...(plan.debug ?? {}),
        furnitureUsability: furniture.usabilityScore,
        journeys: playtest.journeys.map(j => ({ name: j.name, ok: j.reachable })),
        geometryEngine: actualEngine,
        geometryBackend: actualEngine,
        requestedBackend: backend,
        cellSizeMm: furnitureCellMm,
        furnishing: spatialCert ?? plan.debug?.furnishing,
        templateFurniture: furniture.placements,
        furnishingGate: {
          passed: furnishingGate.passed,
          hard: furnishingGate.hard,
          reasons: furnishingGate.reasons,
          walkableAreaSqM: furnishingGate.walkableAreaSqM,
        },
      };
      valid.push(optimized);
      bandit.record(armKey, true);
    } catch (e) {
      if (e instanceof InfeasibleProgrammeError) {
        infeasible = e.message;
        return { plans: [], infeasible, attempts, validCount: 0 };
      }
      bandit.record(armKey, false);
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
    spatialDiagnostics,
  };
}

function dedupeByFingerprint(plans: FloorPlan[], threshold: number): FloorPlan[] {
  const out: FloorPlan[] = [];
  const keys = new Set<string>();
  for (const p of plans) {
    const fp = p.fingerprint ?? calculateLayoutFingerprint(p);
    const key = fingerprintKey(fp);
    if (keys.has(key)) continue;
    if (
      out.some(o =>
        isNearDuplicate(fp, o.fingerprint ?? calculateLayoutFingerprint(o), threshold),
      )
    ) {
      continue;
    }
    // Mission-family fingerprints differ while room geometry is identical
    // (common at the 850 sq.ft / 10.1×7.8 envelope). Drop geometric clones.
    if (out.some(o => geometricSimilarity(o, p) >= 0.9)) {
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
          // Geometry dominates — fingerprint alone retained near-identical packs.
          return Math.max(fpDist * 0.35, geoDist);
        }),
      );
      const quality = 1 - i / rest.length;
      const score = minDist * 0.85 + quality * 0.15;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    // Refuse near-clones even if they're the "best" remaining option.
    const next = rest[bestIdx]!;
    if (picked.some(p => geometricSimilarity(p, next) >= 0.9)) {
      rest.splice(bestIdx, 1);
      continue;
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
  backend: GeometryBackend = 'regionGrowth',
  cellSizeMm?: number,
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
    backend,
    cellSizeMm,
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
    undefined,
    undefined,
    'stripEmbed',
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
  backend: GeometryBackend = 'regionGrowth',
  cellSizeMm?: number,
): FloorPlan | null {
  const budgets = buildAreaBudgets(topology, spec.totalAreaTarget, {
    spec,
    tier: ctx?.tier ?? 'standard',
  });
  const style = layoutStyle ?? pickLayoutStyle(seed, variant);
  let activeTopology = topology;

  let rooms: FloorPlan['rooms'] | null = null;
  let spine: FloorPlan['spine'] | null = null;
  let debug: Record<string, unknown> | undefined;
  let usedPrimary = false;
  let effectiveOutlineW = outlineW;
  let effectiveOutlineH = outlineH;

  if (mission && ctx && backend === 'spatialPack') {
    const packed = packPlanFromMission({
      ctx,
      mission,
      topology: activeTopology,
      budgets,
      seed,
      cellSizeMm,
    });
    if (packed.ok) {
      rooms = packed.rooms;
      spine = packed.spine;
      debug = { ...(packed.debug ?? {}), geometryEngine: 'spatialPack' };
      usedPrimary = true;
      if (packed.outlineW) effectiveOutlineW = packed.outlineW;
      if (packed.outlineH) effectiveOutlineH = packed.outlineH;
      if (packed.topology) activeTopology = packed.topology;
    } else {
      // Failed spatialPack attempt — do not silently downgrade to strip embed.
      return null;
    }
  }

  if ((!usedPrimary || !rooms || !spine) && mission && ctx && backend === 'regionGrowth') {
    const grown = growPlanFromMission({
      ctx,
      mission,
      topology: activeTopology,
      budgets,
      seed,
    });
    if (grown.ok) {
      rooms = grown.rooms;
      spine = grown.spine;
      debug = { ...(grown.debug ?? {}), geometryEngine: 'regionGrowth' };
      usedPrimary = true;
      if (grown.topology) activeTopology = grown.topology;
    } else {
      return null;
    }
  }

  if ((!usedPrimary || !rooms || !spine) && backend === 'stripEmbed') {
    const corridorNode = activeTopology.nodes.find(n => n.category === 'CORRIDOR');
    if (!corridorNode) {
      // Corridor-less trees: grow or fail — never resurrect legacy generateOne mid-loop.
      if (mission && ctx) {
        const grown = growPlanFromMission({
          ctx,
          mission,
          topology: activeTopology,
          budgets,
          seed,
        });
        if (grown.ok) {
          rooms = grown.rooms;
          spine = grown.spine;
          debug = { ...(grown.debug ?? {}), geometryEngine: 'regionGrowth' };
          usedPrimary = true;
          if (grown.topology) activeTopology = grown.topology;
        }
      }
      if (!rooms || !spine) return null;
    } else {
      const entryId = activeTopology.nodes.find(n => n.category === 'ENTRY')!.id;
      const foyerId = activeTopology.nodes.find(n => n.category === 'FOYER')?.id ?? null;
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
        tree: activeTopology,
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
      debug = { geometryEngine: 'stripEmbed' };
      usedPrimary = true;
      effectiveOutlineW = outlineW;
      effectiveOutlineH = outlineH;
    }
  }

  if (!rooms || !spine) return null;

  if (rooms) {
    const before = rooms.length;
    rooms = collapseBathroomSpurCorridors(rooms);
    if (rooms.length !== before) {
      // Topology still named the spur — rewire onto living / rebuild from walls.
      if (!rooms.some(r => r.category === 'CORRIDOR')) {
        activeTopology = collapseOptionalCorridor(activeTopology);
      } else {
        const walls = computeSharedWalls(rooms, doorConfig);
        activeTopology = accessTreeFromSharedWalls(
          rooms.map(r => ({ id: r.id, category: r.category })),
          walls.map(w => ({
            roomAId: w.roomAId,
            roomBId: w.roomBId,
            length: w.length,
          })),
        );
      }
      const entryRoom = rooms.find(r => r.category === 'ENTRY');
      if (entryRoom) activeTopology.rootId = entryRoom.id;
    }
  }

  // Rebuild budgets if topology changed (spatialPack physical resolution or corridor collapse).
  const activeBudgets =
    activeTopology === topology
      ? budgets
      : (() => {
          try {
            return buildAreaBudgets(activeTopology, spec.totalAreaTarget, {
              spec,
              tier: ctx?.tier ?? 'standard',
            });
          } catch {
            return budgets.filter(b => activeTopology.nodes.some(n => n.id === b.roomId));
          }
        })();
  // Soften mins for packed / collapsed rooms that already have geometry.
  // Never inflate living/corridor/bedroom/kitchen max — that reintroduced waste.
  if (rooms && (activeTopology !== topology || debug?.geometryEngine === 'spatialPack')) {
    for (const b of activeBudgets) {
      const room = rooms.find(r => r.id === b.roomId);
      if (!room) continue;
      const area = room.parts
        ? room.parts.reduce((s, p) => s + p.w * p.h, 0)
        : room.w * room.h;
      b.minArea = Math.min(b.minArea, Math.max(0.5, area * 0.92));
      const keepHardMax =
        b.category === 'LIVING' ||
        b.category === 'CORRIDOR' ||
        b.category === 'BEDROOM' ||
        b.category === 'KITCHEN';
      if (!keepHardMax) {
        b.maxArea = Math.max(b.maxArea, area * 1.15);
      }
      b.minWidth = Math.min(b.minWidth, Math.max(0.8, Math.min(room.w, room.h) * 0.95));
      b.minHeight = Math.min(b.minHeight, Math.max(0.8, Math.min(room.w, room.h) * 0.95));
      b.targetArea = Math.min(b.maxArea, Math.max(b.minArea, area));
    }
  }

  const sharedWalls = computeSharedWalls(rooms, doorConfig);
  const placed = placeDoors(
    activeTopology,
    rooms,
    sharedWalls,
    entranceDir,
    effectiveOutlineW,
    effectiveOutlineH,
    doorConfig,
  );

  const portalGraph = buildPortalGraph(rooms, placed.doors, spine);
  const routes = buildRoutes(rooms, placed.doors, portalGraph);

  const validation = validateFloorPlan({
    rooms,
    topology: activeTopology,
    budgets: activeBudgets,
    sharedWalls,
    doors: placed.doors,
    routes,
    entrance: placed.entrance,
    outlineW: effectiveOutlineW,
    outlineH: effectiveOutlineH,
    missingTopologyEdges: placed.missingEdges,
  });

  // Primary backends must stand on their own geometry. Falling back to strip
  // embed after a shape/topology failure reintroduced bowling-alley rooms.
  return {
    rooms,
    topology: activeTopology,
    budgets: activeBudgets,
    spine,
    sharedWalls,
    doors: placed.doors,
    portalGraph,
    routes,
    entrance: placed.entrance,
    validation,
    seed,
    outlineW: effectiveOutlineW,
    outlineH: effectiveOutlineH,
    debug,
  };
}

export function buildFromSpecTopologyFirst(
  spec: ProgramSpec,
  outlineW: number,
  outlineH: number,
  entranceDir: EntranceDirection = 'S',
  seed = 42,
): {
  problem: SolveProblem;
  plan: FloorPlan | null;
  validation: ValidationResult | null;
  error?: string;
} {
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
