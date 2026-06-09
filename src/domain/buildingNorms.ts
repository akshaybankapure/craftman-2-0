/**
 * Building Norms — NBC 2016 (India) codified as validation rules.
 *
 * This module encodes the National Building Code of India 2016 provisions
 * relevant to residential floor-plan design. Each norm is a pure function
 * that takes a unit/floor/building plan and returns violations.
 *
 * The architecture is EXTENSIBLE: implement BuildingNormSet for other
 * jurisdictions (IBC for USA, EN for Europe, etc.) and swap at runtime.
 *
 * Key NBC 2016 provisions encoded here:
 *   - Minimum habitable room areas (Table 8, Part 3)
 *   - Minimum room dimensions
 *   - Corridor widths (internal / common / fire escape)
 *   - Ventilation openings (1/10th floor area for habitable rooms)
 *   - Staircase dimensions (width, riser, tread)
 *   - Kitchen chimney/exhaust provisions
 *   - Bathroom minimum sizes
 *   - Height restrictions
 *   - Setback rules (simplified)
 *   - FSI/FAR calculations
 */

import type { ExtendedRoomType } from './roomTypes';
import { ROOM_METADATA } from './roomTypes';

// ─── Violation Types ─────────────────────────────────────────────────────

export type ViolationSeverity = 'error' | 'warning' | 'info';

export type ViolationCategory =
  | 'area'
  | 'dimension'
  | 'ventilation'
  | 'circulation'
  | 'fire_safety'
  | 'plumbing'
  | 'structural'
  | 'setback'
  | 'fsi'
  | 'height'
  | 'accessibility'
  | 'privacy'
  | 'proportion'
  | 'adjacency'
  | 'service'
  | 'orientation'
  | 'furniture'
  | 'general';

export interface NormViolation {
  /** Unique violation code, e.g. "NBC-AREA-001" */
  code: string;
  /** Human-readable description */
  message: string;
  /** Which norm clause this references */
  normReference: string;
  severity: ViolationSeverity;
  category: ViolationCategory;
  /** Room/entity that triggered this violation */
  entityId?: string;
  /** Current value vs required value */
  actual?: number;
  required?: number;
}

// ─── Room Data for Validation ────────────────────────────────────────────

export interface RoomData {
  id: string;
  type: ExtendedRoomType;
  area: number;           // m²
  minSpan: number;        // shortest dimension (m)
  maxSpan: number;        // longest dimension (m)
  hasExteriorWall: boolean;
  exteriorWallLength: number;  // meters of exterior wall
  windowArea: number;     // total openable window area (m²)
  ceilingHeight: number;  // m
  adjacentRooms: string[];     // IDs of rooms sharing a wall
}

export interface FloorData {
  id: string;
  rooms: RoomData[];
  corridorMinWidth: number;   // narrowest point (m)
  totalCarpetArea: number;
  totalBuiltUpArea: number;
  hasFireExit: boolean;
  maxTravelDistance: number;   // m to nearest exit
}

export interface BuildingData {
  floors: FloorData[];
  totalHeight: number;          // m
  numberOfFloors: number;
  plotArea: number;             // m²
  groundCoverage: number;       // m²
  totalBuiltUpArea: number;     // m²
  roadWidth: number;            // m (fronting road)
  frontSetback: number;         // m
  sideSetback: number;          // m
  rearSetback: number;          // m
  staircaseWidth: number;       // m
  riserHeight: number;          // mm
  treadDepth: number;           // mm
  hasLift: boolean;
  liftCount: number;
}

// ─── NBC 2016 Constants ──────────────────────────────────────────────────

