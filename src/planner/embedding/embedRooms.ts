import { budgetFor } from '../budget/areaBudget.ts';
import {
  bedroomWidthCap,
  livingDepthCap,
  maxPrivateWingWidth,
  maxPublicWingWidth,
} from '../geometry/habitableProportions.ts';
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

/**
 * Layout styles = parametric presets. All keep corridor-touching rooms
 * so topology doors remain placeable.
 */
export type LayoutStyle =
  | 'classic'
  | 'offset'
  | 'livingFront'
  | 'wetCluster'
  | 'splitWings'
  | 'gallery';

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
  layoutStyle?: LayoutStyle;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Item = { id: string; cat: AccessNodeCategory; weight: number; ensuiteId?: string };

interface LayoutParams {
  /** Corridor lateral bias along the long axis of the building. */
  corrBias: 'farLeft' | 'left' | 'center' | 'right' | 'farRight';
  /** Kitchen placement relative to living. */
  kitchenMode: 'stripEntrance' | 'stripDeep' | 'sideCorridor' | 'sideOuter';
  /** Where common baths sit in the private stack. */
  bathOrder: 'entrance' | 'deep' | 'middle' | 'interleave';
  /** Put one bedroom on the public wing (guest suite). */
  guestWing: boolean;
  /** Cluster common baths next to kitchen on the public wing. */
  wetOnPublic: boolean;
  /** Absorb entrance pocket into living when kitchen is deep. */
  livingPocket: boolean;
}

const STYLES: LayoutStyle[] = [
  'classic',
  'offset',
  'livingFront',
  'wetCluster',
  'splitWings',
  'gallery',
];

export function pickLayoutStyle(seed: number, variant = 0): LayoutStyle {
  const rng = new RNG(seed ^ (variant * 7919));
  return rng.pick(STYLES);
}

function paramsForStyle(style: LayoutStyle, rng: RNG): LayoutParams {
  switch (style) {
    case 'offset':
      return {
        corrBias: rng.bool() ? 'farLeft' : 'farRight',
        kitchenMode: rng.pick(['stripDeep', 'stripEntrance', 'sideCorridor'] as const),
        bathOrder: rng.pick(['deep', 'entrance', 'interleave'] as const),
        guestWing: false,
        wetOnPublic: false,
        livingPocket: true,
      };
    case 'livingFront':
      return {
        corrBias: rng.pick(['left', 'center', 'right'] as const),
        kitchenMode: rng.pick(['stripEntrance', 'sideOuter'] as const),
        bathOrder: rng.pick(['deep', 'middle'] as const),
        guestWing: false,
        wetOnPublic: false,
        livingPocket: false,
      };
    case 'wetCluster':
      return {
        // Keep wings balanced — extreme corridor bias creates bowling-alley bedrooms
        corrBias: rng.bool() ? 'left' : 'right',
        kitchenMode: 'stripDeep',
        bathOrder: 'deep',
        guestWing: false,
        wetOnPublic: true,
        livingPocket: true,
      };
    case 'splitWings':
      return {
        // Asymmetric but capped: public wing wide enough for living + guest
        corrBias: rng.bool() ? 'left' : 'right',
        kitchenMode: rng.pick(['sideCorridor', 'stripDeep'] as const),
        bathOrder: 'deep',
        guestWing: true,
        wetOnPublic: false,
        livingPocket: true,
      };
    case 'gallery':
      return {
        corrBias: rng.pick(['left', 'right'] as const),
        kitchenMode: rng.pick(['sideCorridor', 'sideOuter'] as const),
        bathOrder: rng.pick(['interleave', 'middle'] as const),
        guestWing: false,
        wetOnPublic: false,
        livingPocket: true,
      };
    case 'classic':
    default:
      return {
        corrBias: rng.pick(['left', 'center', 'right'] as const),
        kitchenMode: rng.pick(['stripDeep', 'stripEntrance'] as const),
        bathOrder: rng.pick(['deep', 'entrance', 'interleave'] as const),
        guestWing: false,
        wetOnPublic: false,
        livingPocket: true,
      };
  }
}

export function embedRooms(input: EmbedInput): RoomRect[] {
  const style = input.layoutStyle ?? pickLayoutStyle(input.seed);
  if (input.entranceDir === 'E' || input.entranceDir === 'W') {
    return embedEW(input, style);
  }
  return embedNS(input, style);
}

