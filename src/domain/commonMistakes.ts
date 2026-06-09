/**
 * Common Architectural Mistakes Checker.
 *
 * Beyond building norms (which are LEGAL minimums), experienced architects
 * know dozens of practical mistakes that technically pass code but produce
 * terrible living spaces. This module codifies that tacit knowledge.
 *
 * Each check is a pure function: (layout data) → violations[].
 *
 * Categories of mistakes:
 *   1. Privacy violations     — bedrooms visible from entry, bathroom doors
 *   2. Circulation problems   — dead-end corridors, door clashes
 *   3. Adjacency errors       — bathroom next to kitchen, bedroom opens to kitchen
 *   4. Proportional issues    — unusable balconies, wasteful corridors
 *   5. Service access         — kitchen not near entrance, no servant entry
 *   6. Orientation mistakes   — master bedroom facing west (India), kitchen without exhaust
 *   7. Furniture placement    — attached bath door facing bed, door in corner
 */

import type { ExtendedRoomType } from './roomTypes';
import { ROOM_METADATA } from './roomTypes';
import type { NormViolation } from './buildingNorms';

// ─── Types ───────────────────────────────────────────────────────────────

export interface LayoutRoom {
  id: string;
  type: ExtendedRoomType;
  area: number;
  minSpan: number;
  maxSpan: number;
  /** IDs of rooms directly accessible from this room (shared wall/door). */
  adjacentRoomIds: string[];
  /** Does this room open directly to the entry/foyer? */
  opensToEntry: boolean;
  /** Is this room's door visible from the living/dining area? */
  doorVisibleFromLiving: boolean;
  /** Orientation of primary window wall (radians from north). */
  primaryOrientation: number;
  hasExteriorWall: boolean;
}

export interface LayoutAnalysis {
  rooms: LayoutRoom[];
  /** Entry room ID. */
  entryId: string;
  /** Living room ID. */
  livingId: string;
  /** IDs of rooms connected by corridor/passage (not directly). */
  corridorConnections: Array<[string, string]>;
}

export type MistakeCategory =
  | 'privacy'
  | 'circulation'
  | 'adjacency'
  | 'proportion'
  | 'service'
  | 'orientation'
  | 'furniture';

// ─── Mistake Checks ──────────────────────────────────────────────────────

/**
 * Run all common-mistake checks on a layout.
 * Returns a list of violations with severity and category.
 */
export function checkCommonMistakes(layout: LayoutAnalysis): NormViolation[] {
  const violations: NormViolation[] = [];
  const roomMap = new Map(layout.rooms.map(r => [r.id, r]));

  violations.push(...checkPrivacyViolations(layout, roomMap));
  violations.push(...checkCirculationProblems(layout, roomMap));
  violations.push(...checkAdjacencyErrors(layout, roomMap));
  violations.push(...checkProportionalIssues(layout, roomMap));
  violations.push(...checkOrientationMistakes(layout, roomMap));
  violations.push(...checkFurniturePlacement(layout, roomMap));

  return violations;
}

// ─── Privacy Violations ──────────────────────────────────────────────────

