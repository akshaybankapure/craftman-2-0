/**
 * Adapt spatial-engine shape metrics to planner RoomRect geometry (metres).
 */

import { calculateRoomShapeMetrics } from '../../spatial/geometry/shapeMetrics.ts';
import type { RoomShapeMetrics } from '../../spatial/types.ts';
import type { RoomRect } from '../types.ts';

/** Build an orthogonal outer ring in millimetres from a RoomRect (+ optional parts). */
export function roomRectToPolygonMm(room: RoomRect): { outer: Array<{ x: number; y: number }> } {
  const parts = room.parts ?? [{ x: room.x, y: room.y, w: room.w, h: room.h }];
  if (parts.length === 1) {
    const p = parts[0]!;
    return {
      outer: [
        { x: p.x * 1000, y: p.y * 1000 },
        { x: (p.x + p.w) * 1000, y: p.y * 1000 },
        { x: (p.x + p.w) * 1000, y: (p.y + p.h) * 1000 },
        { x: p.x * 1000, y: (p.y + p.h) * 1000 },
      ],
    };
  }

  // Approximate multi-part rooms with the axis-aligned bounding box ring.
  // Complexity still reflects elongation / fill via boundingFillRatio.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of parts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + p.w);
    maxY = Math.max(maxY, p.y + p.h);
  }
  const area = parts.reduce((s, p) => s + p.w * p.h, 0);
  const boxArea = Math.max(1e-6, (maxX - minX) * (maxY - minY));
  // Encode fill deficiency as extra short notches for the complexity score by
  // using the AABB ring; calculateRoomShapeMetrics will report fill ratio.
  void area;
  void boxArea;
  return {
    outer: [
      { x: minX * 1000, y: minY * 1000 },
      { x: maxX * 1000, y: minY * 1000 },
      { x: maxX * 1000, y: maxY * 1000 },
      { x: minX * 1000, y: maxY * 1000 },
    ],
  };
}

export function roomShapeMetrics(room: RoomRect): RoomShapeMetrics {
  const poly = roomRectToPolygonMm(room);
  const base = calculateRoomShapeMetrics(poly);
  const parts = room.parts ?? [{ x: room.x, y: room.y, w: room.w, h: room.h }];
  if (parts.length <= 1) return base;

  // Penalise multi-part / L-shaped rooms using fill ratio of parts vs AABB.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let area = 0;
  for (const p of parts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + p.w);
    maxY = Math.max(maxY, p.y + p.h);
    area += p.w * p.h;
  }
  const boxArea = Math.max(1e-6, (maxX - minX) * (maxY - minY));
  const fill = area / boxArea;
  const extraParts = parts.length - 1;
  return {
    ...base,
    boundingFillRatio: fill,
    reflexCornerCount: base.reflexCornerCount + extraParts,
    complexityScore:
      base.complexityScore +
      extraParts * 2.5 +
      (1 - fill) * 10,
  };
}

/** Mean normalised shape complexity in [0, ~1+] — lower is better. */
export function planShapeComplexity(rooms: RoomRect[]): number {
  const scored = rooms.filter(
    r =>
      r.category !== 'CORRIDOR' &&
      r.category !== 'ENTRY' &&
      r.category !== 'FOYER' &&
      r.category !== 'BALCONY',
  );
  if (scored.length === 0) return 0;
  let total = 0;
  for (const r of scored) {
    total += roomShapeMetrics(r).complexityScore;
  }
  // Typical rectangular room score ≈ 0; complex L rooms ≈ 8–20.
  return total / (scored.length * 12);
}