/** Minimum habitable room areas per NBC 2016 Part 3, Table 8 */
const NBC_MIN_AREAS: Partial<Record<ExtendedRoomType, number>> = {
  living: 9.5,
  dining: 7.5,
  drawingRoom: 9.5,
  masterBedroom: 9.5,
  bedroom: 9.5,
  childBedroom: 7.5,
  guestBedroom: 9.5,
  kitchen: 5.0,
  commonBathroom: 1.8,
  masterBathroom: 2.8,
  attachedBathroom: 1.8,
  guestToilet: 1.1,
  servantBathroom: 1.5,
  corridor: 0,  // validated by width
  passage: 0,
  foyer: 2.0,
  entry: 1.5,
  study: 5.0,
  servantRoom: 4.5,
  pooja: 1.5,
  storage: 1.0,
  utility: 1.5,
};

/** Minimum dimensions per NBC 2016 */
const NBC_MIN_DIMENSIONS: Partial<Record<ExtendedRoomType, number>> = {
  living: 2.4,
  dining: 2.4,
  drawingRoom: 2.4,
  masterBedroom: 2.4,
  bedroom: 2.4,
  childBedroom: 2.1,
  guestBedroom: 2.4,
  kitchen: 1.8,
  commonBathroom: 1.0,
  masterBathroom: 1.2,
  attachedBathroom: 1.0,
  guestToilet: 0.9,
  servantBathroom: 0.9,
  corridor: 1.05,
  passage: 1.05,
  foyer: 1.2,
  entry: 1.0,
  servantRoom: 2.1,
  balcony: 1.2,
  dryBalcony: 0.9,
};

/** Minimum ceiling heights per NBC 2016 */
const NBC_MIN_CEILING_HEIGHTS: Record<string, number> = {
  habitable: 2.75,   // living, bedroom, kitchen
  bathroom: 2.4,
  corridor: 2.4,
  basement: 2.4,
  parking: 2.4,
  staircase: 2.2,
};

/** NBC staircase requirements */
const NBC_STAIRCASE = {
  minWidth: 1.0,          // meters (residential)
  maxRiserHeight: 190,    // mm
  minTreadDepth: 250,     // mm
  maxFlightsWithoutLanding: 15,  // risers
  minLandingDepth: 1.0,   // meters
};

/** NBC corridor widths */
const NBC_CORRIDOR = {
  internalMin: 1.05,      // within a unit
  commonMin: 1.5,         // common areas
  fireEscapeMin: 1.2,     // fire stairway
};

/** NBC fire safety */
const NBC_FIRE = {
  maxTravelDistanceResidential: 22.5,  // meters to nearest exit
  minExitsAbove15m: 2,                 // for buildings >15m height
};

/**
 * Simplified NBC setback rules.
 * Real setbacks depend on plot area, height, and local authority.
 * These are typical values for Mumbai/Pune metro.
 */
const NBC_SETBACKS = {
  /** Minimum front setback based on road width */
  frontByRoadWidth: [
    { roadWidth: 9, setback: 3.0 },
    { roadWidth: 12, setback: 4.5 },
    { roadWidth: 18, setback: 6.0 },
    { roadWidth: 24, setback: 6.0 },
    { roadWidth: 30, setback: 9.0 },
  ],
  sideMinResidential: 3.0,
  rearMinResidential: 3.0,
};

// ─── Validation Functions ────────────────────────────────────────────────

