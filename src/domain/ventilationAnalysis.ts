/**
 * Ventilation & Natural Light Analysis.
 *
 * NBC 2016 mandates that habitable rooms have adequate ventilation and
 * natural light. This module analyzes a floor plan's performance:
 *
 *   - Window-to-floor-area ratio (WFAR) per room
 *   - Cross-ventilation potential (openings on 2+ walls)
 *   - Light penetration depth estimation
 *   - Dark room detection (rooms with no/insufficient natural light)
 *   - Ventilation scoring per room and per floor
 *
 * The analysis is geometry-based: it uses the room's exterior wall length
 * and window placements to estimate performance. Not a CFD simulation,
 * but accurate enough for early-stage layout decisions.
 */

import type { ExtendedRoomType } from './roomTypes';
import { ROOM_METADATA } from './roomTypes';
import type { NormViolation } from './buildingNorms';

// ─── Constants ───────────────────────────────────────────────────────────

/** NBC 2016: minimum openable window area = 1/10 of floor area for habitable rooms. */
const NBC_WFAR_MIN = 0.10;

/** Rule of thumb: daylight penetrates ~2x the window head height. */
const DAYLIGHT_PENETRATION_FACTOR = 2.0;

/** Typical window head height (m) from floor. */
const TYPICAL_WINDOW_HEAD_HEIGHT = 2.4;

/** Minimum exterior wall length (m) to place a usable window. */
const MIN_WALL_FOR_WINDOW = 0.9;

/** Ideal WFAR for good daylighting (above NBC minimum). */
const IDEAL_WFAR = 0.20;

// ─── Types ───────────────────────────────────────────────────────────────

export interface RoomVentilationData {
  id: string;
  type: ExtendedRoomType;
  area: number;                    // m²
  /** Which walls have exterior exposure. */
  exteriorWalls: Array<{
    wallId: string;
    length: number;                // m
    orientation: number;           // radians from north (0=N, π/2=E, etc.)
  }>;
  /** Window openings (if specified; otherwise estimated from exterior walls). */
  windows: Array<{
    wallId: string;
    width: number;                 // m
    height: number;                // m
    headHeight: number;            // m above floor
  }>;
  /** Room's shortest dimension (for penetration depth check). */
  depth: number;                   // m (perpendicular to primary window wall)
}

export interface VentilationScore {
  roomId: string;
  roomType: ExtendedRoomType;
  /** Window-to-Floor Area Ratio (≥0.10 required by NBC). */
  wfar: number;
  /** Whether WFAR meets NBC minimum. */
  meetsNBC: boolean;
  /** Whether WFAR meets ideal threshold. */
  meetsIdeal: boolean;
  /** Does the room have openings on 2+ distinct walls? */
  hasCrossVentilation: boolean;
  /** Number of walls with exterior exposure. */
  exposedWallCount: number;
  /** Total exterior wall length (m). */
  totalExteriorWallLength: number;
  /** Estimated daylight penetration depth (m). */
  daylightDepth: number;
  /** Is the room depth within daylight penetration? */
  adequateDaylight: boolean;
  /** Overall ventilation quality (0-1). */
  score: number;
  /** Human-readable assessment. */
  assessment: 'excellent' | 'good' | 'adequate' | 'poor' | 'dark';
}

export interface FloorVentilationAnalysis {
  rooms: VentilationScore[];
  /** Fraction of habitable rooms with adequate ventilation (0-1). */
  complianceRate: number;
  /** Fraction of rooms with cross-ventilation (0-1). */
  crossVentilationRate: number;
  /** Average ventilation score across all habitable rooms. */
  averageScore: number;
  /** Rooms identified as "dark" (no adequate natural light). */
  darkRooms: string[];
  violations: NormViolation[];
}

// ─── Analysis Functions ──────────────────────────────────────────────────

/**
 * Analyze ventilation quality for a single room.
 */
