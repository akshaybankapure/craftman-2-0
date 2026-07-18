/**
 * ContextProfile — demography + brief + strategy.
 * Sub-engines read this; they never hard-code regional assumptions.
 */

import type { ProgramSpec } from '../../types/index.ts';
import type { EntranceDirection } from '../../planner/types.ts';
import type {
  ResolvedStrategy,
  StrategyInput,
} from '../../planner/strategy/architecturalStrategy.ts';
import { resolveArchitecturalStrategy } from '../../planner/strategy/strategyResolver.ts';

export type RegionId = 'india' | 'generic';

export type CorridorPolicy = 'never' | 'ifNeeded' | 'always';

export type MarketTier = 'compact' | 'standard' | 'premium';

export interface CirculationContext {
  corridorPolicy: CorridorPolicy;
  /** Prefer living-integrated access for bedrooms when legal. */
  preferLivingHub: boolean;
  /** Allow a tiny private lobby instead of a full corridor spine. */
  allowPrivateThreshold: boolean;
}

export interface ContextProfile {
  region: RegionId;
  tier: MarketTier;
  bhk: number;
  bathrooms: number;
  carpetAreaM2: number;
  outlineW: number;
  outlineH: number;
  entranceDir: EntranceDirection;
  hasBalcony: boolean;
  hasUtility: boolean;
  hasFoyer: boolean;
  circulation: CirculationContext;
  strategy: ResolvedStrategy;
  spec: ProgramSpec;
  reasoning: string[];
}

export interface ContextInput {
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
  hasFoyer?: boolean;
  region?: RegionId;
  tier?: MarketTier;
  corridorPolicy?: CorridorPolicy;
  /** Existing strategy input fields forwarded to resolver. */
  strategyInput?: Partial<StrategyInput>;
  strategy?: ResolvedStrategy;
}

export function resolveContextProfile(input: ContextInput): ContextProfile {
  const region = input.region ?? 'india';
  const tier = input.tier ?? 'standard';
  const typology = input.typology ?? 'apartment';
  const reasoning: string[] = [];

  const strategy =
    input.strategy ??
    resolveArchitecturalStrategy({
      spec: input.spec,
      bhk: input.bhk,
      carpetAreaM2: input.carpetAreaM2,
      outlineW: input.outlineW,
      outlineH: input.outlineH,
      entranceDir: input.entranceDir,
      bathroomCount: input.bathroomCount,
      typology,
      hasBalcony: input.hasBalcony,
      hasUtility: input.hasUtility,
      ...input.strategyInput,
    });

  let corridorPolicy = input.corridorPolicy;
  let preferLivingHub = false;
  let allowPrivateThreshold = true;

  if (region === 'india') {
    preferLivingHub = true;
    allowPrivateThreshold = true;
    if (!corridorPolicy) {
      // 1–2 BHK: living-hub only. 3BHK+: corridor optional (spine is last resort,
      // not a peer layout style) — hard MAX_AREA / living caps stop wasteful halls.
      corridorPolicy = input.bhk <= 2 ? 'never' : 'ifNeeded';
      reasoning.push(
        corridorPolicy === 'never'
          ? '2BHK or smaller: corridor suppressed — living-hub access only'
          : 'Corridor optional: prefer living-hub; spine only when privacy demands it',
      );
    }
  } else {
    if (!corridorPolicy) corridorPolicy = 'ifNeeded';
    reasoning.push('Generic profile: corridor ifNeeded');
  }

  // Dense small envelopes almost always need living-hub
  const dense = input.carpetAreaM2 / Math.max(1, input.bhk) < 35;
  if (dense && preferLivingHub) {
    reasoning.push('Dense carpet/BHK ratio reinforces living-hub preference');
  }

  const hasFoyer =
    input.hasFoyer ??
    (tier !== 'compact' && input.carpetAreaM2 >= 90 && input.bhk >= 3);

  return {
    region,
    tier,
    bhk: input.bhk,
    bathrooms: input.bathroomCount,
    carpetAreaM2: input.carpetAreaM2,
    outlineW: input.outlineW,
    outlineH: input.outlineH,
    entranceDir: input.entranceDir,
    hasBalcony: !!input.hasBalcony,
    hasUtility: !!input.hasUtility,
    hasFoyer,
    circulation: {
      corridorPolicy: corridorPolicy ?? 'ifNeeded',
      preferLivingHub,
      allowPrivateThreshold,
    },
    strategy,
    spec: input.spec,
    reasoning,
  };
}
