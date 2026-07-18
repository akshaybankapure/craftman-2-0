import type { AccessNodeCategory, EntranceDirection } from '../types.ts';

/** Habitable room kinds that can require daylight. */
export type DaylightRoomKind = 'LIVING' | 'BEDROOM' | 'KITCHEN';

/**
 * User design preferences that parameterize soft scoring.
 * Geometry stays in metres; these only affect ranking quality.
 */
export interface DesignPrefs {
  /** Preferred façades for daylight (empty = any exterior counts equally). */
  daylightFacades: EntranceDirection[];
  /** Room types that should sit on an exterior wall. */
  daylightRooms: DaylightRoomKind[];
  /** Aspect ratio above which rooms incur shape penalty (default 3). */
  maxAspectRatio: number;
  /** Soft target: corridor share of carpet (default 0.12 = 12%). */
  maxCorridorRatio: number;
  /** Prefer bedrooms farther from the entrance façade. */
  privacyOppositeEntry: boolean;
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
  };
}

export function isDaylightCategory(cat: AccessNodeCategory, prefs: DesignPrefs): boolean {
  return prefs.daylightRooms.includes(cat as DaylightRoomKind);
}