function checkPrivacyViolations(
  layout: LayoutAnalysis,
  roomMap: Map<string, LayoutRoom>
): NormViolation[] {
  const violations: NormViolation[] = [];
  const bedroomTypes: ExtendedRoomType[] = [
    'masterBedroom', 'bedroom', 'childBedroom', 'guestBedroom',
  ];
  const bathroomTypes: ExtendedRoomType[] = [
    'masterBathroom', 'attachedBathroom', 'commonBathroom', 'guestToilet',
  ];

  for (const room of layout.rooms) {
    // Bedroom directly opens to entry (no privacy buffer)
    if (bedroomTypes.includes(room.type) && room.opensToEntry) {
      violations.push({
        code: 'MISTAKE-PRIV-001',
        message: `${ROOM_METADATA.get(room.type)?.label ?? room.type} opens directly to entry — no privacy buffer`,
        normReference: 'Architectural best practice',
        severity: 'warning',
        category: 'privacy',
        entityId: room.id,
      });
    }

    // Bathroom door visible from living/dining
    if (bathroomTypes.includes(room.type) && room.doorVisibleFromLiving) {
      violations.push({
        code: 'MISTAKE-PRIV-002',
        message: `${ROOM_METADATA.get(room.type)?.label ?? room.type} door is visible from living/dining area`,
        normReference: 'Architectural best practice',
        severity: 'warning',
        category: 'privacy',
        entityId: room.id,
      });
    }

    // Bedroom opens directly to kitchen
    if (bedroomTypes.includes(room.type)) {
      const adjacentKitchen = room.adjacentRoomIds.some(id => {
        const adj = roomMap.get(id);
        return adj?.type === 'kitchen';
      });
      if (adjacentKitchen) {
        violations.push({
          code: 'MISTAKE-PRIV-003',
          message: `${ROOM_METADATA.get(room.type)?.label ?? room.type} opens directly to kitchen — privacy and odor concern`,
          normReference: 'Residential design practice',
          severity: 'warning',
          category: 'privacy',
          entityId: room.id,
        });
      }
    }
  }

  return violations;
}

// ─── Circulation Problems ────────────────────────────────────────────────

function checkCirculationProblems(
  layout: LayoutAnalysis,
  roomMap: Map<string, LayoutRoom>
): NormViolation[] {
  const violations: NormViolation[] = [];
  const corridorTypes: ExtendedRoomType[] = ['corridor', 'passage'];

  for (const room of layout.rooms) {
    // Dead-end corridor (only 1 connection)
    if (corridorTypes.includes(room.type) && room.adjacentRoomIds.length <= 1) {
      violations.push({
        code: 'MISTAKE-CIRC-001',
        message: `${ROOM_METADATA.get(room.type)?.label ?? room.type} is a dead end — connects to only ${room.adjacentRoomIds.length} room(s)`,
        normReference: 'Circulation efficiency',
        severity: 'warning',
        category: 'circulation',
        entityId: room.id,
      });
    }

    // Corridor too wide (wasteful area)
    if (corridorTypes.includes(room.type) && room.minSpan > 1.8) {
      violations.push({
        code: 'MISTAKE-CIRC-002',
        message: `${ROOM_METADATA.get(room.type)?.label ?? room.type} width ${room.minSpan.toFixed(2)}m is wider than needed (>1.8m) — area being wasted`,
        normReference: 'Area efficiency',
        severity: 'info',
        category: 'proportion',
        entityId: room.id,
      });
    }
  }

  return violations;
}

// ─── Adjacency Errors ────────────────────────────────────────────────────

function checkAdjacencyErrors(
  layout: LayoutAnalysis,
  roomMap: Map<string, LayoutRoom>
): NormViolation[] {
  const violations: NormViolation[] = [];

  for (const room of layout.rooms) {
    const meta = ROOM_METADATA.get(room.type);
    if (!meta) continue;

    // Check adjacency repulsions (rooms that should NOT be next to each other)
    for (const adjId of room.adjacentRoomIds) {
      const adjRoom = roomMap.get(adjId);
      if (!adjRoom) continue;

      if (meta.adjacencyRepulsions.includes(adjRoom.type)) {
        violations.push({
          code: 'MISTAKE-ADJ-001',
          message: `${meta.label} should not be adjacent to ${ROOM_METADATA.get(adjRoom.type)?.label ?? adjRoom.type}`,
          normReference: 'Room adjacency guidelines',
          severity: 'warning',
          category: 'adjacency',
          entityId: room.id,
        });
      }
    }

    // Kitchen not accessible from entry/service area (carrying groceries)
    if (room.type === 'kitchen') {
      const entryRoom = layout.rooms.find(r => r.id === layout.entryId);
      if (entryRoom) {
        // Check if kitchen has a reasonable path to entry (within 2 rooms)
        const hasReasonablePath = room.opensToEntry || 
          room.adjacentRoomIds.some(id => {
            const adj = roomMap.get(id);
            return adj?.opensToEntry || adj?.type === 'corridor' || adj?.type === 'foyer';
          });
        if (!hasReasonablePath) {
          violations.push({
            code: 'MISTAKE-ADJ-002',
            message: 'Kitchen has no convenient access from entry — service/grocery carrying is difficult',
            normReference: 'Functional layout practice',
            severity: 'info',
            category: 'service',
            entityId: room.id,
          });
        }
      }
    }
  }

  return violations;
}

