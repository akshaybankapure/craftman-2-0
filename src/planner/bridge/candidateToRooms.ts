/**
 * Convert a certified spatial candidate into RoomRect[] using planner topology
 * categories (ids preserved from AccessTree / budgets).
 */

import { cellsToOrthoRects, preferRectangle } from '../../engine/kernel/orthoPolygon.ts';
import { OccupancyGrid, type CertifiedPlan, type RoomType as SpatialRoomType } from '../../spatial/index.ts';
import type { AccessNodeCategory, AccessTree, AreaBudget, CorridorSpine, EntranceDirection, RoomRect } from '../types.ts';
import { categoryToLiveType } from '../types.ts';

const ABSORB_INTO_LIVING: ReadonlySet<SpatialRoomType> = new Set([
  'DINING',
  'STUDY',
  'STORAGE',
  'FAMILY_LOUNGE',
]);

export function spatialTypeToCategory(
  type: SpatialRoomType,
  roomId: string,
  tree?: AccessTree,
): AccessNodeCategory {
  const fromTree = tree?.nodes.find(n => n.id === roomId)?.category;
  if (fromTree) return fromTree;

  switch (type) {
    case 'LIVING':
      return 'LIVING';
    case 'BEDROOM':
      return 'BEDROOM';
    case 'KITCHEN':
      return 'KITCHEN';
    case 'BATHROOM':
      return 'COMMON_BATHROOM';
    case 'ENSUITE':
      return 'ENSUITE_BATHROOM';
    case 'FOYER':
      return 'FOYER';
    case 'PRIVATE_LOBBY':
    case 'CORRIDOR':
      return 'CORRIDOR';
    case 'UTILITY':
      return 'UTILITY';
    default:
      return 'LIVING';
  }
}

/**
 * Grid labels → RoomRect[]. Optional rooms absorbed into Living.
 * Categories taken from AccessTree when provided (so ENTRY stays ENTRY).
 */
export function candidateToRooms(
  certified: CertifiedPlan,
  tree?: AccessTree,
  budgets?: AreaBudget[],
): RoomRect[] {
  const { candidate } = certified;
  const grid = new OccupancyGrid(candidate.grid);
  const cellSizeM = grid.cellSizeMm / 1000;
  const living = candidate.spaces.find(s => s.type === 'LIVING');
  const labels = grid.labels.slice();

  if (living) {
    for (const space of candidate.spaces) {
      if (!ABSORB_INTO_LIVING.has(space.type)) continue;
      for (let i = 0; i < labels.length; i++) {
        if (labels[i] === space.label) labels[i] = living.label;
      }
    }
  }

  const budgetById = new Map(budgets?.map(b => [b.roomId, b]) ?? []);
  const rooms: RoomRect[] = [];

  for (const space of candidate.spaces) {
    if (ABSORB_INTO_LIVING.has(space.type)) continue;
    const cells: number[] = [];
    for (let i = 0; i < labels.length; i++) {
      if (labels[i] === space.label) cells.push(i);
    }
    if (cells.length === 0) continue;

    let parts = cellsToOrthoRects(grid.width, grid.height, cellSizeM, cells);
    parts = preferRectangle(parts);
    if (parts.length === 0) continue;
    parts = [...parts].sort((a, b) => b.w * b.h - a.w * a.h);
    const primary = parts[0]!;
    const category = spatialTypeToCategory(space.type, space.id, tree);
    const budget = budgetById.get(space.id);

    const room: RoomRect = {
      id: space.id,
      category,
      type: categoryToLiveType(category),
      x: primary.x,
      y: primary.y,
      w: primary.w,
      h: primary.h,
      targetArea: budget?.targetArea ?? space.requirement.targetAreaSqM,
      minDimension:
        budget?.minWidth ??
        Math.min(space.requirement.minWidthMm / 1000, primary.w, primary.h),
    };
    if (parts.length > 1) {
      room.parts = parts.map(p => ({ x: p.x, y: p.y, w: p.w, h: p.h }));
    }
    rooms.push(room);
  }

  return rooms;
}

/**
 * Ensure an ENTRY room exists for placeDoors.
 * Prefer FOYER→ENTRY, else carve a strip from Living on the entrance edge.
 */