function embedNS(input: EmbedInput, style: LayoutStyle): RoomRect[] {
  const { tree, budgets, outlineW: W, outlineH: H, entranceDir, seed } = input;
  const rng = new RNG(seed);
  const params = paramsForStyle(style, rng);
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

  const corrW = rng.bool(0.4) ? 1.15 : 1.05;
  const entryDepth = clamp(Math.max(budgetFor(budgets, entry.id).minArea / corrW, 1.45), 1.45, 1.75);
  const foyerDepth = foyer
    ? clamp(Math.max(budgetFor(budgets, foyer.id).minArea / corrW, 1.45), 1.45, 1.65)
    : 0;
  const circDepth = entryDepth + foyerDepth;

  const minBand = Math.min(3.4, (W - corrW) * 0.42);
  const corrFrac = biasToFrac(params.corrBias, rng);
  let corrX = clamp(W * corrFrac, minBand, W - corrW - minBand);
  const corrY = fromS ? 0 : circDepth;
  const corrH = H - circDepth;

  // Preferred private side from style (lock before rebalancing wing widths).
  let privateOnLeft: boolean;
  if (params.corrBias === 'farLeft' || params.corrBias === 'left') {
    privateOnLeft = false;
  } else if (params.corrBias === 'farRight' || params.corrBias === 'right') {
    privateOnLeft = true;
  } else {
    privateOnLeft = rng.bool();
  }
  // Guest-wing styles: private on the smaller wing so living gets width.
  if (params.guestWing) {
    privateOnLeft = corrX <= W - corrX - corrW;
  }

  const maxPrivW = maxPrivateWingWidth(bedrooms.length, corrH);
  const livB = budgetFor(budgets, living.id);
  // Size public wing from living max area so strip embed cannot dump the
  // whole remaining carpet into a 60+ m² hall.
  const maxPubFromLiving = Math.max(
    3.6,
    livB.maxArea / Math.max(3.2, corrH * 0.55) + 1.2,
  );
  const maxPubW = Math.min(
    Math.max(maxPublicWingWidth(corrH), params.guestWing ? 4.2 : 3.6),
    maxPubFromLiving,
  );
  if (privateOnLeft) {
    if (corrX > maxPrivW) corrX = maxPrivW;
    if (W - corrX - corrW > maxPubW) corrX = Math.max(minBand, W - corrW - maxPubW);
    if (corrX > maxPrivW) corrX = maxPrivW;
  } else {
    if (W - corrX - corrW > maxPrivW) corrX = Math.max(minBand, W - corrW - maxPrivW);
    if (corrX > maxPubW) corrX = Math.min(maxPubW, W - corrW - minBand);
    if (W - corrX - corrW > maxPrivW) corrX = Math.max(minBand, W - corrW - maxPrivW);
  }
  corrX = clamp(corrX, minBand, W - corrW - minBand);

  rooms.push(rectRoom(corr.id, 'CORRIDOR', { x: corrX, y: corrY, w: corrW, h: corrH }, budgets, true));
  placeEntryFoyerNS(rooms, entry, foyer, budgets, corrX, corrW, entryDepth, foyerDepth, circDepth, H, fromS);

  const left: Rect = { x: 0, y: corrY, w: corrX, h: corrH };
  const right: Rect = { x: corrX + corrW, y: corrY, w: W - corrX - corrW, h: corrH };
  if (params.guestWing) {
    privateOnLeft = left.w <= right.w;
  }

  let bedItems = bedrooms.map(bed => {
    const en = ensuites.find(e => e.attachedTo === bed.id);
    return {
      id: bed.id,
      cat: 'BEDROOM' as AccessNodeCategory,
      weight: budgetFor(budgets, bed.id).targetArea + (en ? budgetFor(budgets, en.id).targetArea : 0),
      ensuiteId: en?.id,
    };
  });
  let bathItems = commonBaths.map(bath => ({
    id: bath.id,
    cat: 'COMMON_BATHROOM' as AccessNodeCategory,
    weight: Math.max(budgetFor(budgets, bath.id).targetArea, 3.5),
  }));
  if (rng.bool(0.75)) bedItems = rng.shuffle(bedItems);
  if (rng.bool(0.5)) bathItems = rng.shuffle(bathItems);

  let privateZone = privateOnLeft ? left : right;
  let publicZone = privateOnLeft ? right : left;

  // Guest wing: ensuite bedroom on public wing (height-stacked so both touch corridor)
  const livingMin = Math.max(budgetFor(budgets, living.id).minHeight, 3.0);
  let guestItem: Item | null = null;
  const canGuest =
    params.guestWing &&
    bedItems.length >= 2 &&
    publicZone.w >= 3.2 &&
    publicZone.h >= livingMin + 2.7;
  if (canGuest) {
    const ensuiteBed = bedItems.find(b => b.ensuiteId);
    guestItem = ensuiteBed ?? bedItems[bedItems.length - 1];
    bedItems = bedItems.filter(b => b !== guestItem);
  } else if (params.guestWing && left.w !== right.w) {
    // Fallback: keep all beds on the larger wing (no guest split)
    privateOnLeft = left.w > right.w;
    privateZone = privateOnLeft ? left : right;
    publicZone = privateOnLeft ? right : left;
  }

  // Wet cluster only when public height can fit bath + kitchen mins + living min
  const kitMinH = Math.max(budgetFor(budgets, kitchen.id).minHeight, 2.1);
  const wetNeed = bathItems.length * 1.55 + kitMinH + livingMin;
  let wetOnPublic =
    params.wetOnPublic && bathItems.length > 0 && publicZone.h + (params.livingPocket ? circDepth : 0) >= wetNeed + 0.2;
  // Prefer wet-on-public whenever the private stack would starve bedroom height
  if (
    bathItems.length > 0 &&
    publicZone.h + (params.livingPocket ? circDepth : 0) >= wetNeed + 0.2
  ) {
    const privateCount = bedItems.length + (wetOnPublic ? 0 : bathItems.length);
    if (bedItems.length >= 3 || privateZone.h / Math.max(1, privateCount) < 2.6) {
      wetOnPublic = true;
    }
  }
  const privateBaths = wetOnPublic ? [] : bathItems;
  const publicBaths = wetOnPublic ? bathItems : [];

  const privateItems = orderPrivateStack(bedItems, privateBaths, params.bathOrder, rng);
  stackVertical(privateZone, privateItems, budgets, rooms, !privateOnLeft, rng);

  packPublicNS({
    rooms,
    publicZone,
    budgets,
    living,
    kitchen,
    utility,
    fromS,
    H,
    circDepth,
    kitchenMode: params.kitchenMode,
    livingPocket: params.livingPocket,
    guestItem,
    publicBaths,
    privateOnLeft,
    rng,
  });

  return rooms;
}

