/**
 * ArchitecturalStrategyResolver — turns basic user inputs into a fully
 * resolved architectural strategy. Pure and deterministic: same inputs
 * always produce the same ResolvedStrategy.
 *
 * Runs BEFORE topology / geometry generation. UI components never compute
 * these decisions themselves.
 */

import type { ProgramSpec, RoomType } from '../../types/index.ts';
import type { AccessNodeCategory, EntranceDirection } from '../types.ts';
import type { MetricKey } from '../optimize/metrics.ts';
import { DEFAULT_METRIC_ORDER } from '../optimize/metrics.ts';
import type { DesignPrefs, DaylightRoomKind } from '../optimize/designPrefs.ts';
import {
  ASPECT_RATIO_STANDARDS,
  ASPECT_RELAX_STEP,
  CORRIDOR_BUDGET_STANDARDS,
  CORRIDOR_PERCENT_CEILING,
  CORRIDOR_PERCENT_FLOOR,
  CORRIDOR_WIDTH_RANGE,
  MIN_WIDTH_STANDARDS,
} from './strategyDefaults.ts';
import type {
  OverrideValue,
  ResolvedStrategy,
  StrategyInput,
  StrategyMode,
  StrategyOverrides,
  StrategyProfile,
  StrategyPresetId,
} from './architecturalStrategy.ts';
import { STRATEGY_PRESETS } from './architecturalStrategy.ts';

/** Override field paths supported by the Advanced Settings panel. */
export const OVERRIDE_KEYS = {
  daylightFacades: 'daylight.preferredFacades',
  kitchenExteriorRequired: 'daylight.kitchenExteriorRequired',
  aspectRatio: (room: RoomType) => `geometry.maxAspectRatio.${room}`,
  corridorLimit: 'geometry.corridorAreaLimitPercent',
  privacyFacade: 'privacy.keepBedroomsAwayFromEntranceFacade',
  profile: 'optimisation.profile',
  wetCluster: 'wetZones.clusterWetRooms',
} as const;

/** Approximate minimum feasible area per room type (m²) — used only to
 *  gauge how area-stressed the programme is. */
const MIN_AREA_STANDARDS: Partial<Record<RoomType, number>> = {
  living: 12,
  bedroom: 9.5,
  kitchen: 5.5,
  bathroom: 3.5,
  ensuite: 3,
  corridor: 3.5,
  entry: 2.5,
  foyer: 2.5,
  utility: 2,
};

const ALL_DIRECTIONS: EntranceDirection[] = ['N', 'E', 'S', 'W'];
const OPPOSITE: Record<EntranceDirection, EntranceDirection> = { N: 'S', S: 'N', E: 'W', W: 'E' };