export function ensureEntryRoom(
  rooms: RoomRect[],
  entranceDir: EntranceDirection,
  outlineW: number,
  outlineH: number,
): string | null {
  const existing = rooms.find(r => r.category === 'ENTRY');
  if (existing) return existing.id;

  const foyer = rooms.find(r => r.category === 'FOYER');
  if (foyer) {
    foyer.category = 'ENTRY';
    foyer.type = 'entry';
    return foyer.id;
  }

  const living = rooms.find(r => r.category === 'LIVING');
  if (!living) return null;

  const depth = Math.min(1.4, Math.max(1.0, Math.min(living.w, living.h) * 0.18));
  let entry: RoomRect | null = null;

  const carveFromParts = (
    pred: (p: { x: number; y: number; w: number; h: number }) => boolean,
    shrink: (p: { x: number; y: number; w: number; h: number }) => {
      x: number;
      y: number;
      w: number;
      h: number;
    } | null,
    entryRect: RoomRect,
  ): boolean => {
    if (!living.parts || living.parts.length === 0) return false;
    const next: Array<{ x: number; y: number; w: number; h: number }> = [];
    let carved = false;
    for (const p of living.parts) {
      if (!pred(p)) {
        next.push(p);
        continue;
      }
      const shrunk = shrink(p);
      carved = true;
      if (shrunk && shrunk.w > 0.4 && shrunk.h > 0.4) next.push(shrunk);
    }
    if (!carved) return false;
    if (next.length === 0) return false;
    living.parts = next.length > 1 ? next : undefined;
    const primary = [...next].sort((a, b) => b.w * b.h - a.w * a.h)[0]!;
    living.x = primary.x;
    living.y = primary.y;
    living.w = primary.w;
    living.h = primary.h;
    rooms.push(entryRect);
    entry = entryRect;
    return true;
  };

  switch (entranceDir) {
    case 'S': {
      const y = living.y + living.h - depth;
      const candidate: RoomRect = {
        id: 'entry_spatial',
        category: 'ENTRY',
        type: 'entry',
        x: living.x,
        y,
        w: living.w,
        h: depth,
        targetArea: living.w * depth,
        minDimension: 1.0,
      };
      if (
        carveFromParts(
          p => Math.abs(p.y + p.h - (living.y + living.h)) < 1e-6 || p.y + p.h >= y - 1e-6,
          p => {
            const newH = Math.min(p.h, Math.max(0, y - p.y));
            return newH > 0.4 ? { ...p, h: newH } : null;
          },
          candidate,
        )
      ) {
        break;
      }
      if (living.h > depth + 1.5) {
        delete living.parts;
        living.h -= depth;
        entry = candidate;
        rooms.push(entry);
      }
      break;
    }
    case 'N': {
      const candidate: RoomRect = {
        id: 'entry_spatial',
        category: 'ENTRY',
        type: 'entry',
        x: living.x,
        y: living.y,
        w: living.w,
        h: depth,
        targetArea: living.w * depth,
        minDimension: 1.0,
      };
      if (
        carveFromParts(
          p => Math.abs(p.y - living.y) < 1e-6 || p.y <= living.y + depth + 1e-6,
          p => {
            const top = Math.max(p.y, living.y + depth);
            const newH = p.y + p.h - top;
            return newH > 0.4 ? { x: p.x, y: top, w: p.w, h: newH } : null;
          },
          candidate,
        )
      ) {
        break;
      }
      if (living.h > depth + 1.5) {
        delete living.parts;
        living.y += depth;
        living.h -= depth;
        entry = candidate;
        rooms.push(entry);
      }
      break;
    }
    case 'W': {
      const candidate: RoomRect = {
        id: 'entry_spatial',
        category: 'ENTRY',
        type: 'entry',
        x: living.x,
        y: living.y,
        w: depth,
        h: living.h,
        targetArea: depth * living.h,
        minDimension: 1.0,
      };
      if (
        carveFromParts(
          p => Math.abs(p.x - living.x) < 1e-6 || p.x <= living.x + depth + 1e-6,
          p => {
            const left = Math.max(p.x, living.x + depth);
            const newW = p.x + p.w - left;
            return newW > 0.4 ? { x: left, y: p.y, w: newW, h: p.h } : null;
          },
          candidate,
        )
      ) {
        break;
      }
      if (living.w > depth + 1.5) {
        delete living.parts;
        living.x += depth;
        living.w -= depth;
        entry = candidate;
        rooms.push(entry);
      }
      break;
    }
    case 'E': {
      const x = living.x + living.w - depth;
      const candidate: RoomRect = {
        id: 'entry_spatial',
        category: 'ENTRY',
        type: 'entry',
        x,
        y: living.y,
        w: depth,
        h: living.h,
        targetArea: depth * living.h,
        minDimension: 1.0,
      };
      if (
        carveFromParts(
          p => Math.abs(p.x + p.w - (living.x + living.w)) < 1e-6 || p.x + p.w >= x - 1e-6,
          p => {
            const newW = Math.min(p.w, Math.max(0, x - p.x));
            return newW > 0.4 ? { ...p, w: newW } : null;
          },
          candidate,
        )
      ) {
        break;
      }
      if (living.w > depth + 1.5) {
        delete living.parts;
        living.w -= depth;
        entry = candidate;
        rooms.push(entry);
      }
      break;
    }
  }

  if (!entry) {
    const strip = 1.2;
    switch (entranceDir) {
      case 'S':
        entry = {
          id: 'entry_spatial',
          category: 'ENTRY',
          type: 'entry',
          x: Math.max(0, outlineW * 0.25),
          y: outlineH - strip,
          w: outlineW * 0.5,
          h: strip,
          targetArea: outlineW * 0.5 * strip,
          minDimension: 1.0,
        };
        break;
      case 'N':
        entry = {
          id: 'entry_spatial',
          category: 'ENTRY',
          type: 'entry',
          x: Math.max(0, outlineW * 0.25),
          y: 0,
          w: outlineW * 0.5,
          h: strip,
          targetArea: outlineW * 0.5 * strip,
          minDimension: 1.0,
        };
        break;
      case 'W':
        entry = {
          id: 'entry_spatial',
          category: 'ENTRY',
          type: 'entry',
          x: 0,
          y: Math.max(0, outlineH * 0.25),
          w: strip,
          h: outlineH * 0.5,
          targetArea: strip * outlineH * 0.5,
          minDimension: 1.0,
        };
        break;
      case 'E':
        entry = {
          id: 'entry_spatial',
          category: 'ENTRY',
          type: 'entry',
          x: outlineW - strip,
          y: Math.max(0, outlineH * 0.25),
          w: strip,
          h: outlineH * 0.5,
          targetArea: strip * outlineH * 0.5,
          minDimension: 1.0,
        };
        break;
    }
    if (entry) rooms.push(entry);
  }

  return entry?.id ?? null;
}

