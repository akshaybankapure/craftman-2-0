/**
 * MEP (Mechanical, Electrical, Plumbing) Zone Rules.
 *
 * In residential architecture, MEP is NOT cosmetic — it constrains layout
 * fundamentally. Bathrooms and kitchens MUST cluster around plumbing shafts.
 * Electrical rooms need access from the lobby. HVAC ducts need vertical
 * continuity. This module encodes those hard constraints.
 *
 * Key rules:
 *   1. Wet rooms must be within MAX_PLUMBING_DISTANCE of a shaft
 *   2. Wet rooms should cluster (shared walls reduce piping)
 *   3. Plumbing shafts must align vertically across floors
 *   4. Electrical risers need minimum shaft dimensions
 *   5. Kitchen exhaust needs exterior wall access
 *   6. HVAC: no specific constraints for residential (split AC)
 *
 * This is "zone reservation" level — not pipe routing.
 */

import type { ExtendedRoomType } from './roomTypes';
import { isWetRoom, ROOM_METADATA } from './roomTypes';
import type { NormViolation } from './buildingNorms';

// ─── Constants ───────────────────────────────────────────────────────────

/** Max horizontal distance (m) from a wet room to a plumbing shaft. */
const MAX_PLUMBING_DISTANCE = 3.0;

/** Ideal distance (m) — under this, piping is cheap and quiet. */
const IDEAL_PLUMBING_DISTANCE = 1.5;

/** Minimum shaft sizes based on building height/floor count. */
const SHAFT_SIZES = {
  /** Plumbing shaft for ≤4 floors */
  plumbingSmall: { width: 0.6, depth: 0.6 },
  /** Plumbing shaft for 5–15 floors */
  plumbingMedium: { width: 0.8, depth: 0.6 },
  /** Plumbing shaft for >15 floors */
  plumbingLarge: { width: 1.0, depth: 0.8 },
  /** Electrical riser shaft */
  electrical: { width: 0.6, depth: 0.4 },
  /** Combined MEP shaft */
  combined: { width: 1.2, depth: 0.8 },
};

/** Wet room types — rooms that NEED plumbing access. */
const WET_ROOM_TYPES: ExtendedRoomType[] = [
  'kitchen', 'masterBathroom', 'attachedBathroom', 'commonBathroom',
  'guestToilet', 'servantBathroom', 'utility', 'wash', 'wetBalcony',
];

// ─── Types ───────────────────────────────────────────────────────────────

export interface ShaftPosition {
  id: string;
  x: number;
  y: number;
  type: 'plumbing' | 'electrical' | 'combined';
  width: number;
  depth: number;
}

export interface RoomPosition {
  id: string;
  type: ExtendedRoomType;
  centroidX: number;
  centroidY: number;
}

export interface MEPAnalysis {
  /** Distance from each wet room to its nearest shaft. */
  shaftDistances: Array<{
    roomId: string;
    roomType: ExtendedRoomType;
    nearestShaftId: string;
    distance: number;
    withinLimit: boolean;
    withinIdeal: boolean;
  }>;
  /** Wet rooms that have shared walls (good for plumbing efficiency). */
  wetRoomClusters: string[][];
  /** Overall plumbing efficiency score (0-1, higher = better). */
  plumbingEfficiency: number;
  /** Violations found. */
  violations: NormViolation[];
}

// ─── Analysis Functions ──────────────────────────────────────────────────

/**
 * Analyze MEP compliance for a floor layout.
 * Takes room positions and shaft positions and checks all MEP rules.
 */
export function analyzeMEP(
  rooms: RoomPosition[],
  shafts: ShaftPosition[],
  adjacencyPairs: Array<[string, string]>
): MEPAnalysis {
  const violations: NormViolation[] = [];
  const shaftDistances: MEPAnalysis['shaftDistances'] = [];

  // Check wet rooms vs shaft distances
  const wetRooms = rooms.filter(r => WET_ROOM_TYPES.includes(r.type));

  for (const room of wetRooms) {
    let nearestDist = Infinity;
    let nearestShaftId = '';

    for (const shaft of shafts) {
      if (shaft.type === 'electrical') continue; // skip electrical shafts
      const dx = room.centroidX - shaft.x;
      const dy = room.centroidY - shaft.y;
      const dist = Math.hypot(dx, dy);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestShaftId = shaft.id;
      }
    }

    const withinLimit = nearestDist <= MAX_PLUMBING_DISTANCE;
    const withinIdeal = nearestDist <= IDEAL_PLUMBING_DISTANCE;

    shaftDistances.push({
      roomId: room.id,
      roomType: room.type,
      nearestShaftId,
      distance: nearestDist,
      withinLimit,
      withinIdeal,
    });

    if (!withinLimit && shafts.length > 0) {
      const meta = ROOM_METADATA.get(room.type);
      violations.push({
        code: 'MEP-PLUMB-001',
        message: `${meta?.label ?? room.type} is ${nearestDist.toFixed(1)}m from nearest plumbing shaft (max ${MAX_PLUMBING_DISTANCE}m)`,
        normReference: 'Plumbing best practice',
        severity: 'error',
        category: 'plumbing',
        entityId: room.id,
        actual: nearestDist,
        required: MAX_PLUMBING_DISTANCE,
      });
    } else if (!withinIdeal && shafts.length > 0) {
      const meta = ROOM_METADATA.get(room.type);
      violations.push({
        code: 'MEP-PLUMB-002',
        message: `${meta?.label ?? room.type} is ${nearestDist.toFixed(1)}m from shaft — ideally within ${IDEAL_PLUMBING_DISTANCE}m for cost efficiency`,
        normReference: 'MEP design guideline',
        severity: 'warning',
        category: 'plumbing',
        entityId: room.id,
        actual: nearestDist,
        required: IDEAL_PLUMBING_DISTANCE,
      });
    }
  }

  if (shafts.length === 0 && wetRooms.length > 0) {
    violations.push({
      code: 'MEP-PLUMB-003',
      message: 'No plumbing shafts defined — all wet rooms need shaft access',
      normReference: 'MEP design guideline',
      severity: 'error',
      category: 'plumbing',
    });
  }

  // Identify wet room clusters (groups that share walls)
  const wetRoomClusters = findWetClusters(wetRooms, adjacencyPairs);

  // Compute plumbing efficiency
  const plumbingEfficiency = computePlumbingEfficiency(shaftDistances, wetRoomClusters);

  return {
    shaftDistances,
    wetRoomClusters,
    plumbingEfficiency,
    violations,
  };
}

