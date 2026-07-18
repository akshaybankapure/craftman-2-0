import type { AccessNodeCategory, EntranceDirection } from '../types.ts';

/** Habitable room kinds that can require daylight. */
export type DaylightRoomKind = 'LIVING' | 'BEDROOM' | 'KITCHEN';

/**
 * Soft-scoring parameters consumed by the optimiser.
 * Geometry stays in metres; these only affect ranking quality.
 *
 * In the normal workflow these are DERIVED from a ResolvedStrategy
 * (see planner/strategy/strategyResolver.ts) — they are no longer
 * edited directly by the UI.
 */
export interface DesignPrefs {
  /** Preferred façades for daylight (empty = any exterior counts equally). */
  daylightFacades: EntranceDirection[];
  /** Room types that should sit on an exterior wall. */
  daylightRooms: DaylightRoomKind[];
  /** Fallback aspect-ratio limit when no per-category value exists. */
  maxAspectRatio: number;
  /** Soft target: corridor share of carpet (default 0.12 = 12%). */
  maxCorridorRatio: number;
  /** Prefer bedrooms farther from the entrance façade. */
  privacyOppositeEntry: boolean;
  /** Per-category aspect limits (from the strategy's room standards).
   *  Falls back to maxAspectRatio for categories not listed. */
  maxAspectRatioByCategory?: Partial<Record<AccessNodeCategory, number>>;
  /** Minimum access-graph depth from ENTRY per category (privacy). */
  minDepthByCategory?: Partial<Record<AccessNodeCategory, number>>;
}

export const DEFAULT_DESIGN_PREFS: DesignPrefs = {
  daylightFacades: [],
  daylightRooms: ['LIVING', 'BEDROOM'],
  maxAspectRatio: 3,
  maxCorridorRatio: 0.12,
  privacyOppositeEntry: true,
};

export function cloneDesignPrefs(p: DesignPrefs): DesignPrefs {
  return {
    daylightFacades: [...p.daylightFacades],
    daylightRooms: [...p.daylightRooms],
    maxAspectRatio: p.maxAspectRatio,
    maxCorridorRatio: p.maxCorridorRatio,
    privacyOppositeEntry: p.privacyOppositeEntry,
    maxAspectRatioByCategory: p.maxAspectRatioByCategory ? { ...p.maxAspectRatioByCategory } : undefined,
    minDepthByCategory: p.minDepthByCategory ? { ...p.minDepthByCategory } : undefined,
  };
}

export function isDaylightCategory(cat: AccessNodeCategory, prefs: DesignPrefs): boolean {
  return prefs.daylightRooms.includes(cat as DaylightRoomKind);
}