function packPublicNS(opts: {
  rooms: RoomRect[];
  publicZone: Rect;
  budgets: AreaBudget[];
  living: { id: string };
  kitchen: { id: string };
  utility?: { id: string };
  fromS: boolean;
  H: number;
  circDepth: number;
  kitchenMode: LayoutParams['kitchenMode'];
  livingPocket: boolean;
  guestItem: Item | null;
  publicBaths: Item[];
  privateOnLeft: boolean;
  rng: RNG;
}): void {
  const {
    rooms, publicZone, budgets, living, kitchen, utility, fromS, H, circDepth,
    livingPocket, guestItem, publicBaths, privateOnLeft, rng,
  } = opts;
  let kitchenMode = opts.kitchenMode;

  let zone = { ...publicZone };
  const livingMin = Math.max(budgetFor(budgets, living.id).minHeight, 3.0);

  // Guest bedroom at deep end (full width → touches corridor); living keeps entrance half
  if (guestItem) {
    const guestH = clamp(zone.h * 0.4, 2.7, zone.h - livingMin);
    const guestRect: Rect = fromS
      ? { x: zone.x, y: zone.y, w: zone.w, h: guestH }
      : { x: zone.x, y: zone.y + zone.h - guestH, w: zone.w, h: guestH };
    stackVertical(guestRect, [guestItem], budgets, rooms, privateOnLeft, rng);
    zone = fromS
      ? { x: zone.x, y: zone.y + guestH, w: zone.w, h: zone.h - guestH }
      : { x: zone.x, y: zone.y, w: zone.w, h: zone.h - guestH };
    // Remaining band is short — force side-by-side kitchen so living keeps height
    if (zone.h < livingMin + 2.2) {
      kitchenMode = zone.w >= 5.0 ? 'sideCorridor' : kitchenMode;
    }
  }

  // Wet cluster: baths + kitchen at deep end. Wide wings use a side-by-side
  // wet block so baths/kitchens are not full-width bowling strips.
  if (publicBaths.length > 0) {
    const kitB = budgetFor(budgets, kitchen.id);
    const bathMin = publicBaths.length * 1.55;
    const kitMin = Math.max(kitB.minHeight, 2.1);
    const pocketBonus = livingPocket ? circDepth : 0;
    const maxWet = zone.h + pocketBonus - livingMin;
    const livCap = livingDepthCap(zone.w);
    const preferWet = Math.max(zone.h - livCap, Math.max(bathMin, kitMin));
    const wetH = clamp(preferWet, Math.max(bathMin, kitMin), Math.min(zone.h * 0.7, maxWet));
    const wetZone: Rect = fromS
      ? { x: zone.x, y: zone.y, w: zone.w, h: wetH }
      : { x: zone.x, y: zone.y + zone.h - wetH, w: zone.w, h: wetH };

    const useSideBySide = wetZone.w >= 4.2;
    if (useSideBySide) {
      const bathW = clamp(bathMin, 1.7 * publicBaths.length, Math.min(3.0, wetZone.w * 0.42));
      const bathsOnCorridor = !privateOnLeft; // corridor is on the private-facing side of public zone
      // privateOnLeft false → public is left, corridor on right of public → baths against corridor (right)
      const bathAgainstCorridor = privateOnLeft
        ? { x: wetZone.x, y: wetZone.y, w: bathW, h: wetH } // corridor on left of public
        : { x: wetZone.x + wetZone.w - bathW, y: wetZone.y, w: bathW, h: wetH };
      void bathsOnCorridor;
      const kitZone: Rect = privateOnLeft
        ? { x: wetZone.x + bathW, y: wetZone.y, w: wetZone.w - bathW, h: wetH }
        : { x: wetZone.x, y: wetZone.y, w: wetZone.w - bathW, h: wetH };
      stackVertical(bathAgainstCorridor, publicBaths, budgets, rooms, privateOnLeft, rng);
      placeKitchenInRect(rooms, kitchen.id, utility, kitZone, budgets, fromS, rng);
    } else {
      const bathH = Math.min(bathMin, wetH - kitMin);
      const kitH = wetH - bathH;
      const bathZone: Rect = fromS
        ? { x: wetZone.x, y: wetZone.y, w: wetZone.w, h: bathH }
        : { x: wetZone.x, y: wetZone.y + wetZone.h - bathH, w: wetZone.w, h: bathH };
      const kitZone: Rect = fromS
        ? { x: wetZone.x, y: wetZone.y + bathH, w: wetZone.w, h: kitH }
        : { x: wetZone.x, y: wetZone.y, w: wetZone.w, h: kitH };
      stackVertical(bathZone, publicBaths, budgets, rooms, privateOnLeft, rng);
      placeKitchenInRect(rooms, kitchen.id, utility, kitZone, budgets, fromS, rng);
    }

    zone = fromS
      ? { x: zone.x, y: zone.y + wetH, w: zone.w, h: zone.h - wetH }
      : { x: zone.x, y: zone.y, w: zone.w, h: zone.h - wetH };

    pushLiving(rooms, living.id, zone, budgets, fromS, H, circDepth, livingPocket);
    return;
  }

  const kitB = budgetFor(budgets, kitchen.id);
  const livB = budgetFor(budgets, living.id);
  // Side-by-side: living MUST stay against the corridor for topology doors
  const wantSide =
    (kitchenMode === 'sideCorridor' || kitchenMode === 'sideOuter') && zone.w >= 5.2;

  if (wantSide) {
    const kitW = clamp(
      zone.w * (kitB.targetArea / (kitB.targetArea + livB.targetArea)),
      Math.max(kitB.minWidth, 2.1),
      zone.w * 0.4,
    );
    const corrOnRight = !privateOnLeft;
    // Kitchen on outer wall; living against corridor
    const kitX = corrOnRight ? zone.x : zone.x + zone.w - kitW;
    const kitRect: Rect = { x: kitX, y: zone.y, w: kitW, h: zone.h };
    const livingRect: Rect = kitX <= zone.x + 0.01
      ? { x: zone.x + kitW, y: zone.y, w: zone.w - kitW, h: zone.h }
      : { x: zone.x, y: zone.y, w: zone.w - kitW, h: zone.h };

    placeKitchenInRect(rooms, kitchen.id, utility, kitRect, budgets, fromS, rng);
    pushLiving(rooms, living.id, livingRect, budgets, fromS, H, circDepth, livingPocket);
    return;
  }

  // Horizontal kitchen strip — size kitchen so living stays within depth/aspect caps
  const livCap = livingDepthCap(zone.w);
  let kitH = clamp(
    zone.h * (kitB.targetArea / (kitB.targetArea + livB.targetArea)),
    Math.max(kitB.minHeight, 2.0),
    zone.h * 0.55,
  );
  if (zone.h - kitH > livCap) {
    kitH = zone.h - livCap;
  }
  kitH = clamp(kitH, Math.max(kitB.minHeight, 2.0), zone.h - livingMin);
  const atEntrance = kitchenMode === 'stripEntrance';
  const kitAtDeep = fromS ? !atEntrance : atEntrance;
  const kitchenRect: Rect = kitAtDeep
    ? (fromS
        ? { x: zone.x, y: zone.y, w: zone.w, h: kitH }
        : { x: zone.x, y: zone.y + zone.h - kitH, w: zone.w, h: kitH })
    : (fromS
        ? { x: zone.x, y: zone.y + zone.h - kitH, w: zone.w, h: kitH }
        : { x: zone.x, y: zone.y, w: zone.w, h: kitH });

  placeKitchenInRect(rooms, kitchen.id, utility, kitchenRect, budgets, fromS, rng);

  const livingRect: Rect = kitAtDeep
    ? (fromS
        ? { x: zone.x, y: zone.y + kitH, w: zone.w, h: zone.h - kitH }
        : { x: zone.x, y: zone.y, w: zone.w, h: zone.h - kitH })
    : (fromS
        ? { x: zone.x, y: zone.y, w: zone.w, h: zone.h - kitH }
        : { x: zone.x, y: zone.y + kitH, w: zone.w, h: zone.h - kitH });

  pushLiving(rooms, living.id, livingRect, budgets, fromS, H, circDepth, livingPocket && kitAtDeep);
}

