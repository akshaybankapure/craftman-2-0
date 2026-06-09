/**
 * Loft Rules — Indian residential loft computation.
 *
 * NBC 2016 allows lofts (mezzanine within a room) under specific conditions.
 * Developers use lofts to maximize usable area without consuming FSI. This
 * module computes loft eligibility, dimensions, and area.
 *
 * Key Rules (NBC 2016 + common practice):
 *   - Loft permitted when floor-to-ceiling ≥ 4.5m
 *   - Loft area ≤ 25% of room carpet area (some authorities allow 33%)
 *   - Minimum headroom below loft: 2.2m (habitable) / 2.0m (non-habitable)
 *   - Minimum headroom on loft: 1.5m
 *   - Loft only over specific room types (living, bedroom, not bathroom)
 *   - Loft doesn't count toward FSI in most jurisdictions
 *   - Loft must have independent access (ladder/staircase within room)
 */

import type { ExtendedRoomType } from './roomTypes';
import { ROOM_METADATA } from './roomTypes';
import type { NormViolation } from './buildingNorms';

// ─── Constants ───────────────────────────────────────────────────────────

/** Minimum floor-to-ceiling height for loft eligibility (m). */
const MIN_CEILING_FOR_LOFT = 4.5;

/** Maximum loft area as fraction of room carpet area. */
const MAX_LOFT_AREA_FRACTION = 0.25;

/** Minimum clear headroom below the loft platform (m). */
const MIN_HEADROOM_BELOW = 2.2;

/** Minimum clear headroom on top of the loft (m). */
const MIN_HEADROOM_ON_LOFT = 1.5;

/** Minimum loft width (m) for usable loft space. */
const MIN_LOFT_WIDTH = 1.5;

/** Minimum loft depth (m). */
const MIN_LOFT_DEPTH = 1.5;

/** Typical loft slab thickness (m). */
const LOFT_SLAB_THICKNESS = 0.15;

/** Room types that can have lofts above them. */
const LOFT_ELIGIBLE_TYPES: ExtendedRoomType[] = [
  'living', 'masterBedroom', 'bedroom', 'childBedroom',
  'guestBedroom', 'drawingRoom', 'study',
];

// ─── Types ───────────────────────────────────────────────────────────────

export interface LoftEligibility {
  eligible: boolean;
  reason: string;
  maxLoftArea: number;       // m²
  headroomBelow: number;     // m (available)
  headroomOnLoft: number;    // m (available)
  loftHeight: number;        // m (floor of loft above room floor)
}

export interface LoftDesign {
  /** Room this loft belongs to. */
  roomId: string;
  roomType: ExtendedRoomType;
  /** Loft area (m²). */
  area: number;
  /** Loft width (m) — typically spans one wall. */
  width: number;
  /** Loft depth (m) — how far it projects into the room. */
  depth: number;
  /** Height of loft floor above room floor (m). */
  platformHeight: number;
  /** Headroom below loft (m). */
  headroomBelow: number;
  /** Headroom on loft (m). */
  headroomOnLoft: number;
  /** Whether this loft counts toward FSI. */
  countsTowardFSI: boolean;
}

// ─── Computation Functions ───────────────────────────────────────────────

/**
 * Check if a room is eligible for a loft.
 */
export function checkLoftEligibility(
  roomType: ExtendedRoomType,
  roomArea: number,
  ceilingHeight: number
): LoftEligibility {
  // Check room type
  const meta = ROOM_METADATA.get(roomType);
  if (!meta?.canBeLoft || !LOFT_ELIGIBLE_TYPES.includes(roomType)) {
    return {
      eligible: false,
      reason: `${meta?.label ?? roomType} is not eligible for a loft`,
      maxLoftArea: 0,
      headroomBelow: ceilingHeight,
      headroomOnLoft: 0,
      loftHeight: 0,
    };
  }

  // Check ceiling height
  if (ceilingHeight < MIN_CEILING_FOR_LOFT) {
    return {
      eligible: false,
      reason: `Ceiling height ${ceilingHeight.toFixed(2)}m is below ${MIN_CEILING_FOR_LOFT}m minimum for loft`,
      maxLoftArea: 0,
      headroomBelow: ceilingHeight,
      headroomOnLoft: 0,
      loftHeight: 0,
    };
  }

  // Compute dimensions
  const maxLoftArea = roomArea * MAX_LOFT_AREA_FRACTION;
  const platformHeight = MIN_HEADROOM_BELOW + LOFT_SLAB_THICKNESS;
  const headroomOnLoft = ceilingHeight - platformHeight;

  if (headroomOnLoft < MIN_HEADROOM_ON_LOFT) {
    return {
      eligible: false,
      reason: `Insufficient headroom on loft: ${headroomOnLoft.toFixed(2)}m (need ${MIN_HEADROOM_ON_LOFT}m)`,
      maxLoftArea: 0,
      headroomBelow: MIN_HEADROOM_BELOW,
      headroomOnLoft,
      loftHeight: platformHeight,
    };
  }

  return {
    eligible: true,
    reason: 'Loft eligible — sufficient ceiling height and room type',
    maxLoftArea,
    headroomBelow: MIN_HEADROOM_BELOW,
    headroomOnLoft,
    loftHeight: platformHeight,
  };
}

