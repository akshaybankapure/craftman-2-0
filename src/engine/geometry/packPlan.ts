/**
 * Spatial-grid geometry backend: mission AccessTree → certified packing → RoomRect[].
 * Mirrors growPlanFromMission's contract. No internal NSGA / fingerprint selection.
 */

import type { AccessTree, AreaBudget, CorridorSpine, RoomRect } from '../../planner/types.ts';
import {
  absorbOptionalCorridorRooms,
  candidateToRooms,
  ensureEntryRoom,
  gridOutlineFromCandidate,
  livingIntegratedSpineFromRooms,
} from '../../planner/bridge/candidateToRooms.ts';
import { collapseBathroomSpurCorridors } from '../../planner/bridge/collapseBathSpurCorridor.ts';
import {
  accessTreeToAccessGraph,
  accessTreeFromSharedWalls,
  missionFamilyToTopologyFamily,
} from '../../planner/bridge/topologyAdapter.ts';
import { computeSharedWalls } from '../../planner/geometry/sharedWalls.ts';
import { collapseOptionalCorridor } from '../topology/collapseOptionalCorridor.ts';
import {
  adaptiveCellSizeMm,
  entranceToDirection,
  isSpatialEngineEligible,
} from '../../planner/bridge/spatialEngineBridge.ts';
import type { ContextProfile } from '../context/contextProfile.ts';
import type { MissionGraph } from '../topology/missionTypes.ts';
import {
  OccupancyGrid,
  normalizeBrief,
  buildProgrammeBudget,
  packCertifiedCandidate,
  type FloorPlanBrief,
  type NormalizedBrief,
} from '../../spatial/index.ts';

export interface PackPlanResult {
  rooms: RoomRect[];
  spine: CorridorSpine;
  ok: boolean;
  reason?: string;
  debug?: Record<string, unknown>;
  outlineW?: number;
  outlineH?: number;
  /** Geometry-resolved access tree (preferred over mission tree for doors). */
  topology?: AccessTree;
}

const CELL_SIZES_MM = [200, 250, 300] as const;
const MAX_RETRIES = 6;