const round1 = (v: number) => Math.round(v * 10) / 10;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function resolveArchitecturalStrategy(input: StrategyInput): ResolvedStrategy {
  const preset: StrategyPresetId = input.preset ?? 'recommended';
  const typology = input.typology ?? 'apartment';
  const assumptions: string[] = [];
  const warnings: string[] = [];

  // ── Programme & envelope facts ─────────────────────────────────────────
  const bedrooms = Math.max(1, countRooms(input.spec, ['bedroom']));
  const sumTarget = input.spec.rooms.reduce((s, r) => s + r.targetArea * r.count, 0);
  const sumMinFeasible = input.spec.rooms.reduce(
    (s, r) => s + (MIN_AREA_STANDARDS[r.type] ?? 2) * r.count,
    0,
  );
  const areaStress = sumMinFeasible / Math.max(1, input.carpetAreaM2);
  const dense = areaStress > 0.82 || sumTarget > input.carpetAreaM2 * 0.98;

  const W = Math.max(0.1, input.outlineW);
  const H = Math.max(0.1, input.outlineH);
  const minEnvelopeDim = Math.min(W, H);
  const envelopeAspect = Math.max(W, H) / minEnvelopeDim;
  const narrowThreshold = 5.5 + input.bhk * 0.75;
  const narrow = minEnvelopeDim < narrowThreshold || envelopeAspect > 1.8;

  // ── Daylight ───────────────────────────────────────────────────────────
  const daylightReasoning: string[] = [];
  const { facades: preferredFacades, usableFrontage } = resolveDaylightFacades(
    input, W, H, typology, daylightReasoning, assumptions,
  );

  const requiredRoomTypes: RoomType[] = ['living', 'bedroom'];
  const preferredRoomTypes: RoomType[] = [];
  const frontageNeeded =
    (MIN_WIDTH_STANDARDS.living ?? 3) + bedrooms * (MIN_WIDTH_STANDARDS.bedroom ?? 2.7);
  const kitchenFrontage = (MIN_WIDTH_STANDARDS.kitchen ?? 2.1) + 0.5;
  const kitchenCanFitExterior = usableFrontage - frontageNeeded >= kitchenFrontage;
  let kitchenRequired = kitchenCanFitExterior;
  if (kitchenCanFitExterior) {
    requiredRoomTypes.push('kitchen');
    daylightReasoning.push('Enough exterior frontage remains after living and bedrooms — kitchen exterior exposure is required.');
  } else {
    preferredRoomTypes.push('kitchen');
    daylightReasoning.push('Exterior frontage is tight after living and bedrooms — kitchen exposure is preferred, not forced.');
    assumptions.push('Kitchen may fall back to mechanical ventilation if no exterior wall is available.');
  }

  const minimumExteriorExposure: Partial<Record<RoomType, number>> = {
    living: 1,
    bedroom: 1,
    kitchen: kitchenRequired ? 1 : 0,
    bathroom: 0,
    ensuite: 0,
    corridor: 0,
    entry: 0,
    foyer: 0,
  };

  // ── Geometry: aspect ratios ────────────────────────────────────────────
  const relaxedPreferences: string[] = [];
  const preferredAspect: Partial<Record<RoomType, number>> = {};
  const activeAspect: Partial<Record<RoomType, number>> = {};
  const hardAspect: Partial<Record<RoomType, number>> = {};
  for (const [room, std] of Object.entries(ASPECT_RATIO_STANDARDS)) {
    const rt = room as RoomType;
    preferredAspect[rt] = std.preferred;
    hardAspect[rt] = std.hard;
    let active = std.preferred;
    if (narrow || dense) {
      const relaxed = Math.min(std.hard, std.preferred + ASPECT_RELAX_STEP);
      if (relaxed > std.preferred) {
        active = relaxed;
        relaxedPreferences.push(
          `${room} aspect ratio relaxed ${std.preferred.toFixed(1)} → ${relaxed.toFixed(1)} (${narrow ? 'narrow envelope' : 'dense programme'})`,
        );
      }
    }
    activeAspect[rt] = active;
  }
  // Corridors are intentionally absent — judged on width/length/wasted area.

  // ── Geometry: corridor budget ──────────────────────────────────────────
  const bhkKey = clamp(Math.round(input.bhk), 1, 4);
  const std = CORRIDOR_BUDGET_STANDARDS[bhkKey];
  let corridorTarget = (std.preferredMin + std.preferredMax) / 2;
  let corridorLimit = std.softMax;
  if (dense) corridorTarget -= 1;                                  // small carpet → squeeze circulation
  if (typology === 'house') corridorTarget -= 1;                   // houses distribute via living
  if (input.entrancePosition === 'centre') corridorTarget -= 1;    // central entry shortens paths
  if (input.entrancePosition === 'corner') corridorLimit += 1;     // corner entry needs a longer spine
  if (envelopeAspect > 1.8) corridorLimit += 1;                    // narrow plates need more spine
  if (areaStress < 0.6 && input.carpetAreaM2 > 110) corridorLimit += 1; // large plans can afford a privacy spine
  corridorTarget = clamp(corridorTarget, std.preferredMin, corridorLimit - 1);
  corridorLimit = clamp(corridorLimit, corridorTarget + 1, CORRIDOR_PERCENT_CEILING);
  const corridorFloor = Math.max(CORRIDOR_PERCENT_FLOOR, round1(corridorTarget - 1.5));

  // ── Privacy ────────────────────────────────────────────────────────────
  const preferredDepthByRoomType: Partial<Record<RoomType, number>> = {
    entry: 0,
    foyer: 1,
    corridor: 1,
    living: 1,
    kitchen: 2,
    bathroom: 2,
    bedroom: input.bhk >= 3 ? 3 : 2,
    ensuite: 3,
  };
  const entranceVisibilityRules = [
    'Bedroom doors must not open directly toward the main entrance.',
    'Bedroom doors should not be visible from outside the front door.',
    'Bedrooms sit deeper in the circulation graph than the living room.',
    'Bathrooms must not dominate the entrance view.',
    'Living forms the public transition between entry and private zones.',
    'A bedroom may touch the entrance façade if its door is screened and access stays private.',
  ];

  // ── Optimisation profile ───────────────────────────────────────────────
  const generousFrontage = usableFrontage / Math.max(1, frontageNeeded) >= 1.6;
  let profile: StrategyProfile;
  if (preset === 'max_daylight') profile = 'daylight';
  else if (preset === 'max_privacy') profile = 'privacy';
  else if (preset === 'compact_circulation') profile = 'compact';
  else if (preset === 'max_usable_area') profile = 'balanced';
  else if (dense) profile = 'compact';
  else if ((input.hasBalcony || generousFrontage) && areaStress < 0.75) profile = 'daylight';
  else if (bedrooms >= 3 && !dense) profile = 'privacy';
  else profile = 'balanced';

  // ── Wet zones ──────────────────────────────────────────────────────────
  let clusterWetRooms = true;
  const wetZones = {
    clusterWetRooms: true,
    preferSharedPlumbingWalls: true,
    maximumPlumbingSeparation: typology === 'house' ? 8 : 6,
  };

  // ── Apply manual overrides (pinned values win) ─────────────────────────
  const overrides = input.overrides ?? {};
  const overriddenFields: string[] = [];
  let keepBedroomsOffEntrance = true;

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) continue;
    if (key === OVERRIDE_KEYS.daylightFacades && Array.isArray(value)) {
      preferredFacades.length = 0;
      preferredFacades.push(...(value as EntranceDirection[]).filter(d => ALL_DIRECTIONS.includes(d)));
      overriddenFields.push(key);
    } else if (key === OVERRIDE_KEYS.kitchenExteriorRequired && typeof value === 'boolean') {
      kitchenRequired = value;
      const inRequired = requiredRoomTypes.includes('kitchen');
      if (value && !inRequired) {
        requiredRoomTypes.push('kitchen');
        preferredRoomTypes.splice(preferredRoomTypes.indexOf('kitchen'), 1);
      } else if (!value && inRequired) {
        requiredRoomTypes.splice(requiredRoomTypes.indexOf('kitchen'), 1);
        if (!preferredRoomTypes.includes('kitchen')) preferredRoomTypes.push('kitchen');
      }
      minimumExteriorExposure.kitchen = value ? 1 : 0;
      overriddenFields.push(key);
    } else if (key.startsWith('geometry.maxAspectRatio.') && typeof value === 'number') {
      const room = key.slice('geometry.maxAspectRatio.'.length) as RoomType;
      const hard = hardAspect[room];
      if (hard !== undefined) {
        if (value > hard) {
          warnings.push(
            `Your manual ${room} aspect ratio of ${value.toFixed(1)} exceeds the hard maximum of ${hard.toFixed(1)} — clamped to ${hard.toFixed(1)}.`,
          );
          activeAspect[room] = hard;
        } else {
          activeAspect[room] = clamp(value, 1.2, hard);
        }
        overriddenFields.push(key);
      }
    } else if (key === OVERRIDE_KEYS.corridorLimit && typeof value === 'number') {
      if (value < corridorFloor) {
        warnings.push(
          `Your manual corridor limit of ${round1(value)}% is not feasible for this room programme. The minimum currently achievable value is approximately ${corridorFloor}%.`,
        );
      }
      if (value > CORRIDOR_PERCENT_CEILING) {
        warnings.push(`Corridor limit clamped to ${CORRIDOR_PERCENT_CEILING}%.`);
      }
      corridorLimit = clamp(value, 1, CORRIDOR_PERCENT_CEILING);
      overriddenFields.push(key);
    } else if (key === OVERRIDE_KEYS.privacyFacade && typeof value === 'boolean') {
      keepBedroomsOffEntrance = value;
      overriddenFields.push(key);
    } else if (key === OVERRIDE_KEYS.profile && typeof value === 'string') {
      if (['balanced', 'daylight', 'privacy', 'compact'].includes(value as string)) {
        profile = value as StrategyProfile;
        overriddenFields.push(key);
      }
    } else if (key === OVERRIDE_KEYS.wetCluster && typeof value === 'boolean') {
      clusterWetRooms = value;
      wetZones.clusterWetRooms = value;
      overriddenFields.push(key);
    }
  }

  // ── Mode ───────────────────────────────────────────────────────────────
  const groups = new Set(overriddenFields.map(f => f.split('.')[0]));
  const mode: StrategyMode =
    overriddenFields.length === 0 ? 'automatic' : groups.size >= 4 ? 'manual' : 'hybrid';

  // ── Assumptions ────────────────────────────────────────────────────────
  if (input.latitude === undefined) {
    assumptions.push('No geographic or climate data provided — all exterior façades treated as potentially usable; longer façades preferred.');
  }
  if (input.entrancePosition === undefined) {
    assumptions.push('Exact entrance position not specified — assuming a central entrance on the entrance façade.');
  }
  if (typology === 'apartment') {
    assumptions.push('Apartment entrance wall assumed to adjoin a common corridor — not usable for daylight.');
  }
  if (input.hasBalcony || input.hasUtility) {
    assumptions.push('Balcony / utility requests are noted in the strategy but not yet placed by the layout embedder.');
  }

  const optimisation = {
    profile,
    lexicographicPriorities: prioritiesForProfile(profile),
    weights: weightsFor(profile, preset),
  };

  const strategy: ResolvedStrategy = {
    mode,
    preset,
    daylight: {
      preferredFacades,
      requiredRoomTypes,
      preferredRoomTypes,
      minimumExteriorExposure,
      reasoning: daylightReasoning,
    },
    geometry: {
      maximumAspectRatioByRoomType: activeAspect,
      preferredAspectRatioByRoomType: preferredAspect,
      hardAspectRatioByRoomType: hardAspect,
      minimumWidthByRoomType: MIN_WIDTH_STANDARDS,
      corridorAreaLimitPercent: round1(corridorLimit),
      corridorAreaTargetPercent: round1(corridorTarget),
      corridorAreaFloorPercent: corridorFloor,
      corridorWidthRange: typology === 'house'
        ? { minimum: 1.1, preferred: 1.2, maximum: 1.8 }
        : { ...CORRIDOR_WIDTH_RANGE },
      relaxedPreferences,
    },
    privacy: {
      keepBedroomsAwayFromEntranceFacade: keepBedroomsOffEntrance,
      preferredDepthByRoomType,
      entranceVisibilityRules,
    },
    optimisation,
    wetZones,
    assumptions,
    warnings,
    manuallyOverriddenFields: overriddenFields,
    summary: [],
  };
  strategy.summary = buildSummary(strategy, input, kitchenRequired);
  return strategy;
}

