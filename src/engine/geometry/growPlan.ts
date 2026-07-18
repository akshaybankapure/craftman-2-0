/**
 * Stage-B geometry: influence → circulation skeleton → region growth → RoomRect[].
 */

import type { AreaBudget, AccessTree, CorridorSpine, EntranceDirection, RoomRect } from '../../planner/types.ts';
import type { ContextProfile } from '../context/contextProfile.ts';
import { resolveCirculationDemand } from '../circulation/demandModel.ts';
import { generateCirculationSkeleton } from '../circulation/skeleton.ts';
import type { MissionGraph } from '../topology/missionTypes.ts';
import { buildInfluenceMap } from '../zoning/influenceMap.ts';
import { growRoomRegions } from './regionGrowth.ts';

export interface GrowPlanResult {
  rooms: RoomRect[];
  spine: CorridorSpine;
  ok: boolean;
  reason?: string;
  debug?: Record<string, unknown>;
}

export function growPlanFromMission(params: {
  ctx: ContextProfile;
  mission: MissionGraph;
  topology: AccessTree;
  budgets: AreaBudget[];
  seed: number;
}): GrowPlanResult {
  const { ctx, mission, topology, budgets, seed } = params;
  const demand = resolveCirculationDemand(ctx, mission);
  const influence = buildInfluenceMap(ctx, mission, 0.3);
  const circulation = generateCirculationSkeleton(ctx, mission, influence, demand, seed ^ 0xC1A);

  const growth = growRoomRegions({
    ctx,
    mission,
    topology,
    budgets,
    influence,
    circulation,
    seed: seed ^ 0x6E07,
  });

  if (!growth.ok) {
    return { rooms: [], spine: emptySpine(ctx.entranceDir), ok: false, reason: growth.reason };
  }

  // Ensure required topology nodes have rooms
  for (const n of topology.nodes) {
    if (n.category === 'BALCONY') continue;
    if (n.category === 'CORRIDOR' && !circulation.materialiseCorridorRoom) continue;
    if (!growth.rooms.some(r => r.id === n.id)) {
      return {
        rooms: [],
        spine: emptySpine(ctx.entranceDir),
        ok: false,
        reason: `Missing grown room ${n.id}`,
      };
    }
  }

  const spine: CorridorSpine = {
    shape: circulation.materialiseCorridorRoom
      ? circulation.junctions.length > 0
        ? 'branched'
        : 'L'
      : 'living-integrated',
    width: circulation.widthM,
    centreline:
      circulation.centreline.length >= 2
        ? circulation.centreline
        : [
            { x: ctx.outlineW / 2, y: ctx.outlineH },
            { x: ctx.outlineW / 2, y: ctx.outlineH * 0.5 },
          ],
    polygons: growth.rooms
      .filter(r => r.category === 'CORRIDOR')
      .flatMap(r => r.parts ?? [{ x: r.x, y: r.y, w: r.w, h: r.h }]),
    entryPoint: entrancePoint(ctx),
  };

  return {
    rooms: growth.rooms,
    spine,
    ok: true,
    debug: {
      missionFamily: mission.family,
      circulationDemand: demand,
      materialiseCorridor: circulation.materialiseCorridorRoom,
      centrelineLen: circulation.centreline.length,
      junctionCount: circulation.junctions.length,
    },
  };
}

function entrancePoint(ctx: ContextProfile): { x: number; y: number } {
  const { outlineW: W, outlineH: H, entranceDir } = ctx;
  switch (entranceDir) {
    case 'S':
      return { x: W / 2, y: H };
    case 'N':
      return { x: W / 2, y: 0 };
    case 'E':
      return { x: W, y: H / 2 };
    case 'W':
      return { x: 0, y: H / 2 };
  }
}

function emptySpine(dir: EntranceDirection): CorridorSpine {
  return {
    shape: 'straight',
    width: 1.05,
    centreline: [],
    polygons: [],
    entryPoint: { x: 0, y: 0 },
  };
}
