/**
 * Virtual occupant playtesting — scripted journeys over the portal/door graph.
 */

import type { AccessNodeCategory, Door, FloorPlan, RoomRect } from '../../planner/types.ts';
import { isBathroomCategory } from '../../planner/types.ts';

export interface JourneyResult {
  name: string;
  reachable: boolean;
  distance: number;
  turns: number;
  doorsCrossed: number;
  privateRoomsCrossed: number;
  furnitureConflicts: number;
  narrowPoints: number;
  wallViolations: number;
  pathRoomIds: string[];
  failure?: string;
}

export interface PlaytestResult {
  journeys: JourneyResult[];
  criticalJourneysPass: boolean;
  errors: string[];
}

type Adj = Map<string, { to: string; doorId: string }[]>;

function buildDoorAdj(rooms: RoomRect[], doors: Door[]): Adj {
  const adj: Adj = new Map();
  for (const r of rooms) adj.set(r.id, []);
  for (const d of doors) {
    if (d.roomBId === '__EXTERIOR__') continue;
    adj.get(d.roomAId)?.push({ to: d.roomBId, doorId: d.id });
    adj.get(d.roomBId)?.push({ to: d.roomAId, doorId: d.id });
  }
  return adj;
}

function bfsPath(
  adj: Adj,
  start: string,
  goals: Set<string>,
): { path: string[]; doors: number } | null {
  if (goals.has(start)) return { path: [start], doors: 0 };
  const prev = new Map<string, string | null>();
  const q = [start];
  prev.set(start, null);
  while (q.length) {
    const cur = q.shift()!;
    for (const e of adj.get(cur) ?? []) {
      if (prev.has(e.to)) continue;
      prev.set(e.to, cur);
      if (goals.has(e.to)) {
        const path = [e.to];
        let p: string | null = cur;
        while (p) {
          path.push(p);
          p = prev.get(p) ?? null;
        }
        path.reverse();
        return { path, doors: path.length - 1 };
      }
      q.push(e.to);
    }
  }
  return null;
}

function roomByCat(rooms: RoomRect[], cat: AccessNodeCategory): RoomRect | undefined {
  return rooms.find(r => r.category === cat);
}

function roomsByCat(rooms: RoomRect[], cat: AccessNodeCategory): RoomRect[] {
  return rooms.filter(r => r.category === cat);
}

function countPrivateCrossed(path: string[], rooms: RoomRect[], exclude: Set<string>): number {
  let n = 0;
  for (const id of path) {
    if (exclude.has(id)) continue;
    const r = rooms.find(x => x.id === id);
    if (r && (r.category === 'BEDROOM' || isBathroomCategory(r.category))) n++;
  }
  return n;
}

