/**
 * Furnishing / walkability gate using the spatial-engine feasibility solver.
 *
 * - spatialGrid plans: hard-gate on the engine certificate already attached in debug
 * - other geometry engines: soft warning via a rasterised FloorPlan re-proof
 */

import type { ContextProfile } from '../../engine/context/contextProfile.ts';
import {
  FurnishingFeasibilitySolver,
  OccupancyGrid,
  resolveFurnishingSettings,
  type DoorPortal,
  type FurnishingCertificate,
  type MarketTier,
  type NormalizedBrief,
  type RoomRequirement,
  type RoomType,
  type SpaceRegion,
} from '../../spatial/index.ts';
import { roomArea, type FloorPlan, type RoomRect } from '../types.ts';
import { adaptiveCellSizeMm, entranceToDirection, roomCellsFromRect, tierToSpatial } from './spatialEngineBridge.ts';

export interface FurnishingGateResult {
  passed: boolean;
  hard: boolean;
  reasons: string[];
  certificate?: FurnishingCertificate;
  walkableAreaSqM?: number;
}

const CATEGORY_TO_SPATIAL: Record<string, RoomType | null> = {
  LIVING: 'LIVING',
  BEDROOM: 'BEDROOM',
  KITCHEN: 'KITCHEN',
  COMMON_BATHROOM: 'BATHROOM',
  ENSUITE_BATHROOM: 'ENSUITE',
  FOYER: 'FOYER',
  CORRIDOR: 'CORRIDOR',
  UTILITY: 'UTILITY',
  ENTRY: null,
  BALCONY: null,
};

export function evaluateFurnishingGate(
  plan: FloorPlan,
  ctx: ContextProfile,
): FurnishingGateResult {
  const engine = String(plan.debug?.geometryEngine ?? '');
  const hard = engine === 'spatialGrid' || engine === 'spatialPack';

  if (hard) {
    const cert = plan.debug?.furnishing as FurnishingCertificate | undefined;
    if (cert && cert.valid) {
      const walkable = cert.rooms.reduce((s, r) => s + r.connectedWalkableAreaSqM, 0);
      return {
        passed: true,
        hard: true,
        reasons: [],
        certificate: cert,
        walkableAreaSqM: walkable,
      };
    }
    return {
      passed: false,
      hard: true,
      reasons: ['Spatial-pack plan missing furnishing certificate'],
    };
  }

  // Soft path: rasterise and attempt feasibility (never blocks non-spatial yield).
  try {
    const proof = proveFloorPlanFurnishing(plan, ctx);
    return {
      passed: proof.passed,
      hard: false,
      reasons: proof.reasons,
      certificate: proof.certificate,
      walkableAreaSqM: proof.walkableAreaSqM,
    };
  } catch (e) {
    return {
      passed: false,
      hard: false,
      reasons: [e instanceof Error ? e.message : String(e)],
    };
  }
}

export function proveFloorPlanFurnishing(
  plan: FloorPlan,
  ctx: ContextProfile,
): FurnishingGateResult {
  const cellSizeMm = adaptiveCellSizeMm(plan.outlineW * plan.outlineH);
  const cellSizeM = cellSizeMm / 1000;
  const cols = Math.max(1, Math.round(plan.outlineW / cellSizeM));
  const rows = Math.max(1, Math.round(plan.outlineH / cellSizeM));

  const envelopeMask = new Uint8Array(cols * rows);
  envelopeMask.fill(1);
  const labels = new Int16Array(cols * rows);
  labels.fill(-1);

  const spaces: SpaceRegion[] = [];
  let label = 0;
  for (const room of plan.rooms) {
    const spatialType = CATEGORY_TO_SPATIAL[room.category];
    if (!spatialType || spatialType === 'CORRIDOR') continue;
    const cells = roomCellsFromRect(room, cols, rows, cellSizeM);
    if (cells.length === 0) continue;
    for (const idx of cells) {
      if (idx >= 0 && idx < labels.length) labels[idx] = label;
    }
    spaces.push(spaceFromRoom(room, spatialType, label, cells.length, cellSizeMm));
    label++;
  }

  const grid = new OccupancyGrid({
    width: cols,
    height: rows,
    cellSizeMm,
    envelopeMask,
    labels,
  });

  const doors = doorsToPortals(plan, grid);
  const brief = syntheticBrief(plan, ctx, cellSizeMm);
  const solver = new FurnishingFeasibilitySolver();
  const result = solver.solve(brief, grid, spaces, doors);

  if (!result.passed || !result.value) {
    return {
      passed: false,
      hard: false,
      reasons: result.fatalErrors.map(e => e.message).slice(0, 8),
    };
  }

  return {
    passed: true,
    hard: false,
    reasons: [],
    certificate: result.value,
    walkableAreaSqM: result.value.rooms.reduce((s, r) => s + r.connectedWalkableAreaSqM, 0),
  };
}

