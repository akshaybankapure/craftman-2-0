import type { DoorConfig, Interval, RoomRect, SharedWall, Vec2 } from '../types.ts';
import { DEFAULT_DOOR_CONFIG } from '../types.ts';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Compute geometric adjacencies from real shared-wall overlap (not centroids). */
export function computeSharedWalls(
  rooms: RoomRect[],
  config: DoorConfig = DEFAULT_DOOR_CONFIG,
): SharedWall[] {
  const walls: SharedWall[] = [];
  const minLen = config.doorWidth + 2 * config.sideClearance;

  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i];
      const b = rooms[j];
      const partsA = roomParts(a);
      const partsB = roomParts(b);
      for (const pa of partsA) {
        for (const pb of partsB) {
          const wall = sharedWallBetween(pa, pb, a.id, b.id, minLen, config);
          if (wall) walls.push(wall);
        }
      }
    }
  }

  // Deduplicate same pair keeping longest
  const best = new Map<string, SharedWall>();
  for (const w of walls) {
    const key = [w.roomAId, w.roomBId].sort().join('|');
    const prev = best.get(key);
    if (!prev || w.length > prev.length) best.set(key, w);
  }
  return [...best.values()];
}

function roomParts(r: RoomRect): Rect[] {
  if (r.parts && r.parts.length > 0) return r.parts;
  return [{ x: r.x, y: r.y, w: r.w, h: r.h }];
}

function sharedWallBetween(
  a: Rect,
  b: Rect,
  idA: string,
  idB: string,
  minLen: number,
  config: DoorConfig,
): SharedWall | null {
  const eps = 0.05;

  // Vertical wall: a's right == b's left
  if (Math.abs(a.x + a.w - b.x) < eps || Math.abs(b.x + b.w - a.x) < eps) {
    const y1 = Math.max(a.y, b.y);
    const y2 = Math.min(a.y + a.h, b.y + b.h);
    const length = y2 - y1;
    if (length < minLen - 1e-6) return null;
    const x = Math.abs(a.x + a.w - b.x) < eps ? a.x + a.w : b.x + b.w;
    const start: Vec2 = { x, y: y1 };
    const end: Vec2 = { x, y: y2 };
    return {
      roomAId: idA,
      roomBId: idB,
      axis: 'vertical',
      start,
      end,
      length,
      validDoorIntervals: doorIntervals(y1, y2, config),
    };
  }

  // Horizontal wall
  if (Math.abs(a.y + a.h - b.y) < eps || Math.abs(b.y + b.h - a.y) < eps) {
    const x1 = Math.max(a.x, b.x);
    const x2 = Math.min(a.x + a.w, b.x + b.w);
    const length = x2 - x1;
    if (length < minLen - 1e-6) return null;
    const y = Math.abs(a.y + a.h - b.y) < eps ? a.y + a.h : b.y + b.h;
    const start: Vec2 = { x: x1, y };
    const end: Vec2 = { x: x2, y };
    return {
      roomAId: idA,
      roomBId: idB,
      axis: 'horizontal',
      start,
      end,
      length,
      validDoorIntervals: doorIntervals(x1, x2, config),
    };
  }

  return null;
}

function doorIntervals(lo: number, hi: number, config: DoorConfig): Interval[] {
  const length = hi - lo;
  if (length < config.doorWidth - 1e-9) return [];
  // Shrink corner clearance when the wall is just long enough for a door
  const maxCorner = Math.max(0, (length - config.doorWidth) / 2);
  const corner = Math.min(config.cornerClearance, maxCorner);
  const usableLo = lo + corner;
  const usableHi = hi - corner;
  if (usableHi - usableLo < config.doorWidth - 1e-9) return [];
  return [{ start: usableLo, end: usableHi }];
}

export function findSharedWall(
  walls: SharedWall[],
  a: string,
  b: string,
): SharedWall | undefined {
  return walls.find(
    w =>
      (w.roomAId === a && w.roomBId === b) ||
      (w.roomAId === b && w.roomBId === a),
  );
}