function placeKitchenInRect(
  rooms: RoomRect[],
  kitchenId: string,
  utility: { id: string } | undefined,
  kitZone: Rect,
  budgets: AreaBudget[],
  fromS: boolean,
  rng: RNG,
): void {
  if (!utility) {
    rooms.push(rectRoom(kitchenId, 'KITCHEN', kitZone, budgets));
    return;
  }
  if (kitZone.w >= kitZone.h && kitZone.w >= 3.2) {
    const uw = clamp(kitZone.w * 0.3, 1.2, kitZone.w * 0.38);
    const utilRight = rng.bool();
    rooms.push(rectRoom(kitchenId, 'KITCHEN', {
      x: utilRight ? kitZone.x : kitZone.x + uw,
      y: kitZone.y,
      w: kitZone.w - uw,
      h: kitZone.h,
    }, budgets));
    rooms.push(rectRoom(utility.id, 'UTILITY', {
      x: utilRight ? kitZone.x + kitZone.w - uw : kitZone.x,
      y: kitZone.y,
      w: uw,
      h: kitZone.h,
    }, budgets));
  } else {
    const uh = clamp(kitZone.h * 0.3, 1.2, kitZone.h * 0.38);
    rooms.push(rectRoom(utility.id, 'UTILITY', {
      x: kitZone.x,
      y: fromS ? kitZone.y + kitZone.h - uh : kitZone.y,
      w: kitZone.w,
      h: uh,
    }, budgets));
    rooms.push(rectRoom(kitchenId, 'KITCHEN', fromS
      ? { x: kitZone.x, y: kitZone.y, w: kitZone.w, h: kitZone.h - uh }
      : { x: kitZone.x, y: kitZone.y + uh, w: kitZone.w, h: kitZone.h - uh }, budgets));
  }
}

