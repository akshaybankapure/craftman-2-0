/**
 * Habitable-room proportion limits used as hard validation gates.
 * Corridors are exempt; wet rooms stay compact but allow modest elongation.
 */

import type { AccessNodeCategory } from '../types.ts';

export interface ProportionLimit {
  /** max(long, short) / min(long, short) */
  maxAspect: number;
  /** Absolute long-side cap in metres (stops “reasonable ratio, absurd size”). */
  maxSideM: number;
}

const LIMITS: Partial<Record<AccessNodeCategory, ProportionLimit>> = {
  LIVING: { maxAspect: 2.2, maxSideM: 7.5 },
  BEDROOM: { maxAspect: 2.0, maxSideM: 6.0 },
  KITCHEN: { maxAspect: 2.8, maxSideM: 5.5 },
  COMMON_BATHROOM: { maxAspect: 2.8, maxSideM: 4.5 },
  ENSUITE_BATHROOM: { maxAspect: 3.2, maxSideM: 4.5 },
  UTILITY: { maxAspect: 3.0, maxSideM: 4.5 },
  ENTRY: { maxAspect: 2.8, maxSideM: 4.0 },
  FOYER: { maxAspect: 2.8, maxSideM: 4.0 },
};

/** Categories that must not ship as bowling-alley rectangles. */
export function proportionLimitFor(
  category: AccessNodeCategory,
): ProportionLimit | null {
  if (category === 'CORRIDOR' || category === 'BALCONY') return null;
  return LIMITS[category] ?? { maxAspect: 2.5, maxSideM: 6.0 };
}

export function roomAspect(w: number, h: number): number {
  const a = Math.max(w, h);
  const b = Math.min(w, h);
  return b > 1e-6 ? a / b : Infinity;
}

export function livingDepthCap(widthM: number): number {
  const lim = LIMITS.LIVING!;
  return Math.min(lim.maxSideM, widthM * lim.maxAspect);
}

export function bedroomWidthCap(heightM: number): number {
  const lim = LIMITS.BEDROOM!;
  return Math.min(lim.maxSideM, heightM * lim.maxAspect);
}

/** Ideal private-wing width for a stacked bedroom band. */
export function maxPrivateWingWidth(bedCount: number, wingHeightM: number): number {
  const n = Math.max(1, bedCount);
  const slotH = wingHeightM / n;
  // Width must respect bedroom aspect even before ensuite carve-outs.
  return Math.max(3.2, bedroomWidthCap(Math.max(2.4, slotH)));
}

/** Ideal public-wing width so living depth stays within viewing range. */
export function maxPublicWingWidth(wingHeightM: number): number {
  // Living often takes ≥55% of public height after kitchen/bath carve.
  const livingH = Math.max(3.0, wingHeightM * 0.55);
  return Math.max(3.4, livingH / 2.0);
}