/**
 * Absorb CORRIDOR rooms into Living when corridor is optional (not a separate space).
 * Corridor polygons become living parts so shared walls stay contiguous.
 */
export function absorbOptionalCorridorRooms(rooms: RoomRect[]): RoomRect[] {
  const living = rooms.find(r => r.category === 'LIVING');
  if (!living) return rooms;
  const corridors = rooms.filter(r => r.category === 'CORRIDOR');
  if (corridors.length === 0) return rooms;

  const livingParts = [
    ...(living.parts ?? [{ x: living.x, y: living.y, w: living.w, h: living.h }]),
  ];
  for (const c of corridors) {
    livingParts.push(...(c.parts ?? [{ x: c.x, y: c.y, w: c.w, h: c.h }]));
  }
  living.parts = livingParts.length > 1 ? livingParts : undefined;
  // Keep primary as largest part
  const primary = [...livingParts].sort((a, b) => b.w * b.h - a.w * a.h)[0]!;
  living.x = primary.x;
  living.y = primary.y;
  living.w = primary.w;
  living.h = primary.h;
  living.targetArea = livingParts.reduce((s, p) => s + p.w * p.h, 0);

  return rooms.filter(r => r.category !== 'CORRIDOR');
}

export function livingIntegratedSpineFromRooms(
  rooms: RoomRect[],
  entranceDir: EntranceDirection,
  outlineW: number,
  outlineH: number,
): CorridorSpine {
  const living = rooms.find(r => r.category === 'LIVING');
  const corridor = rooms.filter(r => r.category === 'CORRIDOR');
  const entry = rooms.find(r => r.category === 'ENTRY' || r.category === 'FOYER');

  let entryPoint = { x: outlineW / 2, y: outlineH };
  switch (entranceDir) {
    case 'S':
      entryPoint = {
        x: (entry?.x ?? outlineW / 2) + (entry?.w ?? 0) / 2,
        y: outlineH,
      };
      break;
    case 'N':
      entryPoint = { x: (entry?.x ?? outlineW / 2) + (entry?.w ?? 0) / 2, y: 0 };
      break;
    case 'W':
      entryPoint = { x: 0, y: (entry?.y ?? outlineH / 2) + (entry?.h ?? 0) / 2 };
      break;
    case 'E':
      entryPoint = {
        x: outlineW,
        y: (entry?.y ?? outlineH / 2) + (entry?.h ?? 0) / 2,
      };
      break;
  }

  const livingCenter = living
    ? { x: living.x + living.w / 2, y: living.y + living.h / 2 }
    : { x: outlineW / 2, y: outlineH / 2 };

  return {
    shape: corridor.length > 0 ? 'L' : 'living-integrated',
    width: corridor[0] ? Math.min(corridor[0].w, corridor[0].h) : 1.1,
    centreline: [entryPoint, livingCenter],
    polygons: corridor.flatMap(
      r => r.parts ?? [{ x: r.x, y: r.y, w: r.w, h: r.h }],
    ),
    entryPoint,
  };
}

export function gridOutlineFromCandidate(certified: CertifiedPlan): {
  outlineW: number;
  outlineH: number;
} {
  const grid = certified.candidate.grid;
  const cellSizeM = grid.cellSizeMm / 1000;
  return {
    outlineW: grid.width * cellSizeM,
    outlineH: grid.height * cellSizeM,
  };
}