// ─── Proportional Issues ─────────────────────────────────────────────────

function checkProportionalIssues(
  layout: LayoutAnalysis,
  roomMap: Map<string, LayoutRoom>
): NormViolation[] {
  const violations: NormViolation[] = [];

  for (const room of layout.rooms) {
    const meta = ROOM_METADATA.get(room.type);
    if (!meta) continue;

    // Balcony too narrow (unusable)
    if ((room.type === 'balcony' || room.type === 'dryBalcony') && room.minSpan < 1.2) {
      violations.push({
        code: 'MISTAKE-PROP-001',
        message: `${meta.label} depth ${room.minSpan.toFixed(2)}m is too narrow to be usable (need ≥1.2m)`,
        normReference: 'Practical usability',
        severity: 'warning',
        category: 'proportion',
        entityId: room.id,
      });
    }

    // Room aspect ratio too extreme
    if (room.maxSpan > 0 && room.minSpan > 0) {
      const aspectRatio = room.maxSpan / room.minSpan;
      if (aspectRatio > 2.5 && !['corridor', 'passage', 'balcony'].includes(room.type)) {
        violations.push({
          code: 'MISTAKE-PROP-002',
          message: `${meta.label} aspect ratio ${aspectRatio.toFixed(1)}:1 is too elongated — uncomfortable proportions`,
          normReference: 'Room proportion guidelines',
          severity: 'warning',
          category: 'proportion',
          entityId: room.id,
        });
      }
    }

    // Room too large for its type (waste of area)
    if (room.area > meta.area.max * 1.3) {
      violations.push({
        code: 'MISTAKE-PROP-003',
        message: `${meta.label} area ${room.area.toFixed(1)}m² is significantly larger than typical maximum ${meta.area.max}m² — consider if area is being wasted`,
        normReference: 'Efficient area allocation',
        severity: 'info',
        category: 'proportion',
        entityId: room.id,
      });
    }

    // Room too small (below practical minimum)
    if (room.area < meta.area.min * 0.9) {
      violations.push({
        code: 'MISTAKE-PROP-004',
        message: `${meta.label} area ${room.area.toFixed(1)}m² is below practical minimum ${meta.area.min}m²`,
        normReference: 'Room size guidelines',
        severity: 'warning',
        category: 'proportion',
        entityId: room.id,
      });
    }
  }

  return violations;
}

// ─── Orientation Mistakes ────────────────────────────────────────────────