function spaceFromRoom(
  room: RoomRect,
  type: RoomType,
  label: number,
  cellCount: number,
  cellSizeMm: number,
): SpaceRegion {
  const area = roomArea(room);
  const req: RoomRequirement = {
    id: room.id,
    type,
    minAreaSqM: area * 0.85,
    targetAreaSqM: area,
    maxAreaSqM: area * 1.2,
    minWidthMm: Math.round(room.minDimension * 1000),
    maxSideMm: type === 'BEDROOM' ? 5500 : type === 'LIVING' ? 7000 : 6000,
    preferredAspectRatio: 1.6,
    hardMaxAspectRatio: type === 'BEDROOM' ? 1.85 : type === 'LIVING' ? 2.0 : 2.5,
    exteriorAccess: 'OPTIONAL',
    circulationAllowed: type === 'LIVING' || type === 'FOYER',
    expansionWeight: 1,
  };
  const parts = room.parts ?? [{ x: room.x, y: room.y, w: room.w, h: room.h }];
  const primary = [...parts].sort((a, b) => b.w * b.h - a.w * a.h)[0]!;
  // Union AABB of all parts so soft re-proof matches merged L-shaped living.
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
  const bx = Number.isFinite(minX) ? minX : primary.x;
  const by = Number.isFinite(minY) ? minY : primary.y;
  const bw = Number.isFinite(maxX) ? maxX - bx : primary.w;
  const bh = Number.isFinite(maxY) ? maxY - by : primary.h;
  return {
    id: room.id,
    type,
    label,
    requirement: req,
    seedCell: 0,
    cellCount,
    polygon: {
      outer: [
        { x: bx * 1000, y: by * 1000 },
        { x: (bx + bw) * 1000, y: by * 1000 },
        { x: (bx + bw) * 1000, y: (by + bh) * 1000 },
        { x: bx * 1000, y: (by + bh) * 1000 },
      ],
    },
  };
}

function doorsToPortals(plan: FloorPlan, grid: OccupancyGrid): DoorPortal[] {
  const portals: DoorPortal[] = [];
  for (const d of plan.doors) {
    const midX = ((d.wallStart.x + d.wallEnd.x) / 2) * 1000;
    const midY = ((d.wallStart.y + d.wallEnd.y) / 2) * 1000;
    const cx = Math.min(grid.width - 1, Math.max(0, Math.floor(midX / grid.cellSizeMm)));
    const cy = Math.min(grid.height - 1, Math.max(0, Math.floor(midY / grid.cellSizeMm)));
    const cell = grid.index(cx, cy);
    portals.push({
      id: d.id,
      roomAId: d.roomAId,
      roomBId: d.roomBId === '__EXTERIOR__' ? undefined : d.roomBId,
      boundary: {
        orientation: d.orientation === 'vertical' ? 'V' : 'H',
        fixed: d.orientation === 'vertical' ? midX : midY,
        start: d.orientation === 'vertical'
          ? Math.min(d.wallStart.y, d.wallEnd.y) * 1000
          : Math.min(d.wallStart.x, d.wallEnd.x) * 1000,
        end: d.orientation === 'vertical'
          ? Math.max(d.wallStart.y, d.wallEnd.y) * 1000
          : Math.max(d.wallStart.x, d.wallEnd.x) * 1000,
      },
      centerMm: { x: midX, y: midY },
      widthMm: d.width * 1000,
      cellA: cell,
      exterior: Boolean(d.isEntrance) || d.roomBId === '__EXTERIOR__',
    });
  }
  return portals;
}

function syntheticBrief(
  plan: FloorPlan,
  ctx: ContextProfile,
  cellSizeMm: number,
): NormalizedBrief {
  const tier: MarketTier = tierToSpatial(ctx.tier);
  return {
    carpetAreaSqM: ctx.carpetAreaM2,
    envelope: {
      outer: [
        { x: 0, y: 0 },
        { x: plan.outlineW * 1000, y: 0 },
        { x: plan.outlineW * 1000, y: plan.outlineH * 1000 },
        { x: 0, y: plan.outlineH * 1000 },
      ],
    },
    dimensions: {
      widthMm: Math.round(plan.outlineW * 1000),
      heightMm: Math.round(plan.outlineH * 1000),
    },
    entranceEdge: entranceToDirection(ctx.entranceDir),
    buildingType: 'APARTMENT',
    bhk: Math.min(4, Math.max(1, ctx.bhk)) as 1 | 2 | 3 | 4,
    bathroomCount: Math.max(1, ctx.bathrooms),
    marketTier: tier,
    optionalSpaces: [],
    seed: plan.seed,
    cellSizeMm,
    maxCandidates: 1,
    furnishing: resolveFurnishingSettings(tier, undefined),
  };
}