/** Validate a single room against NBC norms. */
export function validateRoom(room: RoomData): NormViolation[] {
  const violations: NormViolation[] = [];
  const meta = ROOM_METADATA.get(room.type);

  // 1. Minimum area check
  const minArea = NBC_MIN_AREAS[room.type];
  if (minArea !== undefined && room.area < minArea) {
    violations.push({
      code: 'NBC-AREA-001',
      message: `${meta?.label ?? room.type} area ${room.area.toFixed(1)}m² is below NBC minimum ${minArea}m²`,
      normReference: 'NBC 2016 Part 3, Table 8',
      severity: 'error',
      category: 'area',
      entityId: room.id,
      actual: room.area,
      required: minArea,
    });
  }

  // 2. Minimum dimension check
  const minDim = NBC_MIN_DIMENSIONS[room.type];
  if (minDim !== undefined && room.minSpan < minDim) {
    violations.push({
      code: 'NBC-DIM-001',
      message: `${meta?.label ?? room.type} shortest span ${room.minSpan.toFixed(2)}m is below NBC minimum ${minDim}m`,
      normReference: 'NBC 2016 Part 3, Cl. 8.2',
      severity: 'error',
      category: 'dimension',
      entityId: room.id,
      actual: room.minSpan,
      required: minDim,
    });
  }

  // 3. Ventilation check — habitable rooms need window opening ≥ 1/10 floor area
  if (meta?.naturalLightRequired) {
    const requiredWindowArea = room.area / 10;
    if (room.windowArea < requiredWindowArea) {
      violations.push({
        code: 'NBC-VENT-001',
        message: `${meta.label} window area ${room.windowArea.toFixed(2)}m² is below required ${requiredWindowArea.toFixed(2)}m² (1/10th of floor area)`,
        normReference: 'NBC 2016 Part 8, Cl. 5.3',
        severity: 'error',
        category: 'ventilation',
        entityId: room.id,
        actual: room.windowArea,
        required: requiredWindowArea,
      });
    }
  }

  // 4. Exterior wall requirement
  if (meta?.requiresExteriorWall && !room.hasExteriorWall) {
    violations.push({
      code: 'NBC-VENT-002',
      message: `${meta.label} has no exterior wall — required for ventilation/light`,
      normReference: 'NBC 2016 Part 8, Cl. 5.2',
      severity: 'error',
      category: 'ventilation',
      entityId: room.id,
    });
  }

  // 5. Ceiling height check
  const isHabitable = meta?.category === 'living' || meta?.category === 'bedroom' ||
    room.type === 'kitchen' || room.type === 'study' || room.type === 'office';
  const isBathroom = meta?.category === 'wetArea';
  
  const requiredHeight = isHabitable ? NBC_MIN_CEILING_HEIGHTS.habitable :
    isBathroom ? NBC_MIN_CEILING_HEIGHTS.bathroom :
    NBC_MIN_CEILING_HEIGHTS.corridor;
  
  if (room.ceilingHeight > 0 && room.ceilingHeight < requiredHeight) {
    violations.push({
      code: 'NBC-HEIGHT-001',
      message: `${meta?.label ?? room.type} ceiling height ${room.ceilingHeight.toFixed(2)}m is below required ${requiredHeight}m`,
      normReference: 'NBC 2016 Part 3, Cl. 8.1',
      severity: 'error',
      category: 'height',
      entityId: room.id,
      actual: room.ceilingHeight,
      required: requiredHeight,
    });
  }

  // 6. Aspect ratio check (practical, not strictly NBC)
  if (meta && room.maxSpan > 0 && room.minSpan > 0) {
    const aspectRatio = room.maxSpan / room.minSpan;
    if (aspectRatio > meta.aspectRatio.max) {
      violations.push({
        code: 'NBC-SHAPE-001',
        message: `${meta.label} aspect ratio ${aspectRatio.toFixed(1)} exceeds recommended maximum ${meta.aspectRatio.max}`,
        normReference: 'Best practice — room proportions',
        severity: 'warning',
        category: 'dimension',
        entityId: room.id,
        actual: aspectRatio,
        required: meta.aspectRatio.max,
      });
    }
  }

  return violations;
}

