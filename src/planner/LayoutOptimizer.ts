/**
 * LayoutOptimizer: Simulated Annealing Room Placement
 *
 * Inspired by procedural level generation in AAA games (Diablo, Spelunky,
 * Hades dungeon generators) and architectural space syntax research.
 *
 * After the treemap partitions the outline into rectangles, THIS module
 * decides WHICH room goes in WHICH rectangle by swapping room assignments
 * and scoring each configuration using architectural heuristics.
 *
 * Heuristics (Utility AI scoring):
 *   1. ADJACENCY — Do rooms that SHOULD share a wall actually share one?
 *   2. WET ZONE CLUSTERING — Are kitchen + bathrooms grouped together? (plumbing)
 *   3. PRIVACY GRADIENT — Bedrooms far from entry, living/kitchen near entry.
 *   4. DAYLIGHT ACCESS — Living + bedrooms should touch exterior walls.
 *   5. CORRIDOR CENTRALITY — Corridor should be central, touching many rooms.
 *   6. ENTRY PLACEMENT — Entry must be on the entrance boundary edge.
 *
 * Algorithm:
 *   Simulated Annealing with geometric cooling schedule:
 *   - T_start = 1.0, T_end = 0.001, cooling = 0.995
 *   - Each step: swap two room assignments, score, accept/reject
 *   - Track best-ever configuration
 *   - Return best after N iterations
 */

import type { RoomType } from '../types/index.ts';
import type { RoomRect, EntranceDirection } from './ProgramBuilder.ts';

// ─── Heuristic weights (tuned for residential floor plans) ──────────────
const WEIGHTS = {
  adjacency: 40,       // Most important: rooms that need to be together, ARE together
  wetZone: 20,         // Kitchen + bathrooms should cluster (shared plumbing wall)
  privacy: 15,         // Bedrooms far from entry, living near
  daylight: 15,        // Living + bedrooms on exterior walls
  corridorCentral: 10, // Corridor should touch many rooms
};

// ─── Adjacency requirements ─────────────────────────────────────────────
// These pairs SHOULD share a wall for a good layout
const DESIRED_ADJACENCIES: [RoomType, RoomType][] = [
  ['living', 'kitchen'],
  ['living', 'corridor'],
  ['bedroom', 'bathroom'],
  ['bedroom', 'corridor'],
  ['corridor', 'entry'],
  ['kitchen', 'corridor'],
];

// Wet zone room types (should cluster together)
const WET_ROOMS: Set<string> = new Set(['kitchen', 'bathroom']);

// Privacy-sensitive rooms (should be far from entry)
const PRIVATE_ROOMS: Set<string> = new Set(['bedroom', 'bathroom']);

// Daylight-requiring rooms (should touch exterior walls)
const DAYLIGHT_ROOMS: Set<string> = new Set(['living', 'bedroom']);

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Check if two rectangles share a wall (adjacent with shared edge segment).
 */
function areAdjacent(a: Rect, b: Rect): boolean {
  const eps = 0.01;

  // Shared vertical edge (a's right = b's left, or vice versa)
  if (Math.abs((a.x + a.w) - b.x) < eps || Math.abs((b.x + b.w) - a.x) < eps) {
    const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (overlapY > eps) return true;
  }

  // Shared horizontal edge (a's bottom = b's top, or vice versa)
  if (Math.abs((a.y + a.h) - b.y) < eps || Math.abs((b.y + b.h) - a.y) < eps) {
    const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    if (overlapX > eps) return true;
  }

  return false;
}

/**
 * Check if a rectangle touches an exterior boundary edge.
 */
function touchesExterior(r: Rect, outlineW: number, outlineH: number): boolean {
  const eps = 0.01;
  return r.x < eps || r.y < eps || 
         Math.abs(r.x + r.w - outlineW) < eps || 
         Math.abs(r.y + r.h - outlineH) < eps;
}

/**
 * Check if a rectangle touches a specific boundary edge.
 */
function touchesBoundary(r: Rect, dir: EntranceDirection, outlineW: number, outlineH: number): boolean {
  const eps = 0.01;
  switch (dir) {
    case 'N': return r.y < eps;
    case 'S': return Math.abs(r.y + r.h - outlineH) < eps;
    case 'W': return r.x < eps;
    case 'E': return Math.abs(r.x + r.w - outlineW) < eps;
  }
}

/**
 * Compute the centroid distance between two rectangles.
 */
function centroidDist(a: Rect, b: Rect): number {
  const ax = a.x + a.w / 2;
  const ay = a.y + a.h / 2;
  const bx = b.x + b.w / 2;
  const by = b.y + b.h / 2;
  return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);
}

/**
 * Score a room-to-rect assignment. HIGHER IS BETTER.
 */