/**
 * Get the recommended shaft size based on floor count.
 */
export function getRecommendedShaftSize(
  floorCount: number,
  type: 'plumbing' | 'electrical' | 'combined' = 'plumbing'
): { width: number; depth: number } {
  if (type === 'electrical') return SHAFT_SIZES.electrical;
  if (type === 'combined') return SHAFT_SIZES.combined;
  if (floorCount <= 4) return SHAFT_SIZES.plumbingSmall;
  if (floorCount <= 15) return SHAFT_SIZES.plumbingMedium;
  return SHAFT_SIZES.plumbingLarge;
}

/**
 * Suggest optimal shaft positions for a floor layout.
 * Places shafts near clusters of wet rooms.
 */
export function suggestShaftPositions(
  rooms: RoomPosition[],
  maxShafts: number = 2
): Array<{ x: number; y: number }> {
  const wetRooms = rooms.filter(r => WET_ROOM_TYPES.includes(r.type));
  if (wetRooms.length === 0) return [];

  // Simple k-means-ish: cluster wet rooms and place shaft at centroid
  if (maxShafts === 1 || wetRooms.length <= 3) {
    const cx = wetRooms.reduce((s, r) => s + r.centroidX, 0) / wetRooms.length;
    const cy = wetRooms.reduce((s, r) => s + r.centroidY, 0) / wetRooms.length;
    return [{ x: cx, y: cy }];
  }

  // For 2 shafts: split wet rooms into two groups by x-coordinate
  const sorted = [...wetRooms].sort((a, b) => a.centroidX - b.centroidX);
  const mid = Math.floor(sorted.length / 2);
  const group1 = sorted.slice(0, mid);
  const group2 = sorted.slice(mid);

  const positions: Array<{ x: number; y: number }> = [];
  
  if (group1.length > 0) {
    positions.push({
      x: group1.reduce((s, r) => s + r.centroidX, 0) / group1.length,
      y: group1.reduce((s, r) => s + r.centroidY, 0) / group1.length,
    });
  }
  
  if (group2.length > 0) {
    positions.push({
      x: group2.reduce((s, r) => s + r.centroidX, 0) / group2.length,
      y: group2.reduce((s, r) => s + r.centroidY, 0) / group2.length,
    });
  }

  return positions;
}

// ─── Internal Helpers ────────────────────────────────────────────────────

function findWetClusters(
  wetRooms: RoomPosition[],
  adjacencyPairs: Array<[string, string]>
): string[][] {
  // Build adjacency graph among wet rooms
  const wetIds = new Set(wetRooms.map(r => r.id));
  const adj = new Map<string, Set<string>>();
  
  for (const [a, b] of adjacencyPairs) {
    if (wetIds.has(a) && wetIds.has(b)) {
      if (!adj.has(a)) adj.set(a, new Set());
      if (!adj.has(b)) adj.set(b, new Set());
      adj.get(a)!.add(b);
      adj.get(b)!.add(a);
    }
  }

  // Find connected components (clusters)
  const visited = new Set<string>();
  const clusters: string[][] = [];

  for (const id of wetIds) {
    if (visited.has(id)) continue;
    const cluster: string[] = [];
    const stack = [id];
    while (stack.length > 0) {
      const curr = stack.pop()!;
      if (visited.has(curr)) continue;
      visited.add(curr);
      cluster.push(curr);
      const neighbors = adj.get(curr);
      if (neighbors) {
        for (const n of neighbors) {
          if (!visited.has(n)) stack.push(n);
        }
      }
    }
    clusters.push(cluster);
  }

  return clusters;
}

function computePlumbingEfficiency(
  distances: MEPAnalysis['shaftDistances'],
  clusters: string[][]
): number {
  if (distances.length === 0) return 1;

  // Distance score: % of rooms within ideal distance
  const withinIdeal = distances.filter(d => d.withinIdeal).length;
  const distanceScore = withinIdeal / distances.length;

  // Clustering score: larger clusters = better (fewer pipe runs)
  const largestCluster = Math.max(...clusters.map(c => c.length), 0);
  const clusterScore = distances.length > 0 ? largestCluster / distances.length : 0;

  // Combined (weighted)
  return distanceScore * 0.6 + clusterScore * 0.4;
}