/** Validate a floor (collection of rooms + circulation). */
export function validateFloor(floor: FloorData): NormViolation[] {
  const violations: NormViolation[] = [];

  // Validate each room
  for (const room of floor.rooms) {
    violations.push(...validateRoom(room));
  }

  // Corridor width check
  if (floor.corridorMinWidth > 0 && floor.corridorMinWidth < NBC_CORRIDOR.internalMin) {
    violations.push({
      code: 'NBC-CORR-001',
      message: `Internal corridor width ${floor.corridorMinWidth.toFixed(2)}m is below NBC minimum ${NBC_CORRIDOR.internalMin}m`,
      normReference: 'NBC 2016 Part 3, Cl. 8.3',
      severity: 'error',
      category: 'circulation',
      actual: floor.corridorMinWidth,
      required: NBC_CORRIDOR.internalMin,
    });
  }

  // Fire exit travel distance
  if (floor.maxTravelDistance > NBC_FIRE.maxTravelDistanceResidential) {
    violations.push({
      code: 'NBC-FIRE-001',
      message: `Max travel distance ${floor.maxTravelDistance.toFixed(1)}m exceeds NBC limit ${NBC_FIRE.maxTravelDistanceResidential}m`,
      normReference: 'NBC 2016 Part 4, Fire Safety',
      severity: 'error',
      category: 'fire_safety',
      actual: floor.maxTravelDistance,
      required: NBC_FIRE.maxTravelDistanceResidential,
    });
  }

  return violations;
}

/** Validate the whole building. */
export function validateBuilding(building: BuildingData): NormViolation[] {
  const violations: NormViolation[] = [];

  // Validate each floor
  for (const floor of building.floors) {
    violations.push(...validateFloor(floor));
  }

  // Staircase checks
  if (building.staircaseWidth < NBC_STAIRCASE.minWidth) {
    violations.push({
      code: 'NBC-STAIR-001',
      message: `Staircase width ${building.staircaseWidth.toFixed(2)}m is below NBC minimum ${NBC_STAIRCASE.minWidth}m`,
      normReference: 'NBC 2016 Part 3, Cl. 9.2',
      severity: 'error',
      category: 'circulation',
      actual: building.staircaseWidth,
      required: NBC_STAIRCASE.minWidth,
    });
  }

  if (building.riserHeight > NBC_STAIRCASE.maxRiserHeight) {
    violations.push({
      code: 'NBC-STAIR-002',
      message: `Staircase riser ${building.riserHeight}mm exceeds NBC maximum ${NBC_STAIRCASE.maxRiserHeight}mm`,
      normReference: 'NBC 2016 Part 3, Cl. 9.3',
      severity: 'error',
      category: 'circulation',
      actual: building.riserHeight,
      required: NBC_STAIRCASE.maxRiserHeight,
    });
  }

  if (building.treadDepth < NBC_STAIRCASE.minTreadDepth) {
    violations.push({
      code: 'NBC-STAIR-003',
      message: `Staircase tread ${building.treadDepth}mm is below NBC minimum ${NBC_STAIRCASE.minTreadDepth}mm`,
      normReference: 'NBC 2016 Part 3, Cl. 9.3',
      severity: 'error',
      category: 'circulation',
      actual: building.treadDepth,
      required: NBC_STAIRCASE.minTreadDepth,
    });
  }

  // Setback checks
  const frontSetbackReq = getRequiredFrontSetback(building.roadWidth);
  if (building.frontSetback < frontSetbackReq) {
    violations.push({
      code: 'NBC-SETBACK-001',
      message: `Front setback ${building.frontSetback.toFixed(1)}m is below required ${frontSetbackReq}m for ${building.roadWidth}m road`,
      normReference: 'NBC 2016 Part 3, DCR',
      severity: 'error',
      category: 'setback',
      actual: building.frontSetback,
      required: frontSetbackReq,
    });
  }

  if (building.sideSetback < NBC_SETBACKS.sideMinResidential) {
    violations.push({
      code: 'NBC-SETBACK-002',
      message: `Side setback ${building.sideSetback.toFixed(1)}m is below minimum ${NBC_SETBACKS.sideMinResidential}m`,
      normReference: 'NBC 2016 Part 3, DCR',
      severity: 'error',
      category: 'setback',
      actual: building.sideSetback,
      required: NBC_SETBACKS.sideMinResidential,
    });
  }

  if (building.rearSetback < NBC_SETBACKS.rearMinResidential) {
    violations.push({
      code: 'NBC-SETBACK-003',
      message: `Rear setback ${building.rearSetback.toFixed(1)}m is below minimum ${NBC_SETBACKS.rearMinResidential}m`,
      normReference: 'NBC 2016 Part 3, DCR',
      severity: 'error',
      category: 'setback',
      actual: building.rearSetback,
      required: NBC_SETBACKS.rearMinResidential,
    });
  }

  // Lift requirement (buildings > 15m / 4 floors)
  if (building.totalHeight > 15 && !building.hasLift) {
    violations.push({
      code: 'NBC-LIFT-001',
      message: 'Buildings exceeding 15m height must have at least 1 lift',
      normReference: 'NBC 2016 Part 3, Cl. 9.5',
      severity: 'error',
      category: 'accessibility',
    });
  }

  // Multiple exits for tall buildings
  if (building.totalHeight > 15 && building.floors.some(f => !f.hasFireExit)) {
    violations.push({
      code: 'NBC-FIRE-002',
      message: 'Buildings >15m must have at least 2 independent fire exits per floor',
      normReference: 'NBC 2016 Part 4',
      severity: 'error',
      category: 'fire_safety',
    });
  }

  return violations;
}