// ─── Daylight façade selection ────────────────────────────────────────────

function resolveDaylightFacades(
  input: StrategyInput,
  W: number,
  H: number,
  typology: 'apartment' | 'house',
  reasoning: string[],
  assumptions: string[],
): { facades: EntranceDirection[]; usableFrontage: number } {
  const lengthOf = (d: EntranceDirection) => (d === 'N' || d === 'S' ? W : H);
  let usable: EntranceDirection[];

  if (typology === 'apartment') {
    usable = ALL_DIRECTIONS.filter(d => d !== input.entranceDir);
    reasoning.push(`Entrance (${input.entranceDir}) wall reserved for entry — daylight allocated from the remaining façades.`);
  } else {
    usable = [...ALL_DIRECTIONS];
    reasoning.push('Detached house — all four façades are daylight-capable.');
  }

  if (input.latitude !== undefined) {
    const lat = input.latitude;
    let climatePreferred: EntranceDirection | null = null;
    if (lat > 23.5) climatePreferred = 'S';       // northern hemisphere: south sun
    else if (lat < -23.5) climatePreferred = 'N'; // southern hemisphere: north sun
    if (climatePreferred && usable.includes(climatePreferred)) {
      usable.sort((a, b) => (a === climatePreferred ? -1 : b === climatePreferred ? 1 : lengthOf(b) - lengthOf(a)));
      reasoning.push(`Climate-aware orientation (latitude ${round1(lat)}°): ${climatePreferred} façade preferred for habitable rooms.`);
    } else {
      usable.sort((a, b) => lengthOf(b) - lengthOf(a));
      reasoning.push('Tropical latitude — façade length matters more than solar orientation.');
    }
  } else {
    // No climate data: all usable façades equal; prefer the longer ones.
    usable.sort((a, b) => lengthOf(b) - lengthOf(a));
    reasoning.push('No climate data — preferring the longer exterior façades for habitable rooms.');
  }

  const facades = usable.slice(0, 2);
  const frontage = usable.reduce((s, d) => s + lengthOf(d), 0);
  reasoning.push(`Daylight frontage priority: Living → Bedrooms → Kitchen → Utility → Bathrooms. Corridors, foyers and entry get none.`);
  void assumptions;
  return { facades, usableFrontage: frontage };
}

