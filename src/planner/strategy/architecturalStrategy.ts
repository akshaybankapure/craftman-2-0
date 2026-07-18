/**
 * Architectural strategy layer.
 *
 * A ResolvedStrategy is the single source of truth for every soft
 * decision the generator makes: daylight allocation, room geometry
 * limits, circulation budget, privacy posture, optimisation profile
 * and wet-zone clustering. It is produced by the strategy resolver
 * (strategyResolver.ts) from basic user inputs — never mutated
 * directly by UI controls.
 */

import type { ProgramSpec, RoomType } from '../../types/index.ts';
import type { EntranceDirection } from '../types.ts';
import type { MetricKey } from '../optimize/metrics.ts';

export type StrategyMode = 'automatic' | 'manual' | 'hybrid';

export type StrategyProfile = 'balanced' | 'daylight' | 'privacy' | 'compact';

/**
 * User-facing presets — high-level intentions, not raw metric control.
 * Each preset resolves into a full strategy inside the resolver.
 */
export type StrategyPresetId =
  | 'recommended'
  | 'max_daylight'
  | 'max_privacy'
  | 'max_usable_area'
  | 'compact_circulation';

export interface StrategyPresetDef {
  id: StrategyPresetId;
  label: string;
  hint: string;
}

export const STRATEGY_PRESETS: StrategyPresetDef[] = [
  { id: 'recommended', label: 'Architect Recommended', hint: 'Balanced strategy derived from your programme' },
  { id: 'max_daylight', label: 'Maximum Daylight', hint: 'Prioritise exterior exposure for living & bedrooms' },
  { id: 'max_privacy', label: 'Maximum Privacy', hint: 'Deeper private zones, screened bedroom doors' },
  { id: 'max_usable_area', label: 'Maximum Usable Area', hint: 'Tight circulation, best target-area matching' },
  { id: 'compact_circulation', label: 'Compact Circulation', hint: 'Shortest possible corridors' },
];

/** Basic inputs a normal user provides. No optimisation internals. */
export interface StrategyInput {
  /** Room programme (from the BHK template). */
  spec: ProgramSpec;
  bhk: number;
  carpetAreaM2: number;
  outlineW: number;
  outlineH: number;
  entranceDir: EntranceDirection;
  bathroomCount: number;
  typology?: 'apartment' | 'house';
  hasBalcony?: boolean;
  hasUtility?: boolean;
  /** Optional climate hint. When absent, façades are chosen geometrically. */
  latitude?: number;
  /** Optional entrance position hint along the entrance façade. */
  entrancePosition?: 'corner' | 'centre';
  /** High-level intention. Defaults to 'recommended'. */
  preset?: StrategyPresetId;
  /** Pinned manual overrides, keyed by field path (see strategyOverrides). */
  overrides?: StrategyOverrides;
}

export type OverrideValue = number | boolean | string | EntranceDirection[];

/** field path → pinned value, e.g. "geometry.corridorAreaLimitPercent": 8 */
export type StrategyOverrides = Record<string, OverrideValue>;

export interface DaylightStrategy {
  preferredFacades: EntranceDirection[];
  /** Exterior-wall contact + window-capable wall required. */
  requiredRoomTypes: RoomType[];
  /** Exterior contact preferred but not mandatory (e.g. kitchen). */
  preferredRoomTypes: RoomType[];
  /** Fraction of rooms of each type that must touch an exterior wall (0..1). */
  minimumExteriorExposure: Partial<Record<RoomType, number>>;
  reasoning: string[];
}

export interface GeometryStrategy {
  /** Active scoring limits per room type (auto or overridden, ≤ hard max). */
  maximumAspectRatioByRoomType: Partial<Record<RoomType, number>>;
  /** Preferred limits before any relaxation. */
  preferredAspectRatioByRoomType: Partial<Record<RoomType, number>>;
  /** Hard ceilings — never exceeded silently. */
  hardAspectRatioByRoomType: Partial<Record<RoomType, number>>;
  minimumWidthByRoomType: Partial<Record<RoomType, number>>;
  /** Soft maximum circulation share of carpet, in percent. */
  corridorAreaLimitPercent: number;
  /** Preferred circulation target, in percent. */
  corridorAreaTargetPercent: number;
  /** Estimated minimum achievable circulation, in percent — used to flag
   *  infeasible manual corridor limits. */
  corridorAreaFloorPercent: number;
  corridorWidthRange: { minimum: number; preferred: number; maximum: number };
  /** Preferred values that were relaxed to fit the programme/envelope. */
  relaxedPreferences: string[];
}

export interface PrivacyStrategy {
  keepBedroomsAwayFromEntranceFacade: boolean;
  /** Minimum access-graph depth from Entry per room type. */
  preferredDepthByRoomType: Partial<Record<RoomType, number>>;
  entranceVisibilityRules: string[];
}

export interface OptimisationStrategy {
  profile: StrategyProfile;
  /** Lexicographic metric order. Tier 1 validity is gated separately and
   *  can never be reordered; this list only ranks Tier 2–4 soft metrics. */
  lexicographicPriorities: MetricKey[];
  weights: Record<MetricKey, number>;
}

export interface WetZoneStrategy {
  clusterWetRooms: boolean;
  preferSharedPlumbingWalls: boolean;
  /** Max acceptable distance between wet rooms, metres. */
  maximumPlumbingSeparation: number;
}

export interface ResolvedStrategy {
  mode: StrategyMode;
  preset: StrategyPresetId;
  daylight: DaylightStrategy;
  geometry: GeometryStrategy;
  privacy: PrivacyStrategy;
  optimisation: OptimisationStrategy;
  wetZones: WetZoneStrategy;
  /** Assumptions the resolver made (e.g. no climate data). */
  assumptions: string[];
  /** Infeasibility / clamping warnings, incl. about manual overrides. */
  warnings: string[];
  /** Field paths currently pinned by the user. */
  manuallyOverriddenFields: string[];
  /** Concise user-facing explanation (no raw weights). */
  summary: string[];
}
