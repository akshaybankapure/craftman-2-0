/**
 * Architectural standards tables used by the strategy resolver.
 * Values are planning heuristics (NBC-informed), not user controls.
 */

import type { RoomType } from '../../types/index.ts';

/** Preferred / hard maximum aspect ratio per room type.
 *  Corridors are excluded — they are evaluated on width, length and
 *  wasted-area metrics, not ordinary room aspect rules. */
export const ASPECT_RATIO_STANDARDS: Record<string, { preferred: number; hard: number }> = {
  living: { preferred: 2.0, hard: 2.5 },
  bedroom: { preferred: 1.6, hard: 2.0 },
  kitchen: { preferred: 2.2, hard: 3.0 }, // hard allows galley kitchens
  bathroom: { preferred: 2.0, hard: 2.8 },
  ensuite: { preferred: 2.0, hard: 2.8 },
  foyer: { preferred: 2.0, hard: 2.5 },
  utility: { preferred: 2.2, hard: 3.0 },
  entry: { preferred: 2.0, hard: 2.5 },
};

/** Minimum clear width (m) per room type. */
export const MIN_WIDTH_STANDARDS: Partial<Record<RoomType, number>> = {
  living: 3.0,
  bedroom: 2.7,
  kitchen: 2.1,
  bathroom: 1.5,
  ensuite: 1.5,
  corridor: 1.05,
  entry: 1.2,
  foyer: 1.2,
  utility: 1.2,
};

/** Circulation budget by BHK count, in percent of carpet area. */
export const CORRIDOR_BUDGET_STANDARDS: Record<number, { preferredMin: number; preferredMax: number; softMax: number }> = {
  1: { preferredMin: 3, preferredMax: 6, softMax: 8 },
  2: { preferredMin: 4, preferredMax: 8, softMax: 10 },
  3: { preferredMin: 5, preferredMax: 9, softMax: 11 },
  4: { preferredMin: 6, preferredMax: 10, softMax: 12 },
};

/** Corridor width (m). */
export const CORRIDOR_WIDTH_RANGE = { minimum: 1.05, preferred: 1.2, maximum: 1.8 };

/** Absolute floor for the circulation estimate, in percent. */
export const CORRIDOR_PERCENT_FLOOR = 3;
export const CORRIDOR_PERCENT_CEILING = 14;

/** Exterior frontage priority — prime façades go to habitable rooms first. */
export const EXTERIOR_FRONTIER_ORDER: RoomType[] = [
  'living',
  'bedroom',
  'kitchen',
  'utility',
  'bathroom',
  'corridor',
  'foyer',
  'entry',
];

/** How much the resolver may relax a preferred aspect ratio when the
 *  envelope is narrow or the programme dense. Never beyond the hard max. */
export const ASPECT_RELAX_STEP = 0.2;
