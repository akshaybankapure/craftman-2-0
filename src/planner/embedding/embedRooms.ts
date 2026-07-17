import { budgetFor } from '../budget/areaBudget.ts';
import type {
  AccessNodeCategory,
  AccessTree,
  AreaBudget,
  CorridorSpine,
  EntranceDirection,
  LiveRoomType,
  RoomRect,
} from '../types.ts';
import { categoryToLiveType } from '../types.ts';
import { RNG } from '../rng.ts';

export interface EmbedInput {
  tree: AccessTree;
  budgets: AreaBudget[];
  spine: CorridorSpine;
  entryRect: { x: number; y: number; w: number; h: number };
  foyerRect: { x: number; y: number; w: number; h: number } | null;
  corridorRects: Array<{ x: number; y: number; w: number; h: number }>;
  outlineW: number;
  outlineH: number;
  entranceDir: EntranceDirection;
  seed: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Strict axis-aligned tiling around a corridor spine.
 * Guarantees non-overlap and corridor contact for private/public zones.
 */
export function embedRooms(input: EmbedInput): RoomRect[] {
  const { entranceDir } = input;
  if (entranceDir === 'E' || entranceDir === 'W') {
    return embedEW(input);
  }
  return embedNS(input);
}

function embedNS(input: EmbedInput): RoomRect[] {
  const { tree, budgets, outlineW: W, outlineH: H, entranceDir, seed } = input;
  const rng = new RNG(seed);
  const fromS = entranceDir === 'S';
  const rooms: RoomRect[] = [];

  const entry = must(tree, 'ENTRY');
  const foyer = optional(tree, 'FOYER');
  const corr = must(tree, 'CORRIDOR');
  const living = must(tree, 'LIVING');
  const kitchen = must(tree, 'KITCHEN');
  const bedrooms = all(tree, 'BEDROOM');
  const commonBaths = all(tree, 'COMMON_BATHROOM');
  const ensuites = all(tree, 'ENSUITE_BATHROOM');
  const utility = optional(tree, 'UTILITY');

  const corrW = 1.05;
  const entryB = budgetFor(budgets, entry.id);
  // Keep circulation pocket shallow so side rooms retain height for min areas
  const entryDepth = clamp(Math.max(entryB.minArea / corrW, 1.45), 1.45, 1.7);
  const foyerDepth = foyer
    ? clamp(Math.max(budgetFor(budgets, foyer.id).minArea / corrW, 1.45), 1.45, 1.6)
    : 0;
  const circDepth = entryDepth + foyerDepth;

  // Leave a wide private band (≥3.5m). On narrow outlines, pin corridor off-centre.
  const minBand = Math.min(3.8, (W - corrW) * 0.55);
  const corrX = clamp(
    W * (0.45 + (rng.next() - 0.5) * 0.08),
    minBand,
    W - corrW - minBand,
  );

  // Corridor in centre column, stopping at foyer/entry pocket
  const corrY = fromS ? 0 : circDepth;
  const corrH = H - circDepth;
  rooms.push(rectRoom(corr.id, 'CORRIDOR', { x: corrX, y: corrY, w: corrW, h: corrH }, budgets, true));

  // Entry / foyer only in corridor column — side zones use full height
  if (fromS) {
    if (foyer) {
      rooms.push(rectRoom(foyer.id, 'FOYER', { x: corrX, y: H - circDepth, w: corrW, h: foyerDepth }, budgets));
    }
    rooms.push(rectRoom(entry.id, 'ENTRY', { x: corrX, y: H - entryDepth, w: corrW, h: entryDepth }, budgets));
  } else {
    rooms.push(rectRoom(entry.id, 'ENTRY', { x: corrX, y: 0, w: corrW, h: entryDepth }, budgets));
    if (foyer) {
      rooms.push(rectRoom(foyer.id, 'FOYER', { x: corrX, y: entryDepth, w: corrW, h: foyerDepth }, budgets));
    }
  }

  // Side zones ONLY beside the corridor segment (not beside entry/foyer),
  // so every private room shares ≥1.0m with the corridor.
  const left: Rect = { x: 0, y: corrY, w: corrX, h: corrH };
  const right: Rect = { x: corrX + corrW, y: corrY, w: W - corrX - corrW, h: corrH };

  // Private (beds + common baths) on one side, public (living + kitchen) on the other
  const privateOnLeft = rng.bool(0.55);
  const privateZone = privateOnLeft ? left : right;
  let publicZone = privateOnLeft ? right : left;

  type Item = { id: string; cat: AccessNodeCategory; weight: number; ensuiteId?: string };
  const privateItems: Item[] = [];
  for (const bed of bedrooms) {
    const en = ensuites.find(e => e.attachedTo === bed.id);
    privateItems.push({
      id: bed.id,
      cat: 'BEDROOM',
      weight: budgetFor(budgets, bed.id).targetArea + (en ? budgetFor(budgets, en.id).targetArea : 0),
      ensuiteId: en?.id,
    });
  }
  for (const bath of commonBaths) {
    privateItems.push({
      id: bath.id,
      cat: 'COMMON_BATHROOM',
      weight: Math.max(budgetFor(budgets, bath.id).targetArea, 3.5),
    });
  }

  stackVertical(privateZone, privateItems, budgets, rooms, /*ensuiteTowardCorridor*/ !privateOnLeft);

  // Public: kitchen + living (living abuts corridor for topology)
  const kitB = budgetFor(budgets, kitchen.id);
  const kitH = clamp(
    publicZone.h * (kitB.targetArea / (kitB.targetArea + budgetFor(budgets, living.id).targetArea)),
    kitB.minHeight,
    publicZone.h * 0.4,
  );
  const kitchenRect: Rect = fromS
    ? { x: publicZone.x, y: publicZone.y, w: publicZone.w, h: kitH }
    : { x: publicZone.x, y: publicZone.y + publicZone.h - kitH, w: publicZone.w, h: kitH };

  if (utility) {
    const uw = clamp(publicZone.w * 0.3, budgetFor(budgets, utility.id).minWidth, publicZone.w * 0.4);
    rooms.push(rectRoom(kitchen.id, 'KITCHEN', { x: kitchenRect.x, y: kitchenRect.y, w: kitchenRect.w - uw, h: kitchenRect.h }, budgets));
    rooms.push(rectRoom(utility.id, 'UTILITY', { x: kitchenRect.x + kitchenRect.w - uw, y: kitchenRect.y, w: uw, h: kitchenRect.h }, budgets));
  } else {
    rooms.push(rectRoom(kitchen.id, 'KITCHEN', kitchenRect, budgets));
  }

  const livingRect: Rect = fromS
    ? { x: publicZone.x, y: publicZone.y + kitH, w: publicZone.w, h: publicZone.h - kitH }
    : { x: publicZone.x, y: publicZone.y, w: publicZone.w, h: publicZone.h - kitH };
  if (fromS) {
    livingRect.h = H - livingRect.y;
  } else {
    livingRect.y = Math.max(0, livingRect.y - circDepth);
    livingRect.h += circDepth;
  }
  rooms.push(rectRoom(living.id, 'LIVING', livingRect, budgets));

  return rooms;
}

function embedEW(input: EmbedInput): RoomRect[] {
  const { tree, budgets, outlineW: W, outlineH: H, entranceDir, seed } = input;
  const rng = new RNG(seed);
  const fromW = entranceDir === 'W';
  const rooms: RoomRect[] = [];

  const entry = must(tree, 'ENTRY');
  const foyer = optional(tree, 'FOYER');
  const corr = must(tree, 'CORRIDOR');
  const living = must(tree, 'LIVING');
  const kitchen = must(tree, 'KITCHEN');
  const bedrooms = all(tree, 'BEDROOM');
  const commonBaths = all(tree, 'COMMON_BATHROOM');
  const ensuites = all(tree, 'ENSUITE_BATHROOM');
  const utility = optional(tree, 'UTILITY');

  const corrW = 1.05;
  const entryDepth = clamp(Math.max(budgetFor(budgets, entry.id).minArea / corrW, 1.45), 1.45, 1.7);
  const foyerDepth = foyer
    ? clamp(Math.max(budgetFor(budgets, foyer.id).minArea / corrW, 1.45), 1.45, 1.6)
    : 0;
  const circDepth = entryDepth + foyerDepth;

  const corrX = fromW ? circDepth : 0;
  const corrLen = W - circDepth;
  const minBand = Math.min(3.2, (H - corrW) * 0.45);
  const corrY = clamp(H * (0.4 + (rng.next() - 0.5) * 0.06), minBand, H - corrW - minBand);

  rooms.push(rectRoom(corr.id, 'CORRIDOR', { x: corrX, y: corrY, w: corrLen, h: corrW }, budgets, true));

  if (fromW) {
    rooms.push(rectRoom(entry.id, 'ENTRY', { x: 0, y: corrY, w: entryDepth, h: corrW }, budgets));
    if (foyer) {
      rooms.push(rectRoom(foyer.id, 'FOYER', { x: entryDepth, y: corrY, w: foyerDepth, h: corrW }, budgets));
    }
  } else {
    rooms.push(rectRoom(entry.id, 'ENTRY', { x: W - entryDepth, y: corrY, w: entryDepth, h: corrW }, budgets));
    if (foyer) {
      rooms.push(rectRoom(foyer.id, 'FOYER', { x: W - circDepth, y: corrY, w: foyerDepth, h: corrW }, budgets));
    }
  }

  const top: Rect = { x: corrX, y: 0, w: corrLen, h: corrY };
  const bottom: Rect = { x: corrX, y: corrY + corrW, w: corrLen, h: H - corrY - corrW };
  const privateOnTop = rng.bool(0.55);
  const privateZone = privateOnTop ? top : bottom;
  const publicZone = privateOnTop ? bottom : top;

  type Item = { id: string; cat: AccessNodeCategory; weight: number; ensuiteId?: string };
  const privateItems: Item[] = [];
  for (const bed of bedrooms) {
    const en = ensuites.find(e => e.attachedTo === bed.id);
    privateItems.push({
      id: bed.id,
      cat: 'BEDROOM',
      weight: budgetFor(budgets, bed.id).targetArea + (en ? budgetFor(budgets, en.id).targetArea : 0),
      ensuiteId: en?.id,
    });
  }
  for (const bath of commonBaths) {
    privateItems.push({
      id: bath.id,
      cat: 'COMMON_BATHROOM',
      weight: Math.max(budgetFor(budgets, bath.id).targetArea, 3.5),
    });
  }

  stackHorizontal(privateZone, privateItems, budgets, rooms);

  const kitB = budgetFor(budgets, kitchen.id);
  const kitW = clamp(
    publicZone.w * (kitB.targetArea / (kitB.targetArea + budgetFor(budgets, living.id).targetArea)),
    kitB.minWidth,
    publicZone.w * 0.4,
  );
  // Kitchen away from entrance (toward far end of corridor)
  const kitchenRect: Rect = fromW
    ? { x: publicZone.x + publicZone.w - kitW, y: publicZone.y, w: kitW, h: publicZone.h }
    : { x: publicZone.x, y: publicZone.y, w: kitW, h: publicZone.h };

  if (utility) {
    const uh = clamp(publicZone.h * 0.3, budgetFor(budgets, utility.id).minHeight, publicZone.h * 0.4);
    rooms.push(rectRoom(utility.id, 'UTILITY', { x: kitchenRect.x, y: kitchenRect.y, w: kitchenRect.w, h: uh }, budgets));
    rooms.push(rectRoom(kitchen.id, 'KITCHEN', { x: kitchenRect.x, y: kitchenRect.y + uh, w: kitchenRect.w, h: kitchenRect.h - uh }, budgets));
  } else {
    rooms.push(rectRoom(kitchen.id, 'KITCHEN', kitchenRect, budgets));
  }

  const livingRect: Rect = fromW
    ? { x: publicZone.x, y: publicZone.y, w: publicZone.w - kitW, h: publicZone.h }
    : { x: publicZone.x + kitW, y: publicZone.y, w: publicZone.w - kitW, h: publicZone.h };

  // Absorb entrance-side pocket beside entry into living
  if (fromW) {
    livingRect.x = 0;
    livingRect.w = (publicZone.x + publicZone.w - kitW);
  } else {
    livingRect.w = W - livingRect.x;
  }
  rooms.push(rectRoom(living.id, 'LIVING', livingRect, budgets));

  return rooms;
}

function stackVertical(
  zone: Rect,
  items: { id: string; cat: AccessNodeCategory; weight: number; ensuiteId?: string }[],
  budgets: AreaBudget[],
  rooms: RoomRect[],
  ensuiteOnRight: boolean,
): void {
  if (items.length === 0) return;

  // Allocate heights with hard minima so corridor contact ≥ 1.5m for baths
  const mins = items.map(item => {
    if (item.cat === 'COMMON_BATHROOM') return 1.5;
    if (item.ensuiteId) return 2.5;
    return 2.4;
  });
  const minSum = mins.reduce((s, m) => s + m, 0);
  const weights = items.map(i => i.weight);
  const totalW = weights.reduce((s, w) => s + w, 0) || 1;
  let heights: number[];
  if (minSum >= zone.h - 0.01) {
    heights = mins.map(m => (m / minSum) * zone.h);
  } else {
    const extra = zone.h - minSum;
    heights = items.map((item, i) => mins[i] + extra * (weights[i] / totalW));
  }

  let y = zone.y;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const h = i === items.length - 1 ? zone.y + zone.h - y : heights[i];
    const slot: Rect = { x: zone.x, y, w: zone.w, h };
    if (item.ensuiteId) {
      const eb = budgetFor(budgets, item.ensuiteId);
      const ew = clamp(Math.max(eb.minWidth, eb.minArea / Math.max(1.5, h)), eb.minWidth, zone.w * 0.38);
      const eh = Math.min(h, Math.max(eb.minHeight, eb.minArea / ew));
      const ensuiteRect: Rect = ensuiteOnRight
        ? { x: slot.x + slot.w - ew, y: slot.y, w: ew, h: eh }
        : { x: slot.x, y: slot.y, w: ew, h: eh };
      const bedRect: Rect = ensuiteOnRight
        ? { x: slot.x, y: slot.y, w: slot.w - ew, h: slot.h }
        : { x: slot.x + ew, y: slot.y, w: slot.w - ew, h: slot.h };
      rooms.push(rectRoom(item.id, item.cat, bedRect, budgets));
      rooms.push(rectRoom(item.ensuiteId, 'ENSUITE_BATHROOM', ensuiteRect, budgets));
    } else {
      rooms.push(rectRoom(item.id, item.cat, slot, budgets));
    }
    y += h;
  }
}