function scoreLayout(
  rects: Rect[],
  roomTypes: RoomType[],
  outlineW: number,
  outlineH: number,
  entranceDir: EntranceDirection
): number {
  let score = 0;
  const n = rects.length;

  // Pre-compute adjacency matrix
  const adj: boolean[][] = [];
  for (let i = 0; i < n; i++) {
    adj[i] = [];
    for (let j = 0; j < n; j++) {
      adj[i][j] = i !== j && areAdjacent(rects[i], rects[j]);
    }
  }

  // 1. MANDATORY CORRIDOR / LIVING SPINE ACCESS — Every bedroom, bathroom, living room, and kitchen MUST touch the corridor or living room
  const spineIndices = roomTypes.map((t, i) => (t === 'corridor' || t === 'living') ? i : -1).filter(i => i >= 0);
  
  for (let i = 0; i < n; i++) {
    const t = roomTypes[i];
    if (t === 'entry' || t === 'corridor') continue;

    // Check if room i touches at least one corridor or living room
    const touchesSpine = spineIndices.some(ci => ci !== i && adj[i][ci]);
    if (touchesSpine) {
      score += WEIGHTS.adjacency;
    } else {
      // Massive penalty for rooms stranded without direct access to the corridor/living spine
      score -= 200;
    }
  }

  // 1b. DESIRED ADJACENCIES (living-kitchen, bedroom-bathroom, entry-corridor)
  const OPTIONAL_PAIRS: [RoomType, RoomType][] = [
    ['living', 'kitchen'],
    ['bedroom', 'bathroom'],
    ['corridor', 'entry'],
  ];

  for (const [typeA, typeB] of OPTIONAL_PAIRS) {
    for (let i = 0; i < n; i++) {
      if (roomTypes[i] !== typeA) continue;
      for (let j = 0; j < n; j++) {
        if (i === j || roomTypes[j] !== typeB) continue;
        if (adj[i][j]) {
          score += 15;
        }
      }
    }
  }

  // 2. WET ZONE CLUSTERING — wet rooms should be near each other
  const wetIndices = roomTypes.map((t, i) => WET_ROOMS.has(t) ? i : -1).filter(i => i >= 0);
  if (wetIndices.length >= 2) {
    let wetPairsAdj = 0;
    let wetPairsTotal = 0;
    for (let i = 0; i < wetIndices.length; i++) {
      for (let j = i + 1; j < wetIndices.length; j++) {
        wetPairsTotal++;
        // Reward adjacency OR proximity
        if (adj[wetIndices[i]][wetIndices[j]]) {
          wetPairsAdj += 1.0;
        } else {
          const dist = centroidDist(rects[wetIndices[i]], rects[wetIndices[j]]);
          const maxDist = Math.sqrt(outlineW ** 2 + outlineH ** 2);
          wetPairsAdj += Math.max(0, 1 - dist / maxDist) * 0.5;
        }
      }
    }
    score += (wetPairsTotal > 0 ? wetPairsAdj / wetPairsTotal : 0) * WEIGHTS.wetZone;
  }

  // 3. PRIVACY GRADIENT — private rooms should be far from entry
  const entryIdx = roomTypes.indexOf('entry' as RoomType);
  if (entryIdx >= 0) {
    const maxDist = Math.sqrt(outlineW ** 2 + outlineH ** 2);
    let privacyScore = 0;
    let privacyCount = 0;
    for (let i = 0; i < n; i++) {
      if (PRIVATE_ROOMS.has(roomTypes[i])) {
        const dist = centroidDist(rects[entryIdx], rects[i]);
        privacyScore += dist / maxDist; // 0..1, higher = more private
        privacyCount++;
      }
    }
    score += (privacyCount > 0 ? privacyScore / privacyCount : 0) * WEIGHTS.privacy;
  }

  // 4. DAYLIGHT ACCESS — daylight rooms on exterior walls
  let daylightScore = 0;
  let daylightCount = 0;
  for (let i = 0; i < n; i++) {
    if (DAYLIGHT_ROOMS.has(roomTypes[i])) {
      daylightCount++;
      if (touchesExterior(rects[i], outlineW, outlineH)) {
        daylightScore += 1;
      }
    }
  }
  score += (daylightCount > 0 ? daylightScore / daylightCount : 0) * WEIGHTS.daylight;

  // 5. CORRIDOR CENTRALITY — corridor should touch many rooms
  const corridorIndices = roomTypes.map((t, i) => t === 'corridor' ? i : -1).filter(i => i >= 0);
  for (const ci of corridorIndices) {
    let touchCount = 0;
    for (let j = 0; j < n; j++) {
      if (j !== ci && adj[ci][j]) touchCount++;
    }
    // Reward corridors that touch 3+ rooms
    score += Math.min(1, touchCount / 3) * WEIGHTS.corridorCentral;
  }

  // 6. ENTRY ON BOUNDARY — entry MUST be on entrance edge (hard penalty)
  if (entryIdx >= 0) {
    if (!touchesBoundary(rects[entryIdx], entranceDir, outlineW, outlineH)) {
      score -= 100; // Massive penalty
    }
  }

  return score;
}