function pushLiving(
  rooms: RoomRect[],
  livingId: string,
  livingRect: Rect,
  budgets: AreaBudget[],
  fromS: boolean,
  H: number,
  circDepth: number,
  absorbPocket: boolean,
): void {
  const r = { ...livingRect };
  const cap = livingDepthCap(r.w);
  // Only absorb entry pocket when living stays within depth/aspect caps.
  if (absorbPocket) {
    const absorbed = { ...r };
    if (fromS) absorbed.h = H - absorbed.y;
    else {
      absorbed.y = Math.max(0, absorbed.y - circDepth);
      absorbed.h += circDepth;
    }
    if (absorbed.h <= cap + 0.05) {
      rooms.push(rectRoom(livingId, 'LIVING', absorbed, budgets));
      return;
    }
  }
  if (r.h > cap + 0.05) {
    if (fromS) r.h = cap;
    else {
      r.y = r.y + r.h - cap;
      r.h = cap;
    }
  }
  rooms.push(rectRoom(livingId, 'LIVING', r, budgets));
}

function orderPrivateStack(
  bedItems: Item[],
  bathItems: Item[],
  order: LayoutParams['bathOrder'],
  rng: RNG,
): Item[] {
  if (bathItems.length === 0) return [...bedItems];
  if (order === 'entrance') return [...bedItems, ...bathItems];
  if (order === 'deep') return [...bathItems, ...bedItems];
  if (order === 'middle' && bedItems.length >= 2) {
    const mid = Math.floor(bedItems.length / 2);
    return [...bedItems.slice(0, mid), ...bathItems, ...bedItems.slice(mid)];
  }
  // interleave
  const out: Item[] = [];
  const beds = [...bedItems];
  const baths = [...bathItems];
  if (rng.bool()) {
    while (beds.length || baths.length) {
      if (beds.length) out.push(beds.shift()!);
      if (baths.length) out.push(baths.shift()!);
    }
  } else {
    while (beds.length || baths.length) {
      if (baths.length) out.push(baths.shift()!);
      if (beds.length) out.push(beds.shift()!);
    }
  }
  return out;
}

function biasToFrac(bias: LayoutParams['corrBias'], rng: RNG): number {
  switch (bias) {
    case 'farLeft': return 0.34 + rng.next() * 0.06;
    case 'left': return 0.38 + rng.next() * 0.06;
    case 'right': return 0.52 + rng.next() * 0.06;
    case 'farRight': return 0.56 + rng.next() * 0.06;
    case 'center':
    default: return 0.44 + rng.next() * 0.12;
  }
}

function placeEntryFoyerNS(
  rooms: RoomRect[],
  entry: { id: string },
  foyer: { id: string } | undefined,
  budgets: AreaBudget[],
  corrX: number,
  corrW: number,
  entryDepth: number,
  foyerDepth: number,
  circDepth: number,
  H: number,
  fromS: boolean,
): void {
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
}