// ─── Optimisation profile → priorities & weights ─────────────────────────
//
// Tier 1 (envelope containment, no overlaps, min area/dimensions, legal
// circulation, doors, connectivity, bathroom leaf nodes, bedroom access) is
// enforced by hard validation before any scoring — it is never part of this
// ordering and can never be reordered by a profile or a user.
// The lists below rank only Tier 2 (usability) → Tier 3 (quality) → Tier 4
// (refinement); a profile may re-rank within tiers but never demote Tier 2
// below Tier 3.

const TIER2: MetricKey[] = ['areaError', 'shapeQuality'];
const TIER4: MetricKey[] = ['balance'];

const TIER3_BY_PROFILE: Record<StrategyProfile, MetricKey[]> = {
  balanced: ['daylight', 'privacy', 'corridorEfficiency', 'wetClustering'],
  daylight: ['daylight', 'privacy', 'wetClustering', 'corridorEfficiency'],
  privacy: ['privacy', 'daylight', 'corridorEfficiency', 'wetClustering'],
  compact: ['corridorEfficiency', 'wetClustering', 'daylight', 'privacy'],
};

export function prioritiesForProfile(profile: StrategyProfile): MetricKey[] {
  // Tier 2 (area fit, shape) always ranks above Tier 3; Tier 4 last.
  return [...TIER2, ...TIER3_BY_PROFILE[profile], ...TIER4];
}