/**
 * Design a loft for a room — computes optimal dimensions.
 */
export function designLoft(
  roomId: string,
  roomType: ExtendedRoomType,
  roomArea: number,
  roomWidth: number,
  roomDepth: number,
  ceilingHeight: number,
  targetAreaFraction: number = MAX_LOFT_AREA_FRACTION
): LoftDesign | null {
  const eligibility = checkLoftEligibility(roomType, roomArea, ceilingHeight);
  if (!eligibility.eligible) return null;

  // Compute loft area
  const fraction = Math.min(targetAreaFraction, MAX_LOFT_AREA_FRACTION);
  const loftArea = roomArea * fraction;

  // Loft typically spans the full width of one wall and projects inward
  const width = Math.max(MIN_LOFT_WIDTH, roomWidth);
  const depth = Math.max(MIN_LOFT_DEPTH, loftArea / width);

  // Clamp depth to not exceed room depth
  const clampedDepth = Math.min(depth, roomDepth * 0.5); // never more than half the room
  const actualArea = width * clampedDepth;

  return {
    roomId,
    roomType,
    area: actualArea,
    width,
    depth: clampedDepth,
    platformHeight: eligibility.loftHeight,
    headroomBelow: eligibility.headroomBelow,
    headroomOnLoft: eligibility.headroomOnLoft,
    countsTowardFSI: false, // typically doesn't count
  };
}

/**
 * Validate loft design against norms.
 */
export function validateLoft(loft: LoftDesign, roomArea: number): NormViolation[] {
  const violations: NormViolation[] = [];

  if (loft.area > roomArea * MAX_LOFT_AREA_FRACTION * 1.01) { // 1% tolerance
    violations.push({
      code: 'LOFT-AREA-001',
      message: `Loft area ${loft.area.toFixed(1)}m² exceeds ${(MAX_LOFT_AREA_FRACTION * 100)}% of room area (${(roomArea * MAX_LOFT_AREA_FRACTION).toFixed(1)}m²)`,
      normReference: 'NBC 2016 — Loft provisions',
      severity: 'error',
      category: 'area',
      entityId: loft.roomId,
      actual: loft.area,
      required: roomArea * MAX_LOFT_AREA_FRACTION,
    });
  }

  if (loft.headroomBelow < MIN_HEADROOM_BELOW) {
    violations.push({
      code: 'LOFT-HEIGHT-001',
      message: `Headroom below loft ${loft.headroomBelow.toFixed(2)}m is below minimum ${MIN_HEADROOM_BELOW}m`,
      normReference: 'NBC 2016 — Minimum heights',
      severity: 'error',
      category: 'height',
      entityId: loft.roomId,
      actual: loft.headroomBelow,
      required: MIN_HEADROOM_BELOW,
    });
  }

  if (loft.headroomOnLoft < MIN_HEADROOM_ON_LOFT) {
    violations.push({
      code: 'LOFT-HEIGHT-002',
      message: `Headroom on loft ${loft.headroomOnLoft.toFixed(2)}m is below minimum ${MIN_HEADROOM_ON_LOFT}m`,
      normReference: 'NBC 2016 — Loft headroom',
      severity: 'error',
      category: 'height',
      entityId: loft.roomId,
      actual: loft.headroomOnLoft,
      required: MIN_HEADROOM_ON_LOFT,
    });
  }

  if (loft.width < MIN_LOFT_WIDTH) {
    violations.push({
      code: 'LOFT-DIM-001',
      message: `Loft width ${loft.width.toFixed(2)}m is below minimum ${MIN_LOFT_WIDTH}m`,
      normReference: 'Practical minimum',
      severity: 'warning',
      category: 'dimension',
      entityId: loft.roomId,
      actual: loft.width,
      required: MIN_LOFT_WIDTH,
    });
  }

  return violations;
}

/**
 * Get a summary of loft rules for UI display.
 */
export function getLoftRulesSummary(): {
  minCeiling: number;
  maxAreaFraction: number;
  minHeadroomBelow: number;
  minHeadroomOnLoft: number;
  eligibleRoomTypes: ExtendedRoomType[];
} {
  return {
    minCeiling: MIN_CEILING_FOR_LOFT,
    maxAreaFraction: MAX_LOFT_AREA_FRACTION,
    minHeadroomBelow: MIN_HEADROOM_BELOW,
    minHeadroomOnLoft: MIN_HEADROOM_ON_LOFT,
    eligibleRoomTypes: [...LOFT_ELIGIBLE_TYPES],
  };
}