// ─── FSI / FAR Calculations ──────────────────────────────────────────────

export interface FSIResult {
  plotArea: number;
  totalBuiltUpArea: number;
  fsi: number;
  groundCoverage: number;
  groundCoveragePercent: number;
}

export function calculateFSI(
  plotArea: number,
  totalBuiltUpArea: number,
  groundCoverage: number
): FSIResult {
  return {
    plotArea,
    totalBuiltUpArea,
    fsi: plotArea > 0 ? totalBuiltUpArea / plotArea : 0,
    groundCoverage,
    groundCoveragePercent: plotArea > 0 ? (groundCoverage / plotArea) * 100 : 0,
  };
}

/** Check if FSI is within permissible limits. */
export function validateFSI(
  fsiResult: FSIResult,
  permissibleFSI: number,
  maxGroundCoveragePercent: number
): NormViolation[] {
  const violations: NormViolation[] = [];

  if (fsiResult.fsi > permissibleFSI) {
    violations.push({
      code: 'NBC-FSI-001',
      message: `FSI ${fsiResult.fsi.toFixed(2)} exceeds permissible FSI ${permissibleFSI}`,
      normReference: 'Development Control Regulations',
      severity: 'error',
      category: 'fsi',
      actual: fsiResult.fsi,
      required: permissibleFSI,
    });
  }

  if (fsiResult.groundCoveragePercent > maxGroundCoveragePercent) {
    violations.push({
      code: 'NBC-FSI-002',
      message: `Ground coverage ${fsiResult.groundCoveragePercent.toFixed(1)}% exceeds maximum ${maxGroundCoveragePercent}%`,
      normReference: 'Development Control Regulations',
      severity: 'error',
      category: 'fsi',
      actual: fsiResult.groundCoveragePercent,
      required: maxGroundCoveragePercent,
    });
  }

  return violations;
}

// ─── Utility Functions ───────────────────────────────────────────────────

function getRequiredFrontSetback(roadWidth: number): number {
  for (const entry of NBC_SETBACKS.frontByRoadWidth) {
    if (roadWidth <= entry.roadWidth) return entry.setback;
  }
  return 9.0; // default for very wide roads
}

/** Get a summary of all norm constants (useful for UI display). */
export function getNormSummary(): {
  minAreas: Record<string, number>;
  minDimensions: Record<string, number>;
  corridorWidths: typeof NBC_CORRIDOR;
  staircaseRules: typeof NBC_STAIRCASE;
  fireRules: typeof NBC_FIRE;
} {
  return {
    minAreas: NBC_MIN_AREAS as Record<string, number>,
    minDimensions: NBC_MIN_DIMENSIONS as Record<string, number>,
    corridorWidths: NBC_CORRIDOR,
    staircaseRules: NBC_STAIRCASE,
    fireRules: NBC_FIRE,
  };
}