/**
 * Score how well a room's target area matches its assigned rectangle's initial area.
 * This helps the SA optimizer prefer assigning large rooms to large rectangles.
 */
function scoreAreaMatch(
  rects: Rect[],
  originalRooms: { targetArea: number }[],
  currentTypes: RoomType[],
  roomsByType: Map<string, { targetArea: number }[]>
): number {
  let score = 0;
  
  // Track which rooms we've assigned for each type
  const usedByType = new Map<string, number>();
  
  for (let i = 0; i < rects.length; i++) {
    const type = currentTypes[i];
    const pool = roomsByType.get(type);
    if (!pool) continue;
    
    const idx = usedByType.get(type) ?? 0;
    const room = pool[idx % pool.length];
    usedByType.set(type, idx + 1);

    const rectArea = rects[i].w * rects[i].h;
    const targetArea = room.targetArea;
    
    // Calculate how off the area is (ratio >= 1)
    const ratio = Math.max(rectArea, targetArea) / Math.min(rectArea, targetArea);
    
    if (ratio > 1.5) {
      // Small mismatch is okay, but penalize heavily if off by more than 50%
      score -= (ratio - 1.5) * 50; 
    }
  }
  
  return score;
}

/**
 * Simulated Annealing optimizer for room-to-rectangle assignment.
 *
 * Takes a set of rectangles (from treemap) and room metadata,
 * and finds the best assignment of rooms to rectangles.
 */
export function optimizeRoomPlacement(
  rects: RoomRect[],
  outlineW: number,
  outlineH: number,
  entranceDir: EntranceDirection,
  iterations: number = 2000,
): void {
  if (rects.length <= 2) return; // Nothing to optimize

  const n = rects.length;
  const rectGeom: Rect[] = rects.map(r => ({ x: r.x, y: r.y, w: r.w, h: r.h }));

  const originalRooms = rects.map(r => ({
    roomIndex: r.roomIndex,
    type: r.type,
    targetArea: r.targetArea,
    minDimension: r.minDimension,
  }));

  const roomsByType = new Map<string, typeof originalRooms>();
  for (const room of originalRooms) {
    const list = roomsByType.get(room.type) ?? [];
    list.push(room);
    roomsByType.set(room.type, list);
  }

  // Current assignment: roomTypes[i] = which room type is in rect i
  // We ONLY want to swap the main rooms (index >= serviceCount)
  const serviceCount = rects.filter(r => r.type === 'entry' || r.type === 'corridor').length;
  
  let currentTypes = rects.map(r => r.type);
  let currentScore = scoreLayout(rectGeom, currentTypes, outlineW, outlineH, entranceDir) + 
                     scoreAreaMatch(rectGeom, originalRooms, currentTypes, roomsByType);

  let bestTypes = [...currentTypes];
  let bestScore = currentScore;

  // SA parameters
  const T_start = 2.0;
  const T_end = 0.001;
  const cooling = Math.pow(T_end / T_start, 1 / iterations);
  let T = T_start;

  // Simple LCG PRNG for determinism
  let seed = 42;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  for (let iter = 0; iter < iterations; iter++) {
    if (n - serviceCount < 2) break;
    
    const i = serviceCount + Math.floor(rand() * (n - serviceCount));
    let j = serviceCount + Math.floor(rand() * (n - serviceCount - 1));
    if (j >= i) j++;

    if (currentTypes[i] === currentTypes[j]) {
      T *= cooling;
      continue;
    }

    // Swap
    [currentTypes[i], currentTypes[j]] = [currentTypes[j], currentTypes[i]];
    const newScore = scoreLayout(rectGeom, currentTypes, outlineW, outlineH, entranceDir) + 
                     scoreAreaMatch(rectGeom, originalRooms, currentTypes, roomsByType);
    const delta = newScore - currentScore;

    if (delta > 0 || rand() < Math.exp(delta / T)) {
      // Accept
      currentScore = newScore;
      if (currentScore > bestScore) {
        bestScore = currentScore;
        bestTypes = [...currentTypes];
      }
    } else {
      // Reject — swap back
      [currentTypes[i], currentTypes[j]] = [currentTypes[j], currentTypes[i]];
    }

    T *= cooling;
  }

  // Apply best assignment to rects
  // We need to remap: for each rect, find which original room data matches the best type assignment
  // Assign rooms to rects based on bestTypes
  const usedByType = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const type = bestTypes[i];
    const pool = roomsByType.get(type);
    if (!pool) continue;
    const idx = usedByType.get(type) ?? 0;
    const room = pool[idx % pool.length];
    usedByType.set(type, idx + 1);

    rects[i].type = room.type;
    rects[i].roomIndex = room.roomIndex;
    rects[i].targetArea = room.targetArea;
    rects[i].minDimension = room.minDimension;
  }
}