export function weightsFor(
  profile: StrategyProfile,
  preset: StrategyPresetId,
): Record<MetricKey, number> {
  const weights = Object.fromEntries(DEFAULT_METRIC_ORDER.map(k => [k, 1])) as Record<MetricKey, number>;
  if (profile === 'daylight') weights.daylight = 1.4;
  if (profile === 'privacy') weights.privacy = 1.4;
  if (profile === 'compact') weights.corridorEfficiency = 1.4;
  if (preset === 'max_usable_area') {
    weights.areaError = 1.3;
    weights.corridorEfficiency = 1.2;
  }
  return weights;
}

// ─── User-facing summary ─────────────────────────────────────────────────

function buildSummary(
  s: ResolvedStrategy,
  input: StrategyInput,
  kitchenRequired: boolean,
): string[] {
  const profileLabels: Record<StrategyProfile, string> = {
    balanced: 'balanced',
    daylight: 'daylight-focused',
    privacy: 'privacy-focused',
    compact: 'compact',
  };
  const presetLabel = STRATEGY_PRESETS.find(p => p.id === s.preset)?.label ?? 'Architect Recommended';
  const lines: string[] = [];
  if (s.preset !== 'recommended') {
    lines.push(`${presetLabel} preset applied to a ${input.bhk} BHK, ${round1(input.carpetAreaM2)} m² programme`);
  } else {
    lines.push(`${input.bhk} BHK on a ${round1(input.carpetAreaM2)} m² envelope — ${profileLabels[s.optimisation.profile]} strategy`);
  }
  lines.push(`Living and bedrooms receive first priority for exterior walls (${s.daylight.preferredFacades.join(' / ') || 'any façade'})`);
  lines.push(kitchenRequired
    ? 'Kitchen exterior exposure is required — frontage allows it'
    : 'Kitchen exterior exposure preferred; mechanical ventilation fallback allowed');
  lines.push(`Keeping circulation below ${s.geometry.corridorAreaLimitPercent}% (target ≈ ${s.geometry.corridorAreaTargetPercent}%)`);
  lines.push('Bedrooms are positioned beyond the public zone, screened from the entrance');
  lines.push('Wet areas grouped around shared plumbing walls');
  return lines;
}

