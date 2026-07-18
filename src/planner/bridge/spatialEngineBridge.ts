/**
 * Spatial ↔ planner unit/tier/eligibility helpers.
 * Geometry conversion lives in candidateToRooms.ts; topology adapters in topologyAdapter.ts.
 */

import type { MarketTier as ContextTier } from '../../engine/context/contextProfile.ts';
import type { Direction, MarketTier as SpatialTier } from '../../spatial/index.ts';
import type { EntranceDirection, RoomRect } from '../types.ts';

export function isSpatialEngineEligible(
  bhk: number,
  outlineW: number,
  outlineH: number,
  maxBhk = 4,
): boolean {
  if (bhk < 1 || bhk > maxBhk) return false;
  if (!(outlineW > 0) || !(outlineH > 0)) return false;
  return Number.isFinite(outlineW) && Number.isFinite(outlineH);
}

export function entranceToDirection(dir: EntranceDirection): Direction {
  switch (dir) {
    case 'N':
      return 'NORTH';
    case 'S':
      return 'SOUTH';
    case 'E':
      return 'EAST';
    case 'W':
      return 'WEST';
  }
}

export function tierToSpatial(tier: ContextTier): SpatialTier {
  switch (tier) {
    case 'compact':
      return 'COMPACT';
    case 'premium':
      return 'PREMIUM';
    default:
      return 'STANDARD';
  }
}

/** Adaptive cell size: finer for small flats, coarser for large. */
export function adaptiveCellSizeMm(carpetAreaSqM: number, override?: number): number {
  if (override && override > 0) return override;
  if (carpetAreaSqM < 55) return 200;
  if (carpetAreaSqM > 120) return 300;
  return 250;
}

/** Raster helper for furnishing-gate occupancy grids. */
export function roomCellsFromRect(
  room: RoomRect,
  cols: number,
  rows: number,
  cellSizeM: number,
): number[] {
  const parts = room.parts ?? [{ x: room.x, y: room.y, w: room.w, h: room.h }];
  const cells: number[] = [];
  const seen = new Set<number>();
  for (const p of parts) {
    const x0 = Math.max(0, Math.floor(p.x / cellSizeM));
    const y0 = Math.max(0, Math.floor(p.y / cellSizeM));
    const x1 = Math.min(cols, Math.ceil((p.x + p.w) / cellSizeM));
    const y1 = Math.min(rows, Math.ceil((p.y + p.h) / cellSizeM));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const idx = y * cols + x;
        if (!seen.has(idx)) {
          seen.add(idx);
          cells.push(idx);
        }
      }
    }
  }
  return cells;
}