function embedEW(input: EmbedInput, style: LayoutStyle): RoomRect[] {
  const { tree, budgets, outlineW: W, outlineH: H, entranceDir, seed } = input;
  const rng = new RNG(seed);
  const params = paramsForStyle(style, rng);
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

  // End-cap entry only shares `corrW` with the corridor — keep that ≥ door+clearance.
  const corrW = 1.25;
  const entryDepth = clamp(Math.max(budgetFor(budgets, entry.id).minArea / corrW, 1.45), 1.45, 1.7);
  const foyerDepth = foyer
    ? clamp(Math.max(budgetFor(budgets, foyer.id).minArea / corrW, 1.45), 1.45, 1.6)
    : 0;
  const circDepth = entryDepth + foyerDepth;

  const corrX = fromW ? circDepth : 0;
  const corrLen = W - circDepth;
  // Living needs ≥3m in the short direction — keep both bands furnishable
  const livingMinBand = 3.05;
  const bandFloor = Math.min(livingMinBand, (H - corrW) / 2 - 0.05);
  const corrFrac = biasToFrac(params.corrBias, rng);
  let corrY = clamp(H * corrFrac, bandFloor, H - corrW - bandFloor);

  // Prefer private on the larger band, then clamp so neither wing is a strip.
  let privateOnTop = corrY >= H - corrY - corrW;
  const maxPrivH = maxPrivateWingWidth(bedrooms.length, corrLen);
  // For EW, "wing width" is the band height (orthogonal to corridor).
  const maxPubH = Math.max(livingMinBand, livingDepthCap(Math.min(6, corrLen * 0.55)) / 2.1);
  if (privateOnTop) {
    if (corrY > maxPrivH) corrY = maxPrivH;
    if (H - corrY - corrW > Math.max(maxPubH, livingMinBand + 0.2)) {
      corrY = Math.max(bandFloor, H - corrW - Math.max(maxPubH, livingMinBand));
    }
  } else {
    if (H - corrY - corrW > maxPrivH) corrY = Math.max(bandFloor, H - corrW - maxPrivH);
    if (corrY > Math.max(maxPubH, livingMinBand + 0.2)) {
      corrY = Math.min(Math.max(maxPubH, livingMinBand), H - corrW - bandFloor);
    }
  }
  corrY = clamp(corrY, bandFloor, H - corrW - bandFloor);

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
  privateOnTop = top.h >= bottom.h;

  let privateZone = privateOnTop ? top : bottom;
  let publicZone = privateOnTop ? bottom : top;

  let bedItems = bedrooms.map(bed => {
    const en = ensuites.find(e => e.attachedTo === bed.id);
    return {
      id: bed.id,
      cat: 'BEDROOM' as AccessNodeCategory,
      weight: budgetFor(budgets, bed.id).targetArea + (en ? budgetFor(budgets, en.id).targetArea : 0),
      ensuiteId: en?.id,
    };
  });
  let bathItems = commonBaths.map(bath => ({
    id: bath.id,
    cat: 'COMMON_BATHROOM' as AccessNodeCategory,
    weight: Math.max(budgetFor(budgets, bath.id).targetArea, 3.5),
  }));
  if (rng.bool(0.75)) bedItems = rng.shuffle(bedItems);

  const livingMinW = Math.max(budgetFor(budgets, living.id).minWidth, 3.0);
  let guestItem: Item | null = null;
  if (params.guestWing && bedItems.length >= 2 && publicZone.w >= livingMinW + 3.2) {
    guestItem = bedItems[bedItems.length - 1];
    bedItems = bedItems.slice(0, -1);
  }

  const kitMinW = Math.max(budgetFor(budgets, kitchen.id).minWidth, 2.1);
  const wetNeed = bathItems.length * 1.7 + kitMinW + livingMinW;
  const wetOnPublic = params.wetOnPublic && bathItems.length > 0 && publicZone.w >= wetNeed;
  const privateBaths = wetOnPublic ? [] : bathItems;
  const publicBaths = wetOnPublic ? bathItems : [];

  const privateItems = orderPrivateStack(bedItems, privateBaths, params.bathOrder, rng);
  stackHorizontal(privateZone, privateItems, budgets, rooms, rng);

  let zone = { ...publicZone };

  if (guestItem) {
    const guestW = clamp(zone.w - livingMinW - kitMinW * 0.5, 2.9, Math.min(3.8, zone.w * 0.36));
    const guestAtFar = fromW;
    const guestRect: Rect = guestAtFar
      ? { x: zone.x + zone.w - guestW, y: zone.y, w: guestW, h: zone.h }
      : { x: zone.x, y: zone.y, w: guestW, h: zone.h };
    stackHorizontal(guestRect, [guestItem], budgets, rooms, rng);
    zone = guestAtFar
      ? { x: zone.x, y: zone.y, w: zone.w - guestW, h: zone.h }
      : { x: zone.x + guestW, y: zone.y, w: zone.w - guestW, h: zone.h };
  }

  const kitB = budgetFor(budgets, kitchen.id);
  const livB = budgetFor(budgets, living.id);

  if (publicBaths.length > 0) {
    const bathMin = publicBaths.length * 1.7;
    const kitMin = Math.max(kitB.minWidth, 2.2);
    const wetW = clamp(bathMin + kitMin, bathMin + kitMin, zone.w - livingMinW);
    const wetAtFar = fromW;
    const wetZone: Rect = wetAtFar
      ? { x: zone.x + zone.w - wetW, y: zone.y, w: wetW, h: zone.h }
      : { x: zone.x, y: zone.y, w: wetW, h: zone.h };
    const bathW = Math.min(bathMin, wetW - kitMin);
    const bathZone: Rect = wetAtFar
      ? { x: wetZone.x + wetZone.w - bathW, y: wetZone.y, w: bathW, h: wetZone.h }
      : { x: wetZone.x, y: wetZone.y, w: bathW, h: wetZone.h };
    const kitZone: Rect = wetAtFar
      ? { x: wetZone.x, y: wetZone.y, w: wetZone.w - bathW, h: wetZone.h }
      : { x: wetZone.x + bathW, y: wetZone.y, w: wetZone.w - bathW, h: wetZone.h };
    stackHorizontal(bathZone, publicBaths, budgets, rooms, rng);
    placeKitchenInRect(rooms, kitchen.id, utility, kitZone, budgets, true, rng);
    zone = wetAtFar
      ? { x: zone.x, y: zone.y, w: zone.w - wetW, h: zone.h }
      : { x: zone.x + wetW, y: zone.y, w: zone.w - wetW, h: zone.h };
    pushLivingEW(rooms, living.id, zone, budgets, fromW, W, circDepth, params.livingPocket);
    return rooms;
  }

  const kitW = clamp(
    zone.w * (kitB.targetArea / (kitB.targetArea + livB.targetArea)),
    Math.max(kitB.minWidth, 2.1),
    Math.min(zone.w * 0.45, zone.w - livingMinW),
  );
  const livCap = livingDepthCap(zone.h);
  let kitWidth = kitW;
  if (zone.w - kitWidth > livCap) {
    kitWidth = Math.max(kitW, zone.w - livCap);
  }
  const kitchenNearEntry = params.kitchenMode === 'stripEntrance' || params.kitchenMode === 'sideOuter';
  const placeKitFar = kitchenNearEntry ? !fromW : fromW;

  const kitchenRect: Rect = placeKitFar
    ? { x: zone.x + zone.w - kitWidth, y: zone.y, w: kitWidth, h: zone.h }
    : { x: zone.x, y: zone.y, w: kitWidth, h: zone.h };

  placeKitchenInRect(rooms, kitchen.id, utility, kitchenRect, budgets, true, rng);

  const livingRect: Rect = kitchenRect.x <= zone.x + 0.01
    ? { x: zone.x + kitWidth, y: zone.y, w: zone.w - kitWidth, h: zone.h }
    : { x: zone.x, y: zone.y, w: zone.w - kitWidth, h: zone.h };

  pushLivingEW(rooms, living.id, livingRect, budgets, fromW, W, circDepth, params.livingPocket && placeKitFar === fromW);
  return rooms;
}