// ─── Adapters: strategy → engine-facing config ───────────────────────────

const ROOM_TO_CATEGORY: Partial<Record<RoomType, AccessNodeCategory[]>> = {
  living: ['LIVING'],
  bedroom: ['BEDROOM'],
  kitchen: ['KITCHEN'],
  bathroom: ['COMMON_BATHROOM'],
  ensuite: ['ENSUITE_BATHROOM'],
  foyer: ['FOYER'],
  entry: ['ENTRY'],
  utility: ['UTILITY'],
  corridor: ['CORRIDOR'],
};

/** Map a resolved strategy onto the soft-scoring DesignPrefs consumed by
 *  the optimiser. This is the ONLY bridge between the strategy layer and
 *  generation scoring. */
export function designPrefsFromStrategy(strategy: ResolvedStrategy): DesignPrefs {
  const daylightRooms: DaylightRoomKind[] = [];
  for (const rt of strategy.daylight.requiredRoomTypes) {
    if (rt === 'living' || rt === 'bedroom' || rt === 'kitchen') {
      daylightRooms.push(rt.toUpperCase() as DaylightRoomKind);
    }
  }
  const maxAspectRatioByCategory: Partial<Record<AccessNodeCategory, number>> = {};
  let globalMax = 3;
  for (const [room, limit] of Object.entries(strategy.geometry.maximumAspectRatioByRoomType)) {
    for (const cat of ROOM_TO_CATEGORY[room as RoomType] ?? []) {
      maxAspectRatioByCategory[cat] = limit;
    }
    globalMax = Math.max(globalMax, limit);
  }
  const minDepthByCategory: Partial<Record<AccessNodeCategory, number>> = {};
  for (const [room, depth] of Object.entries(strategy.privacy.preferredDepthByRoomType)) {
    for (const cat of ROOM_TO_CATEGORY[room as RoomType] ?? []) {
      minDepthByCategory[cat] = depth;
    }
  }
  return {
    daylightFacades: [...strategy.daylight.preferredFacades],
    daylightRooms,
    maxAspectRatio: globalMax,
    maxCorridorRatio: strategy.geometry.corridorAreaLimitPercent / 100,
    privacyOppositeEntry: strategy.privacy.keepBedroomsAwayFromEntranceFacade,
    maxAspectRatioByCategory,
    minDepthByCategory,
  };
}

export function metricPriorityFromStrategy(strategy: ResolvedStrategy): MetricKey[] {
  return strategy.optimisation.lexicographicPriorities;
}

export function metricWeightsFromStrategy(strategy: ResolvedStrategy): Record<MetricKey, number> {
  return strategy.optimisation.weights;
}

/** Convenience: apply / remove a single override immutably. */
export function withOverride(
  overrides: StrategyOverrides,
  key: string,
  value: OverrideValue,
): StrategyOverrides {
  return { ...overrides, [key]: value };
}

export function withoutOverride(overrides: StrategyOverrides, key: string): StrategyOverrides {
  const next = { ...overrides };
  delete next[key];
  return next;
}

/** Count spec rooms of the given planner types. */
function countRooms(spec: ProgramSpec, types: RoomType[]): number {
  return spec.rooms.filter(r => types.includes(r.type)).reduce((s, r) => s + r.count, 0);
}
