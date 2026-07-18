/**
 * Remove corridors that only serve bathrooms (dead-end bath vestibules).
 * Those spurs waste carpet and isolate wet rooms from the living hub —
 * attach the bathroom to living instead by absorbing the corridor polygon.
 */

import { computeSharedWalls } from '../geometry/sharedWalls.ts';
import {
  DEFAULT_DOOR_CONFIG,
  isBathroomCategory,
  type RoomRect,
} from '../types.ts';

const DETECT_CFG = {
  ...DEFAULT_DOOR_CONFIG,
  doorWidth: 0.7,
  sideClearance: 0.05,
};

function isHost(cat: string): boolean {
  return cat === 'LIVING' || cat === 'ENTRY' || cat === 'FOYER';
}

/**
 * A corridor is a "bath spur" when its shared-wall neighbours are only
 * living/entry/foyer + bathrooms — no bedroom or kitchen on the spine.
 */
export function isBathroomSpurCorridor(
  corridorId: string,
  rooms: RoomRect[],
): boolean {
  const byId = new Map(rooms.map(r => [r.id, r]));
  const walls = computeSharedWalls(rooms, DETECT_CFG);
  const neighbors = new Set<string>();
  for (const w of walls) {
    if (w.roomAId === corridorId) neighbors.add(w.roomBId);
    if (w.roomBId === corridorId) neighbors.add(w.roomAId);
  }
  if (neighbors.size === 0) return true;

  let hasBath = false;
  for (const nid of neighbors) {
    const cat = byId.get(nid)?.category;
    if (!cat) continue;
    if (cat === 'BEDROOM' || cat === 'KITCHEN') return false;
    if (isBathroomCategory(cat)) hasBath = true;
    else if (!isHost(cat) && cat !== 'CORRIDOR') return false;
  }
  return hasBath;
}

/** Absorb bath-only corridor spurs into Living; bathrooms keep adjacency via parts. */
export function collapseBathroomSpurCorridors(rooms: RoomRect[]): RoomRect[] {
  const living = rooms.find(r => r.category === 'LIVING');
  if (!living) return rooms;

  const spurIds = rooms
    .filter(r => r.category === 'CORRIDOR' && isBathroomSpurCorridor(r.id, rooms))
    .map(r => r.id);
  if (spurIds.length === 0) return rooms;

  const livingParts = [
    ...(living.parts ?? [{ x: living.x, y: living.y, w: living.w, h: living.h }]),
  ];
  for (const id of spurIds) {
    const c = rooms.find(r => r.id === id)!;
    livingParts.push(...(c.parts ?? [{ x: c.x, y: c.y, w: c.w, h: c.h }]));
  }

  const primary = [...livingParts].sort((a, b) => b.w * b.h - a.w * a.h)[0]!;
  living.parts = livingParts.length > 1 ? livingParts : undefined;
  living.x = primary.x;
  living.y = primary.y;
  living.w = primary.w;
  living.h = primary.h;
  living.targetArea = livingParts.reduce((s, p) => s + p.w * p.h, 0);

  return rooms.filter(r => !spurIds.includes(r.id));
}