export function runVirtualOccupantPlaytests(plan: FloorPlan): PlaytestResult {
  const { rooms, doors } = plan;
  const adj = buildDoorAdj(rooms, doors);
  const journeys: JourneyResult[] = [];
  const errors: string[] = [];

  const entry = roomByCat(rooms, 'ENTRY');
  const living = roomByCat(rooms, 'LIVING');
  const kitchen = roomByCat(rooms, 'KITCHEN');
  const commonBath = roomByCat(rooms, 'COMMON_BATHROOM');
  const bedrooms = roomsByCat(rooms, 'BEDROOM');

  // Guest: ENTRY → LIVING → COMMON_BATH → (back concept)
  if (entry && living && commonBath) {
    const toLiving = bfsPath(adj, entry.id, new Set([living.id]));
    const toBath = toLiving
      ? bfsPath(adj, living.id, new Set([commonBath.id]))
      : null;
    const path = toLiving && toBath
      ? [...toLiving.path, ...toBath.path.slice(1)]
      : [];
    const privateCrossed = countPrivateCrossed(
      path,
      rooms,
      new Set([entry.id, living.id, commonBath.id]),
    );
    const ok = !!toLiving && !!toBath && privateCrossed === 0;
    const j: JourneyResult = {
      name: 'guest',
      reachable: ok,
      distance: path.length,
      turns: Math.max(0, path.length - 2),
      doorsCrossed: Math.max(0, path.length - 1),
      privateRoomsCrossed: privateCrossed,
      furnitureConflicts: 0,
      narrowPoints: 0,
      wallViolations: 0,
      pathRoomIds: path,
      failure: !ok
        ? privateCrossed > 0
          ? 'Guest journey crosses bedroom/private room'
          : 'Guest cannot reach living/common bath'
        : undefined,
    };
    journeys.push(j);
    if (!ok) errors.push(j.failure!);
  }

  // Groceries: ENTRY → KITCHEN
  if (entry && kitchen) {
    const p = bfsPath(adj, entry.id, new Set([kitchen.id]));
    const privateCrossed = p
      ? countPrivateCrossed(p.path, rooms, new Set([entry.id, kitchen.id, living?.id ?? '']))
      : 99;
    // Crossing bedroom is bad for groceries
    const beds = new Set(bedrooms.map(b => b.id));
    const crossedBed = p?.path.some(id => beds.has(id)) ?? true;
    const ok = !!p && !crossedBed;
    const j: JourneyResult = {
      name: 'groceries',
      reachable: ok,
      distance: p?.path.length ?? 0,
      turns: 0,
      doorsCrossed: p?.doors ?? 0,
      privateRoomsCrossed: privateCrossed,
      furnitureConflicts: 0,
      narrowPoints: 0,
      wallViolations: 0,
      pathRoomIds: p?.path ?? [],
      failure: !ok ? 'Groceries path missing or crosses bedroom' : undefined,
    };
    journeys.push(j);
    if (!ok) errors.push(j.failure!);
  }

  // Resident evening: ENTRY → BEDROOM (each)
  for (const bed of bedrooms) {
    if (!entry) break;
    const p = bfsPath(adj, entry.id, new Set([bed.id]));
    const otherBeds = new Set(bedrooms.filter(b => b.id !== bed.id).map(b => b.id));
    const crossedOther = p?.path.some(id => otherBeds.has(id)) ?? true;
    // Ensuite must not be a transit node
    const viaEnsuite = p?.path.some(id => {
      const r = rooms.find(x => x.id === id);
      return r?.category === 'ENSUITE_BATHROOM';
    }) ?? false;
    const ok = !!p && !crossedOther && !viaEnsuite;
    const j: JourneyResult = {
      name: `evening:${bed.id}`,
      reachable: ok,
      distance: p?.path.length ?? 0,
      turns: 0,
      doorsCrossed: p?.doors ?? 0,
      privateRoomsCrossed: crossedOther ? 1 : 0,
      furnitureConflicts: 0,
      narrowPoints: 0,
      wallViolations: 0,
      pathRoomIds: p?.path ?? [],
      failure: !ok
        ? viaEnsuite
          ? 'Path uses ensuite as transit'
          : 'Cannot reach bedroom without crossing another bedroom'
        : undefined,
    };
    journeys.push(j);
    if (!ok) errors.push(j.failure!);
  }

  // Private night: BEDROOM → assigned bath → BEDROOM
  for (const bed of bedrooms) {
    const ensuite = rooms.find(
      r => r.category === 'ENSUITE_BATHROOM' && plan.topology.nodes.find(n => n.id === r.id)?.attachedTo === bed.id,
    );
    const bath = ensuite ?? commonBath;
    if (!bath) continue;
    const p = bfsPath(adj, bed.id, new Set([bath.id]));
    const ok = !!p;
    // Path should not go through another bedroom
    const otherBeds = new Set(bedrooms.filter(b => b.id !== bed.id).map(b => b.id));
    const crossedOther = p?.path.some(id => otherBeds.has(id)) ?? false;
    const j: JourneyResult = {
      name: `night:${bed.id}`,
      reachable: ok && !crossedOther,
      distance: p?.path.length ?? 0,
      turns: 0,
      doorsCrossed: p?.doors ?? 0,
      privateRoomsCrossed: crossedOther ? 1 : 0,
      furnitureConflicts: 0,
      narrowPoints: 0,
      wallViolations: 0,
      pathRoomIds: p?.path ?? [],
      failure: !ok || crossedOther ? 'Night bath path invalid' : undefined,
    };
    journeys.push(j);
    if (!j.reachable) errors.push(j.failure!);
  }

  // Ensuite must never be required to reach another room
  for (const ens of rooms.filter(r => r.category === 'ENSUITE_BATHROOM')) {
    const deg = doors.filter(
      d => d.roomBId !== '__EXTERIOR__' && (d.roomAId === ens.id || d.roomBId === ens.id),
    ).length;
    if (deg !== 1) {
      errors.push(`Ensuite ${ens.id} is not a leaf (degree ${deg})`);
    }
  }

  const critical = ['guest', 'groceries'];
  const criticalJourneysPass =
    errors.length === 0 &&
    critical.every(name => journeys.find(j => j.name === name)?.reachable !== false);

  return { journeys, criticalJourneysPass, errors };
}
