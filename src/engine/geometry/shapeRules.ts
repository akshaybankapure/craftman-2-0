/**
 * Function-specific shape hard/soft rules.
 */

import { aspectRatio, type Rect } from '../kernel/orthoPolygon.ts';
import type { AccessNodeCategory } from '../../planner/types.ts';

export interface ShapeVerdict {
  ok: boolean;
  hardFail: boolean;
  reason?: string;
  score: number; // lower better
}

export function evaluateRoomShape(
  category: AccessNodeCategory,
  rect: Rect,
  area: number,
): ShapeVerdict {
  const minSide = Math.min(rect.w, rect.h);
  const maxSide = Math.max(rect.w, rect.h);
  const ar = aspectRatio(rect);

  switch (category) {
    case 'COMMON_BATHROOM':
    case 'ENSUITE_BATHROOM': {
      // Reject extreme strips e.g. ~23×4 ft (7×1.2 m) even if area OK
      if (minSide < 1.2) {
        return { ok: false, hardFail: true, reason: 'Bathroom min side < 1.2 m', score: 10 };
      }
      if (ar > 2.8) {
        return { ok: false, hardFail: true, reason: `Bathroom strip aspect ${ar.toFixed(1)}`, score: 10 };
      }
      if (area < 3.0) {
        return { ok: false, hardFail: true, reason: 'Bathroom area too small for fixtures', score: 10 };
      }
      return { ok: true, hardFail: false, score: Math.max(0, ar - 1.6) };
    }
    case 'BEDROOM': {
      if (minSide < 2.5) {
        return { ok: false, hardFail: true, reason: 'Bedroom too narrow for bed+clearance', score: 10 };
      }
      if (ar > 2.4) {
        return { ok: false, hardFail: true, reason: 'Bedroom strip shape', score: 8 };
      }
      return { ok: true, hardFail: false, score: Math.max(0, ar - 1.5) };
    }
    case 'LIVING': {
      if (minSide < 2.8) {
        return { ok: false, hardFail: true, reason: 'Living too narrow', score: 10 };
      }
      if (ar > 2.6) {
        return { ok: false, hardFail: true, reason: 'Living bowling-alley shape', score: 8 };
      }
      return { ok: true, hardFail: false, score: Math.max(0, ar - 1.4) };
    }
    case 'KITCHEN': {
      if (minSide < 1.7) {
        return { ok: false, hardFail: true, reason: 'Kitchen too narrow for clearance', score: 10 };
      }
      if (ar > 3.5) {
        return { ok: false, hardFail: false, reason: 'Kitchen elongated', score: 3 };
      }
      return { ok: true, hardFail: false, score: Math.max(0, ar - 2) };
    }
    case 'CORRIDOR': {
      // Corridors are path networks — do not score as room aspect ratio
      if (minSide < 0.9) {
        return { ok: false, hardFail: true, reason: 'Corridor narrower than 0.9 m', score: 10 };
      }
      return { ok: true, hardFail: false, score: 0 };
    }
    case 'ENTRY':
    case 'FOYER': {
      if (area > 8) {
        return { ok: false, hardFail: false, reason: 'Entry/foyer oversized', score: 2 };
      }
      return { ok: true, hardFail: false, score: Math.max(0, area - 4) * 0.2 };
    }
    default:
      if (minSide < 1.0) {
        return { ok: false, hardFail: true, reason: 'Min side < 1 m', score: 5 };
      }
      return { ok: true, hardFail: false, score: Math.max(0, ar - 3) };
  }
}