function pushLivingEW(
  rooms: RoomRect[],
  livingId: string,
  livingRect: Rect,
  budgets: AreaBudget[],
  fromW: boolean,
  W: number,
  circDepth: number,
  absorbPocket: boolean,
): void {
  const r = { ...livingRect };
  const cap = livingDepthCap(r.h);
  if (absorbPocket) {
    const absorbed = { ...r };
    if (fromW) {
      absorbed.x = 0;
      absorbed.w = livingRect.x + livingRect.w;
    } else {
      absorbed.w = W - absorbed.x;
    }
    if (absorbed.w <= cap + 0.05) {
      void circDepth;
      rooms.push(rectRoom(livingId, 'LIVING', absorbed, budgets));
      return;
    }
  }
  void circDepth;
  if (r.w > cap + 0.05) {
    if (fromW) r.w = cap;
    else {
      r.x = r.x + r.w - cap;
      r.w = cap;
    }
  }
  rooms.push(rectRoom(livingId, 'LIVING', r, budgets));
}

function stackVertical(
  zone: Rect,
  items: Item[],
  budgets: AreaBudget[],
  rooms: RoomRect[],
  ensuiteOnRight: boolean,
  rng?: RNG,
): void {
  if (items.length === 0 || zone.w < 1.2 || zone.h < 1.2) return;

  const mins = items.map(item => {
    if (item.cat === 'COMMON_BATHROOM') return 1.55;
    if (item.ensuiteId) return 2.6;
    return 2.5;
  });
  const minSum = mins.reduce((s, m) => s + m, 0);
  const weights = items.map(i => i.weight * (0.88 + (rng?.next() ?? 0.5) * 0.24));
  const totalW = weights.reduce((s, w) => s + w, 0) || 1;

  let heights: number[];
  if (minSum >= zone.h - 0.01) {
    heights = mins.map(m => (m / minSum) * zone.h);
  } else {
    const extra = zone.h - minSum;
    heights = items.map((_, i) => mins[i] + extra * (weights[i] / totalW));
  }

  let y = zone.y;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const h = i === items.length - 1 ? zone.y + zone.h - y : heights[i];
    const slot: Rect = { x: zone.x, y, w: zone.w, h };
    if (item.ensuiteId) {
      const eb = budgetFor(budgets, item.ensuiteId);
      let ew = clamp(Math.max(eb.minWidth, eb.minArea / Math.max(1.5, h)), eb.minWidth, zone.w * 0.38);
      const eh = Math.min(h, Math.max(eb.minHeight, eb.minArea / ew));
      // Prefer side-by-side ensuite (more reliable dims); rare vertical only when tall
      const verticalEnsuite = (rng?.bool(0.12) ?? false) && h >= 3.6 && slot.w < 3.4;
      if (verticalEnsuite) {
        rooms.push(rectRoom(item.id, item.cat, {
          x: slot.x, y: slot.y + eh, w: slot.w, h: slot.h - eh,
        }, budgets));
        rooms.push(rectRoom(item.ensuiteId, 'ENSUITE_BATHROOM', {
          x: slot.x, y: slot.y, w: slot.w, h: eh,
        }, budgets));
      } else {
        const maxBedW = bedroomWidthCap(h);
        const bedTargetW = Math.min(slot.w - ew, maxBedW);
        if (slot.w - ew > bedTargetW + 0.05) {
          ew = slot.w - bedTargetW;
        }
        const ensuiteRect: Rect = ensuiteOnRight
          ? { x: slot.x + slot.w - ew, y: slot.y, w: ew, h: eh }
          : { x: slot.x, y: slot.y, w: ew, h: eh };
        const bedRect: Rect = ensuiteOnRight
          ? { x: slot.x, y: slot.y, w: slot.w - ew, h: slot.h }
          : { x: slot.x + ew, y: slot.y, w: slot.w - ew, h: slot.h };
        rooms.push(rectRoom(item.id, item.cat, bedRect, budgets));
        rooms.push(rectRoom(item.ensuiteId, 'ENSUITE_BATHROOM', ensuiteRect, budgets));
      }
    } else {
      rooms.push(rectRoom(item.id, item.cat, slot, budgets));
    }
    y += h;
  }
}