function stackHorizontal(
  zone: Rect,
  items: { id: string; cat: AccessNodeCategory; weight: number; ensuiteId?: string }[],
  budgets: AreaBudget[],
  rooms: RoomRect[],
): void {
  if (items.length === 0) return;

  const mins = items.map(item => {
    if (item.cat === 'COMMON_BATHROOM') return 1.5;
    if (item.ensuiteId) return 3.2;
    return 2.8;
  });
  const minSum = mins.reduce((s, m) => s + m, 0);
  const weights = items.map(i => i.weight);
  const totalW = weights.reduce((s, w) => s + w, 0) || 1;
  let widths: number[];
  if (minSum >= zone.w - 0.01) {
    widths = mins.map(m => (m / minSum) * zone.w);
  } else {
    const extra = zone.w - minSum;
    widths = items.map((_, i) => mins[i] + extra * (weights[i] / totalW));
  }

  let x = zone.x;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const w = i === items.length - 1 ? zone.x + zone.w - x : widths[i];
    const slot: Rect = { x, y: zone.y, w, h: zone.h };
    if (item.ensuiteId) {
      // Carve ensuite beside bed so bedroom keeps full band height for area
      const eb = budgetFor(budgets, item.ensuiteId);
      const ew = clamp(Math.max(eb.minWidth, eb.minArea / Math.max(1.5, zone.h)), eb.minWidth, slot.w * 0.38);
      const ensuiteRect: Rect = { x: slot.x, y: slot.y, w: ew, h: slot.h };
      const bedRect: Rect = { x: slot.x + ew, y: slot.y, w: slot.w - ew, h: slot.h };
      rooms.push(rectRoom(item.id, item.cat, bedRect, budgets));
      rooms.push(rectRoom(item.ensuiteId, 'ENSUITE_BATHROOM', ensuiteRect, budgets));
    } else {
      rooms.push(rectRoom(item.id, item.cat, slot, budgets));
    }
    x += w;
  }
}