function checkOrientationMistakes(
  layout: LayoutAnalysis,
  roomMap: Map<string, LayoutRoom>
): NormViolation[] {
  const violations: NormViolation[] = [];

  // In Indian climate, west-facing master bedroom gets harsh afternoon sun
  const WEST_START = Math.PI * 0.65;  // roughly 220° from north
  const WEST_END = Math.PI * 0.85;    // roughly 290° from north

  for (const room of layout.rooms) {
    if (room.type === 'masterBedroom' && room.hasExteriorWall) {
      const orientation = ((room.primaryOrientation % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      if (orientation >= WEST_START && orientation <= WEST_END) {
        violations.push({
          code: 'MISTAKE-ORIENT-001',
          message: 'Master bedroom faces west — harsh afternoon sun in Indian climate. Consider east or north orientation.',
          normReference: 'Climate-responsive design',
          severity: 'info',
          category: 'orientation',
          entityId: room.id,
        });
      }
    }

    // Kitchen without exhaust wall (needs exterior wall for chimney/exhaust)
    if (room.type === 'kitchen' && !room.hasExteriorWall) {
      violations.push({
        code: 'MISTAKE-ORIENT-002',
        message: 'Kitchen has no exterior wall — exhaust/chimney venting will be problematic',
        normReference: 'Kitchen ventilation practice',
        severity: 'warning',
        category: 'orientation',
        entityId: room.id,
      });
    }
  }

  return violations;
}

// ─── Furniture Placement Concerns ────────────────────────────────────────

function checkFurniturePlacement(
  layout: LayoutAnalysis,
  roomMap: Map<string, LayoutRoom>
): NormViolation[] {
  const violations: NormViolation[] = [];

  for (const room of layout.rooms) {
    // Attached bathroom: door should not face the bed head
    // (Heuristic: if bathroom is adjacent to master bedroom, flag if it's the smallest-dimension wall)
    if (room.type === 'masterBathroom' || room.type === 'attachedBathroom') {
      // This is a soft check — we just flag it for attention
      const parentBedroom = room.adjacentRoomIds.find(id => {
        const adj = roomMap.get(id);
        return adj && ['masterBedroom', 'bedroom', 'childBedroom', 'guestBedroom'].includes(adj.type);
      });
      if (parentBedroom) {
        const bedroom = roomMap.get(parentBedroom)!;
        if (bedroom.minSpan < 2.7) {
          violations.push({
            code: 'MISTAKE-FURN-001',
            message: `${ROOM_METADATA.get(room.type)?.label ?? room.type} — ensure door placement doesn't face the bed headboard`,
            normReference: 'Bedroom design practice',
            severity: 'info',
            category: 'furniture',
            entityId: room.id,
          });
        }
      }
    }

    // Living room too narrow for L-shaped sofa placement
    if (room.type === 'living' && room.minSpan < 3.0) {
      violations.push({
        code: 'MISTAKE-FURN-002',
        message: `Living room width ${room.minSpan.toFixed(2)}m may be too narrow for L-sofa + TV arrangement`,
        normReference: 'Furniture clearance guidelines',
        severity: 'info',
        category: 'furniture',
        entityId: room.id,
      });
    }

    // Dining room too small for table + chairs
    if (room.type === 'dining' && room.area < 8 && room.minSpan < 2.7) {
      violations.push({
        code: 'MISTAKE-FURN-003',
        message: 'Dining area may be too small for a standard 6-seater dining table',
        normReference: 'Furniture clearance guidelines',
        severity: 'info',
        category: 'furniture',
        entityId: room.id,
      });
    }
  }

  return violations;
}

/**
 * Get a summary of all mistake categories and their descriptions
 * (useful for UI filter/legend).
 */
export function getMistakeCategories(): Array<{
  category: MistakeCategory;
  label: string;
  description: string;
}> {
  return [
    { category: 'privacy', label: 'Privacy', description: 'Rooms lacking visual/acoustic privacy from public areas' },
    { category: 'circulation', label: 'Circulation', description: 'Dead-end corridors, door clashes, wasteful passage areas' },
    { category: 'adjacency', label: 'Adjacency', description: 'Incompatible rooms placed next to each other' },
    { category: 'proportion', label: 'Proportions', description: 'Rooms too elongated, too large, or too small for function' },
    { category: 'service', label: 'Service Access', description: 'Kitchen/utility access from entry, servant entry' },
    { category: 'orientation', label: 'Orientation', description: 'Climate-inappropriate room placement' },
    { category: 'furniture', label: 'Furniture', description: 'Room dimensions incompatible with standard furniture' },
  ];
}
