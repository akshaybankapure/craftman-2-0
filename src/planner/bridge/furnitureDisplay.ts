/**
 * Convert spatial-engine / template furniture into metre-space display items
 * for PlanViewer2D.
 */

import type { FurniturePlacement as TemplatePlacement } from '../../engine/furniture/templates.ts';
import type { FurnishingCertificate } from '../../spatial/types.ts';
import type { FloorPlan } from '../types.ts';

export interface DisplayFurniture {
  id: string;
  kind: string;
  roomId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Proven by spatial furnishing certificate vs heuristic template. */
  source: 'spatial' | 'template';
}

function labelKind(kind: string): string {
  return kind
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase());
}

/** Spatial certificate placements (grid cells) → metres. */
export function displayFromSpatialCertificate(
  cert: FurnishingCertificate,
  cellSizeMm: number,
): DisplayFurniture[] {
  const cell = cellSizeMm / 1000;
  const out: DisplayFurniture[] = [];
  for (const room of cert.rooms) {
    for (const p of room.placements) {
      out.push({
        id: p.id,
        kind: labelKind(p.kind),
        roomId: p.roomId,
        x: p.xCell * cell,
        y: p.yCell * cell,
        w: p.widthCells * cell,
        h: p.heightCells * cell,
        source: 'spatial',
      });
    }
  }
  return out;
}

/** Engine template placements (already metres). */
export function displayFromTemplatePlacements(
  placements: TemplatePlacement[],
): DisplayFurniture[] {
  return placements.map((p, i) => ({
    id: `tpl_${p.roomId}_${p.kind}_${i}`,
    kind: labelKind(p.kind),
    roomId: p.roomId,
    x: p.x,
    y: p.y,
    w: p.w,
    h: p.h,
    source: 'template' as const,
  }));
}

/**
 * Prefer spatial certificate furniture; fall back to template placements
 * already stored on the plan debug blob.
 */
export function resolveDisplayFurniture(plan: FloorPlan): DisplayFurniture[] {
  if (plan.furniture && plan.furniture.length > 0) return plan.furniture;

  const cert = plan.debug?.furnishing as FurnishingCertificate | undefined;
  const cellSizeMm =
    Number(plan.debug?.cellSizeMm) ||
    Number((plan.debug?.furnishing as { settings?: { cellSizeMm?: number } })?.settings?.cellSizeMm) ||
    250;

  if (cert?.valid && cert.rooms?.length) {
    return displayFromSpatialCertificate(cert, cellSizeMm);
  }

  const tpl = plan.debug?.templateFurniture as TemplatePlacement[] | undefined;
  if (tpl?.length) return displayFromTemplatePlacements(tpl);

  return [];
}