function stackHorizontal(
  zone: Rect,
  items: Item[],
  budgets: AreaBudget[],
  rooms: RoomRect[],
  rng?: RNG,
): void {
  if (items.length === 0 || zone.w < 1.2 || zone.h < 1.2) return;

  // Ensuite slots need extra width so bed area stays ≥ ~9.5 after carving bath
  const mins = items.map(item => {
    if (item.cat === 'COMMON_BATHROOM') return 1.7;
    if (item.ensuiteId) return Math.max(3.9, 9.5 / Math.max(zone.h, 2.5) + 1.25);
    return Math.max(2.9, 9.5 / Math.max(zone.h, 2.5));
  });
  const minSum = mins.reduce((s, m) => s + m, 0);
  const weights = items.map(i => i.weight * (0.88 + (rng?.next() ?? 0.5) * 0.24));
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
      const eb = budgetFor(budgets, item.ensuiteId);
      // Cap ensuite width so bedroom keeps min area
      const maxEw = Math.max(eb.minWidth, slot.w - 9.5 / Math.max(slot.h, 2.5));
      // Keep ensuite proportion furnishable (avoid 1.2×3.7 strips).
      const minEwForAspect = slot.h / 3.2;
      const ew = clamp(
        Math.max(eb.minWidth, eb.minArea / Math.max(1.5, zone.h), minEwForAspect),
        eb.minWidth,
        Math.min(slot.w * 0.42, maxEw),
      );
      const ensuiteOnLeft = rng?.bool(0.5) ?? true;
      const ensuiteRect: Rect = ensuiteOnLeft
        ? { x: slot.x, y: slot.y, w: ew, h: slot.h }
        : { x: slot.x + slot.w - ew, y: slot.y, w: ew, h: slot.h };
      const bedRect: Rect = ensuiteOnLeft
        ? { x: slot.x + ew, y: slot.y, w: slot.w - ew, h: slot.h }
        : { x: slot.x, y: slot.y, w: slot.w - ew, h: slot.h };
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
    w: round(Math.max(0.5, rect.w)),
    h: round(Math.max(0.5, rect.h)),
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
