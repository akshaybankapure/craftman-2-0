/**
 * Tier-aware furniture / fixture templates (simplified clearances in metres).
 */

import type { MarketTier } from '../context/contextProfile.ts';
import type { AccessNodeCategory, RoomRect } from '../../planner/types.ts';
import { roomArea } from '../../planner/types.ts';

export type FurnitureKind =
  | 'bed'
  | 'wardrobe'
  | 'sofa'
  | 'tvWall'
  | 'fridge'
  | 'sink'
  | 'hob'
  | 'wc'
  | 'basin'
  | 'shower'
  | 'clearance';

export interface FurniturePlacement {
  kind: FurnitureKind;
  roomId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FurnitureConflict {
  roomId: string;
  kind: FurnitureKind;
  message: string;
}

export interface FurnitureValidationResult {
  valid: boolean;
  placements: FurniturePlacement[];
  conflicts: FurnitureConflict[];
  usabilityScore: number;
}

interface TierDims {
  bed: { w: number; h: number };
  wardrobeDepth: number;
  sofa: { w: number; h: number };
  shower: number;
  aisle: number;
}

function tierDims(tier: MarketTier): TierDims {
  switch (tier) {
    case 'premium':
      return {
        bed: { w: 1.8, h: 2.1 },
        wardrobeDepth: 0.6,
        sofa: { w: 2.4, h: 0.9 },
        shower: 1.0,
        aisle: 1.0,
      };
    case 'compact':
      return {
        bed: { w: 1.5, h: 1.9 },
        wardrobeDepth: 0.45,
        sofa: { w: 1.8, h: 0.8 },
        shower: 0.85,
        aisle: 0.9,
      };
    default:
      return {
        bed: { w: 1.6, h: 2.0 },
        wardrobeDepth: 0.55,
        sofa: { w: 2.1, h: 0.85 },
        shower: 0.9,
        aisle: 0.95,
      };
  }
}

export function validateFurniture(
  rooms: RoomRect[],
  tier: MarketTier = 'standard',
): FurnitureValidationResult {
  const dims = tierDims(tier);
  const placements: FurniturePlacement[] = [];
  const conflicts: FurnitureConflict[] = [];
  let score = 0;
  let checks = 0;

  for (const room of rooms) {
    const r = validateRoom(room, dims, placements, conflicts);
    score += r;
    checks++;
  }

  return {
    valid: conflicts.length === 0,
    placements,
    conflicts,
    usabilityScore: checks > 0 ? score / checks : 0,
  };
}

function validateRoom(
  room: RoomRect,
  dims: TierDims,
  placements: FurniturePlacement[],
  conflicts: FurnitureConflict[],
): number {
  const cat = room.category;
  const minSide = Math.min(room.w, room.h);
  const area = roomArea(room);
  let local = 1;

  if (cat === 'BEDROOM') {
    const needW = dims.bed.w + 0.4 + dims.wardrobeDepth;
    const needH = dims.bed.h + 0.45;
    if (minSide < Math.min(needW, needH) * 0.95 || area < dims.bed.w * dims.bed.h + 3) {
      conflicts.push({
        roomId: room.id,
        kind: 'bed',
        message: `Bedroom ${room.id} cannot fit bed + wardrobe clearance (${room.w.toFixed(2)}x${room.h.toFixed(2)})`,
      });
      local = 0;
    } else {
      placements.push({
        kind: 'bed',
        roomId: room.id,
        x: room.x + 0.3,
        y: room.y + 0.3,
        w: dims.bed.w,
        h: dims.bed.h,
      });
      placements.push({
        kind: 'wardrobe',
        roomId: room.id,
        x: room.x + room.w - dims.wardrobeDepth - 0.05,
        y: room.y + 0.2,
        w: dims.wardrobeDepth,
        h: Math.min(room.h - 0.4, 1.8),
      });
    }
  }

  if (cat === 'LIVING') {
    if (minSide < dims.sofa.h + 1.2 || area < 10) {
      conflicts.push({
        roomId: room.id,
        kind: 'sofa',
        message: `Living ${room.id} cannot fit seating zone`,
      });
      local = 0;
    } else {
      const viewMin = 1.8;
      const viewMax = 4.5;
      const alongH = room.h >= room.w;
      const depth = alongH ? room.h : room.w;
      const sofaDepth = dims.sofa.h;
      const clearDepth = depth - sofaDepth - 0.4;
      if (clearDepth > viewMax + 0.3) {
        conflicts.push({
          roomId: room.id,
          kind: 'tvWall',
          message: `Living ${room.id} too deep (${depth.toFixed(1)} m) for sofa–TV viewing`,
        });
        local = 0;
      } else {
        const viewGap = Math.min(viewMax, Math.max(viewMin, clearDepth * 0.55));
        if (alongH) {
          placements.push({
            kind: 'sofa',
            roomId: room.id,
            x: room.x + 0.4,
            y: room.y + 0.4,
            w: Math.min(dims.sofa.w, room.w - 0.8),
            h: sofaDepth,
          });
          placements.push({
            kind: 'tvWall',
            roomId: room.id,
            x: room.x + 0.2,
            y: room.y + 0.4 + sofaDepth + viewGap,
            w: Math.min(2.0, room.w - 0.4),
            h: 0.2,
          });
        } else {
          placements.push({
            kind: 'sofa',
            roomId: room.id,
            x: room.x + 0.4,
            y: room.y + 0.4,
            w: sofaDepth,
            h: Math.min(dims.sofa.w, room.h - 0.8),
          });
          placements.push({
            kind: 'tvWall',
            roomId: room.id,
            x: room.x + 0.4 + sofaDepth + viewGap,
            y: room.y + 0.2,
            w: 0.2,
            h: Math.min(2.0, room.h - 0.4),
          });
        }
      }
    }
  }

  if (cat === 'KITCHEN') {
    const run = Math.max(room.w, room.h);
    if (minSide < dims.aisle || run < 2.4) {
      conflicts.push({
        roomId: room.id,
        kind: 'hob',
        message: `Kitchen ${room.id} cannot fit counter run + aisle`,
      });
      local = 0;
    } else {
      placements.push({
        kind: 'fridge',
        roomId: room.id,
        x: room.x + 0.1,
        y: room.y + 0.1,
        w: 0.6,
        h: 0.65,
      });
      placements.push({
        kind: 'sink',
        roomId: room.id,
        x: room.x + 0.8,
        y: room.y + 0.1,
        w: 0.5,
        h: 0.5,
      });
      placements.push({
        kind: 'hob',
        roomId: room.id,
        x: room.x + 1.5,
        y: room.y + 0.1,
        w: 0.6,
        h: 0.55,
      });
    }
  }

  if (cat === 'COMMON_BATHROOM' || cat === 'ENSUITE_BATHROOM') {
    const shower = dims.shower;
    const need = shower + 0.7 + 0.5; // shower + WC + basin rough
    if (minSide < 1.2 || Math.max(room.w, room.h) < need || area < 3.0) {
      conflicts.push({
        roomId: room.id,
        kind: 'shower',
        message: `Bathroom ${room.id} cannot fit WC + basin + shower`,
      });
      local = 0;
    } else if (Math.max(room.w, room.h) / Math.max(1e-6, minSide) > 2.8) {
      conflicts.push({
        roomId: room.id,
        kind: 'wc',
        message: `Bathroom ${room.id} is an unusable strip for fixtures`,
      });
      local = 0;
    } else {
      placements.push({
        kind: 'wc',
        roomId: room.id,
        x: room.x + 0.15,
        y: room.y + 0.15,
        w: 0.4,
        h: 0.7,
      });
      placements.push({
        kind: 'basin',
        roomId: room.id,
        x: room.x + 0.7,
        y: room.y + 0.15,
        w: 0.5,
        h: 0.4,
      });
      placements.push({
        kind: 'shower',
        roomId: room.id,
        x: room.x + room.w - shower - 0.1,
        y: room.y + room.h - shower - 0.1,
        w: shower,
        h: shower,
      });
    }
  }

  // Silence unused
  void (cat as AccessNodeCategory);
  return local;
}