export function packPlanFromMission(params: {
  ctx: ContextProfile;
  mission: MissionGraph;
  topology: AccessTree;
  budgets: AreaBudget[];
  seed: number;
  cellSizeMm?: number;
}): PackPlanResult {
  const { ctx, mission, topology, budgets, seed } = params;

  if (!isSpatialEngineEligible(ctx.bhk, ctx.outlineW, ctx.outlineH, 4)) {
    return {
      rooms: [],
      spine: emptySpine(),
      ok: false,
      reason: 'Spatial pack ineligible for this brief',
    };
  }

  // Programme: engine synthesises from BHK/bathrooms (high pack yield).
  // Mission still drives topology family + seed diversity; physical AccessGraph
  // is converted back to an AccessTree for doors/validation.
  void budgets;

  const topoFamily = missionFamilyToTopologyFamily(mission.family);
  // Cycle packing families by seed — mission→family mapping alone collapses
  // corridor-less 2BHK into HALL_CENTRIC / PRIVATE_LOBBY clones of one layout.
  const familyCycle = ['HALL_CENTRIC', 'PRIVATE_LOBBY', 'SPLIT_WING'] as const;
  const packFamily = familyCycle[Math.abs(seed) % familyCycle.length]!;
  const accessGraph = {
    ...accessTreeToAccessGraph(topology, topoFamily),
    family: packFamily,
  };

  const cellSizeMm =
    params.cellSizeMm ??
    CELL_SIZES_MM[Math.abs(seed) % CELL_SIZES_MM.length] ??
    adaptiveCellSizeMm(ctx.carpetAreaM2);

  const widthMm = Math.max(
    cellSizeMm,
    Math.round((ctx.outlineW * 1000) / cellSizeMm) * cellSizeMm,
  );
  const heightMm = Math.max(
    cellSizeMm,
    Math.round((ctx.outlineH * 1000) / cellSizeMm) * cellSizeMm,
  );

  const briefInput: FloorPlanBrief = {
    carpetAreaSqM: ctx.carpetAreaM2,
    dimensions: { widthMm, heightMm },
    entranceEdge: entranceToDirection(ctx.entranceDir),
    buildingType: 'APARTMENT',
    bhk: Math.min(4, Math.max(1, ctx.bhk)) as 1 | 2 | 3 | 4,
    bathroomCount: Math.max(1, ctx.bathrooms),
    // Geometry pack uses STANDARD programme sizing for yield; compact/premium
    // ambition is applied via planner budgets + furniture templates (ctx.tier).
    marketTier: 'STANDARD',
    seed,
    cellSizeMm,
    maxCandidates: 1,
  };

  const briefResult = normalizeBrief(briefInput);
  if (!briefResult.passed || !briefResult.value) {
    return {
      rooms: [],
      spine: emptySpine(),
      ok: false,
      reason: briefResult.fatalErrors.map(e => e.message).join('; ') || 'Invalid brief',
    };
  }
  const brief: NormalizedBrief = briefResult.value;

  const baseGrid = OccupancyGrid.rasterize(brief.envelope, brief.cellSizeMm);
  const budgetResult = buildProgrammeBudget(brief, baseGrid.insideCellCount());
  if (!budgetResult.passed || !budgetResult.value) {
    return {
      rooms: [],
      spine: emptySpine(),
      ok: false,
      reason:
        budgetResult.fatalErrors.map(e => e.message).join('; ') || 'Infeasible programme',
    };
  }
  const programme = budgetResult.value;

  const failReasons: string[] = [];
  for (let retry = 0; retry < MAX_RETRIES; retry++) {
    const attemptSeed = seed + retry * 104729;
    const attemptCell =
      CELL_SIZES_MM[retry % CELL_SIZES_MM.length] ?? cellSizeMm;
    // Re-build brief/grid when cell size jitters across retries.
    let attemptBrief = brief;
    let attemptGrid = baseGrid;
    let attemptProgramme = programme;
    if (attemptCell !== brief.cellSizeMm) {
      const wMm = Math.max(
        attemptCell,
        Math.round((ctx.outlineW * 1000) / attemptCell) * attemptCell,
      );
      const hMm = Math.max(
        attemptCell,
        Math.round((ctx.outlineH * 1000) / attemptCell) * attemptCell,
      );
      const retryBriefInput: FloorPlanBrief = {
        ...briefInput,
        seed: attemptSeed,
        cellSizeMm: attemptCell,
        dimensions: { widthMm: wMm, heightMm: hMm },
      };
      const retryNorm = normalizeBrief(retryBriefInput);
      if (!retryNorm.passed || !retryNorm.value) {
        failReasons.push('Retry brief invalid');
        continue;
      }
      attemptBrief = retryNorm.value;
      attemptGrid = OccupancyGrid.rasterize(attemptBrief.envelope, attemptBrief.cellSizeMm);
      const retryProg = buildProgrammeBudget(attemptBrief, attemptGrid.insideCellCount());
      if (!retryProg.passed || !retryProg.value) {
        failReasons.push('Retry programme infeasible');
        continue;
      }
      attemptProgramme = retryProg.value;
    }

    const packed = packCertifiedCandidate(
      attemptBrief,
      attemptProgramme,
      accessGraph,
      attemptGrid,
      attemptSeed,
      {
        externalTopology: false,
        localAttempt: retry,
        attemptsPerFamily: MAX_RETRIES,
        growerFallbackAfter: 0.25,
        // Every 3rd attempt prefers grower so we don't only ship the slicing tree.
        preferGrower: Math.abs(attemptSeed) % 3 === 2,
      },
    );
    if (!packed.plan) {
      failReasons.push(...packed.reasons.slice(0, 2));
      continue;
    }

    const rooms = candidateToRooms(packed.plan, undefined, undefined);
    const outline = gridOutlineFromCandidate(packed.plan);
    const outlineW = Math.max(ctx.outlineW, outline.outlineW);
    const outlineH = Math.max(ctx.outlineH, outline.outlineH);

    const entryId = ensureEntryRoom(rooms, ctx.entranceDir, outlineW, outlineH);
    if (!entryId) {
      failReasons.push('Could not create ENTRY room');
      continue;
    }

    // Default: no separate corridor space for living-hub / private-threshold
    // families. Dedicated CORRIDOR mission nodes still materialise a corridor.
    const wantSeparateCorridor =
      ctx.circulation.corridorPolicy === 'always' ||
      (ctx.circulation.corridorPolicy !== 'never' &&
        mission.nodes.some(n => n.type === 'CORRIDOR'));
    let finalRooms = rooms;
    if (!wantSeparateCorridor) {
      finalRooms = absorbOptionalCorridorRooms(rooms);
    } else {
      // Even when a corridor family is requested, never keep a bath-only spur.
      finalRooms = collapseBathroomSpurCorridors(rooms);
    }

    // Horizontal mirror diversifies left/right wing layouts without re-packing.
    // Skip for E/W entrances — mirror would move the door off the entrance edge.
    let furnishing = packed.plan.candidate.furnishing;
    const mirrorX =
      (ctx.entranceDir === 'N' || ctx.entranceDir === 'S') &&
      Math.abs(attemptSeed) % 2 === 1;
    if (mirrorX) {
      finalRooms = mirrorRoomsHorizontal(finalRooms, outlineW);
      furnishing = mirrorFurnishingHorizontal(
        furnishing,
        outlineW,
        attemptBrief.cellSizeMm,
      );
    }

    // Rebuild topology from actual shared walls after geometric edits.
    const walls = computeSharedWalls(finalRooms);
    let resolvedTree = accessTreeFromSharedWalls(
      finalRooms.map(r => ({ id: r.id, category: r.category })),
      walls.map(w => ({
        roomAId: w.roomAId,
        roomBId: w.roomBId,
        length: w.length,
      })),
    );
    if (!wantSeparateCorridor) {
      resolvedTree = collapseOptionalCorridor(resolvedTree);
    }
    resolvedTree.rootId = entryId;

    for (const n of resolvedTree.nodes) {
      const room = finalRooms.find(r => r.id === n.id);
      if (room) {
        room.category = n.category;
        if (n.category === 'ENTRY') room.type = 'entry';
        else if (n.category === 'FOYER') room.type = 'foyer';
        else if (n.category === 'CORRIDOR') room.type = 'corridor';
      }
    }

    const spine = livingIntegratedSpineFromRooms(
      finalRooms,
      ctx.entranceDir,
      outlineW,
      outlineH,
    );

    return {
      rooms: finalRooms,
      spine,
      ok: true,
      outlineW,
      outlineH,
      topology: resolvedTree,
      debug: {
        geometryEngine: 'spatialPack',
        missionFamily: mission.family,
        topologyFamily: topoFamily,
        certificate: packed.plan.certificate,
        furnishing,
        quality: packed.plan.candidate.quality,
        cellSizeMm: attemptBrief.cellSizeMm,
        attemptSeed,
        retries: retry,
        separateCorridor: wantSeparateCorridor,
        packFamily,
        mirrorX,
      },
    };
  }

  return {
    rooms: [],
    spine: emptySpine(),
    ok: false,
    reason: failReasons.slice(0, 6).join(' | ') || 'Spatial pack failed all retries',
  };
}

function mirrorRoomsHorizontal(
  rooms: RoomRect[],
  outlineW: number,
): RoomRect[] {
  return rooms.map(r => ({
    ...r,
    x: outlineW - r.x - r.w,
    parts: r.parts?.map(p => ({
      ...p,
      x: outlineW - p.x - p.w,
    })),
  }));
}

function mirrorFurnishingHorizontal(
  cert: import('../../spatial/types.ts').FurnishingCertificate,
  outlineW: number,
  cellSizeMm: number,
): import('../../spatial/types.ts').FurnishingCertificate {
  const cols = Math.max(1, Math.round((outlineW * 1000) / cellSizeMm));
  return {
    ...cert,
    rooms: cert.rooms.map(room => ({
      ...room,
      placements: room.placements.map(p => ({
        ...p,
        xCell: cols - p.xCell - p.widthCells,
      })),
    })),
  };
}

function emptySpine(): CorridorSpine {
  return {
    shape: 'straight',
    width: 1.05,
    centreline: [],
    polygons: [],
    entryPoint: { x: 0, y: 0 },
  };
}