function rectRoom(
  id: string,
  category: AccessNodeCategory,
  rect: Rect,
  budgets: AreaBudget[],
  parts = false,
): RoomRect {
  const b = budgetFor(budgets, id);
  const r: RoomRect = {
    id,
    category,
    type: categoryToLiveType(category) as LiveRoomType,
    x: round(rect.x),
    y: round(rect.y),
    w: round(rect.w),
    h: round(rect.h),
    targetArea: b.targetArea,
    minDimension: Math.min(b.minWidth, b.minHeight),
  };
  if (parts) r.parts = [{ x: r.x, y: r.y, w: r.w, h: r.h }];
  return r;
}

function must(tree: AccessTree, cat: AccessNodeCategory) {
  const n = tree.nodes.find(x => x.category === cat);
  if (!n) throw new Error(`Missing ${cat}`);
  return n;
}
function optional(tree: AccessTree, cat: AccessNodeCategory) {
  return tree.nodes.find(x => x.category === cat);
}
function all(tree: AccessTree, cat: AccessNodeCategory) {
  return tree.nodes.filter(x => x.category === cat);
}
function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
function round(n: number) {
  return Math.round(n * 1000) / 1000;
}

export function sharesWall(a: Rect, b: Rect, minOverlap = 0.8): boolean {
  const eps = 0.06;
  if (Math.abs(a.x + a.w - b.x) < eps || Math.abs(b.x + b.w - a.x) < eps) {
    const y1 = Math.max(a.y, b.y);
    const y2 = Math.min(a.y + a.h, b.y + b.h);
    if (y2 - y1 >= minOverlap) return true;
  }
  if (Math.abs(a.y + a.h - b.y) < eps || Math.abs(b.y + b.h - a.y) < eps) {
    const x1 = Math.max(a.x, b.x);
    const x2 = Math.min(a.x + a.w, b.x + b.w);
    if (x2 - x1 >= minOverlap) return true;
  }
  return false;
}