export function analyzeRoomVentilation(room: RoomVentilationData): VentilationScore {
  const meta = ROOM_METADATA.get(room.type);
  const needsLight = meta?.naturalLightRequired ?? false;

  // Compute total window area
  let totalWindowArea = 0;
  const wallsWithWindows = new Set<string>();

  if (room.windows.length > 0) {
    for (const win of room.windows) {
      totalWindowArea += win.width * win.height;
      wallsWithWindows.add(win.wallId);
    }
  } else {
    // Estimate: assume 50% of each exterior wall can be window
    for (const wall of room.exteriorWalls) {
      if (wall.length >= MIN_WALL_FOR_WINDOW) {
        const estimatedWindowWidth = wall.length * 0.5;
        const estimatedWindowHeight = 1.2; // standard window height
        totalWindowArea += estimatedWindowWidth * estimatedWindowHeight;
        wallsWithWindows.add(wall.wallId);
      }
    }
  }

  // WFAR
  const wfar = room.area > 0 ? totalWindowArea / room.area : 0;
  const meetsNBC = !needsLight || wfar >= NBC_WFAR_MIN;
  const meetsIdeal = wfar >= IDEAL_WFAR;

  // Cross-ventilation: needs openings on 2+ distinct walls
  // Group walls by orientation quadrant to check if they're on different sides
  const orientations = new Set<number>();
  for (const wall of room.exteriorWalls) {
    if (wallsWithWindows.has(wall.wallId) || room.windows.length === 0) {
      // Quantize orientation to 4 quadrants
      const quadrant = Math.round(wall.orientation / (Math.PI / 2)) % 4;
      orientations.add(quadrant);
    }
  }
  const hasCrossVent = orientations.size >= 2;

  // Daylight penetration depth
  const maxWindowHead = room.windows.length > 0
    ? Math.max(...room.windows.map(w => w.headHeight))
    : TYPICAL_WINDOW_HEAD_HEIGHT;
  const daylightDepth = maxWindowHead * DAYLIGHT_PENETRATION_FACTOR;
  const adequateDaylight = room.depth <= daylightDepth;

  // Exposed wall metrics
  const exposedWallCount = room.exteriorWalls.length;
  const totalExteriorWallLength = room.exteriorWalls.reduce((s, w) => s + w.length, 0);

  // Overall score (0-1)
  let score = 0;
  if (!needsLight) {
    score = 1.0; // non-habitable rooms always pass
  } else {
    // WFAR component (0-0.4)
    const wfarScore = Math.min(1, wfar / IDEAL_WFAR) * 0.4;
    // Cross-vent component (0-0.25)
    const crossVentScore = hasCrossVent ? 0.25 : 0;
    // Daylight depth component (0-0.2)
    const depthScore = adequateDaylight ? 0.2 : (daylightDepth / Math.max(room.depth, 1)) * 0.2;
    // Exterior wall exposure component (0-0.15)
    const exposureScore = Math.min(1, exposedWallCount / 2) * 0.15;

    score = wfarScore + crossVentScore + depthScore + exposureScore;
  }

  // Assessment
  let assessment: VentilationScore['assessment'];
  if (score >= 0.85) assessment = 'excellent';
  else if (score >= 0.65) assessment = 'good';
  else if (score >= 0.45) assessment = 'adequate';
  else if (score >= 0.2) assessment = 'poor';
  else assessment = 'dark';

  return {
    roomId: room.id,
    roomType: room.type,
    wfar,
    meetsNBC,
    meetsIdeal,
    hasCrossVentilation: hasCrossVent,
    exposedWallCount,
    totalExteriorWallLength,
    daylightDepth,
    adequateDaylight,
    score,
    assessment,
  };
}

/**
 * Analyze ventilation for an entire floor.
 */
export function analyzeFloorVentilation(
  rooms: RoomVentilationData[]
): FloorVentilationAnalysis {
  const scores = rooms.map(r => analyzeRoomVentilation(r));
  const violations: NormViolation[] = [];

  // Habitable rooms only
  const habitableScores = scores.filter(s => {
    const meta = ROOM_METADATA.get(s.roomType);
    return meta?.naturalLightRequired ?? false;
  });

  // Dark rooms
  const darkRooms = habitableScores
    .filter(s => s.assessment === 'dark' || s.assessment === 'poor')
    .map(s => s.roomId);

  // Compliance rate
  const compliant = habitableScores.filter(s => s.meetsNBC).length;
  const complianceRate = habitableScores.length > 0
    ? compliant / habitableScores.length
    : 1;

  // Cross-vent rate
  const crossVent = habitableScores.filter(s => s.hasCrossVentilation).length;
  const crossVentilationRate = habitableScores.length > 0
    ? crossVent / habitableScores.length
    : 0;

  // Average score
  const averageScore = habitableScores.length > 0
    ? habitableScores.reduce((s, r) => s + r.score, 0) / habitableScores.length
    : 1;

  // Generate violations
  for (const score of habitableScores) {
    const meta = ROOM_METADATA.get(score.roomType);
    
    if (!score.meetsNBC) {
      violations.push({
        code: 'VENT-WFAR-001',
        message: `${meta?.label ?? score.roomType} WFAR ${(score.wfar * 100).toFixed(1)}% is below NBC minimum ${(NBC_WFAR_MIN * 100)}%`,
        normReference: 'NBC 2016 Part 8, Cl. 5.3',
        severity: 'error',
        category: 'ventilation',
        entityId: score.roomId,
        actual: score.wfar,
        required: NBC_WFAR_MIN,
      });
    }

    if (score.exposedWallCount === 0) {
      violations.push({
        code: 'VENT-DARK-001',
        message: `${meta?.label ?? score.roomType} has no exterior wall — no natural light possible`,
        normReference: 'NBC 2016 Part 8',
        severity: 'error',
        category: 'ventilation',
        entityId: score.roomId,
      });
    }

    if (!score.adequateDaylight && score.exposedWallCount > 0) {
      violations.push({
        code: 'VENT-DEPTH-001',
        message: `${meta?.label ?? score.roomType} depth exceeds daylight penetration (${score.daylightDepth.toFixed(1)}m)`,
        normReference: 'Daylighting best practice',
        severity: 'warning',
        category: 'ventilation',
        entityId: score.roomId,
      });
    }
  }

  return {
    rooms: scores,
    complianceRate,
    crossVentilationRate,
    averageScore,
    darkRooms,
    violations,
  };
}

/**
 * Quick check: does a room at this position have adequate exterior exposure?
 * Used during layout generation to flag problems early.
 */
export function hasAdequateExposure(
  roomType: ExtendedRoomType,
  exteriorWallLength: number,
  roomArea: number
): boolean {
  const meta = ROOM_METADATA.get(roomType);
  if (!meta?.requiresExteriorWall) return true;

  // Need enough wall for a window (min 0.9m)
  if (exteriorWallLength < MIN_WALL_FOR_WINDOW) return false;

  // Rough check: can we get 1/10 WFAR?
  // Assume window height 1.2m, width = 50% of exterior wall
  const estimatedWindowArea = exteriorWallLength * 0.5 * 1.2;
  return roomArea > 0 && estimatedWindowArea / roomArea >= NBC_WFAR_MIN;
}
