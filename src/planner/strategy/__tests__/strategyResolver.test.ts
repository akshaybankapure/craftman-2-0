import { describe, it, expect } from 'vitest';
import type { ProgramSpec } from '../../../types/index.ts';
import type { EntranceDirection } from '../../types.ts';
import {
  OVERRIDE_KEYS,
  designPrefsFromStrategy,
  metricPriorityFromStrategy,
  prioritiesForProfile,
  resolveArchitecturalStrategy,
  withOverride,
  withoutOverride,
} from '../strategyResolver.ts';
import type {
  StrategyInput,
  StrategyOverrides,
  StrategyProfile,
  StrategyPresetId,
} from '../architecturalStrategy.ts';
import { STRATEGY_PRESETS } from '../architecturalStrategy.ts';
import { ASPECT_RATIO_STANDARDS } from '../strategyDefaults.ts';
import { generateFloorPlanOptions } from '../../generateFloorPlan.ts';

const SPEC_2BHK: ProgramSpec = {
  totalAreaTarget: 80,
  rooms: [
    { type: 'living', count: 1, targetArea: 18, minDimension: 3.0 },
    { type: 'kitchen', count: 1, targetArea: 9, minDimension: 2.1 },
    { type: 'bedroom', count: 2, targetArea: 12, minDimension: 2.7 },
    { type: 'bathroom', count: 2, targetArea: 4, minDimension: 1.5 },
    { type: 'corridor', count: 1, targetArea: 5, minDimension: 1.05 },
    { type: 'entry', count: 1, targetArea: 3, minDimension: 1.2 },
  ],
  adjacencies: [],
};

function specForBhk(bhk: number): ProgramSpec {
  return {
    totalAreaTarget: 45 + bhk * 17,
    rooms: [
      { type: 'living', count: 1, targetArea: 14 + bhk * 1.5, minDimension: 3.0 },
      { type: 'kitchen', count: 1, targetArea: 7, minDimension: 2.1 },
      { type: 'bedroom', count: bhk, targetArea: 11.5, minDimension: 2.7 },
      { type: 'bathroom', count: Math.max(1, bhk - 1), targetArea: 4, minDimension: 1.5 },
      { type: 'corridor', count: 1, targetArea: 5, minDimension: 1.05 },
      { type: 'entry', count: 1, targetArea: 3, minDimension: 1.2 },
    ],
    adjacencies: [],
  };
}

function inputFor(
  bhk: number,
  overrides?: StrategyOverrides,
  extra?: Partial<StrategyInput>,
): StrategyInput {
  const spec = specForBhk(bhk);
  const carpet = spec.totalAreaTarget;
  return {
    spec,
    bhk,
    carpetAreaM2: carpet,
    outlineW: Math.sqrt(carpet * 1.3),
    outlineH: Math.sqrt(carpet / 1.3),
    entranceDir: 'S',
    bathroomCount: Math.max(1, bhk - 1),
    typology: 'apartment',
    overrides,
    ...extra,
  };
}

const TIER3: Array<'daylight' | 'privacy' | 'corridorEfficiency' | 'wetClustering'> = [
  'daylight', 'privacy', 'corridorEfficiency', 'wetClustering',
];

describe('Architectural strategy resolver', () => {
  it('1. default generation requires no advanced user settings', () => {
    const strategy = resolveArchitecturalStrategy(inputFor(2));
    expect(strategy.mode).toBe('automatic');
    expect(strategy.manuallyOverriddenFields).toEqual([]);
    const result = generateFloorPlanOptions(SPEC_2BHK, 10.2, 7.8, 'S', {
      seeds: 24,
      retain: 2,
      baseSeed: 7,
      optimizeIterations: 8,
      metricPriority: metricPriorityFromStrategy(strategy),
      metricWeights: strategy.optimisation.weights,
      designPrefs: designPrefsFromStrategy(strategy),
    });
    expect(result.plans.length).toBeGreaterThan(0);
  });

  it('2. a 2 BHK 80 m² plan receives reasonable automatic settings', () => {
    const s = resolveArchitecturalStrategy(inputFor(2, undefined, { outlineW: 10.2, outlineH: 7.8 }));
    expect(s.geometry.corridorAreaLimitPercent).toBeGreaterThanOrEqual(6);
    expect(s.geometry.corridorAreaLimitPercent).toBeLessThanOrEqual(11);
    expect(s.geometry.maximumAspectRatioByRoomType.bedroom!).toBeLessThanOrEqual(2.0);
    expect(s.geometry.maximumAspectRatioByRoomType.living!).toBeLessThanOrEqual(2.5);
    expect(['balanced', 'daylight', 'privacy', 'compact']).toContain(s.optimisation.profile);
    expect(s.summary.length).toBeGreaterThan(3);
  });

  it('3. living and bedrooms are prioritised for exterior exposure', () => {
    const s = resolveArchitecturalStrategy(inputFor(2));
    expect(s.daylight.requiredRoomTypes).toContain('living');
    expect(s.daylight.requiredRoomTypes).toContain('bedroom');
    expect(s.daylight.minimumExteriorExposure.living).toBe(1);
    expect(s.daylight.minimumExteriorExposure.bedroom).toBe(1);
    expect(s.daylight.minimumExteriorExposure.corridor).toBe(0);
    expect(s.daylight.minimumExteriorExposure.bathroom).toBe(0);
    const prefs = designPrefsFromStrategy(s);
    expect(prefs.daylightRooms).toContain('LIVING');
    expect(prefs.daylightRooms).toContain('BEDROOM');
  });

  it('4. corridors receive a dynamic area limit based on BHK', () => {
    const one = resolveArchitecturalStrategy(inputFor(1));
    const four = resolveArchitecturalStrategy(inputFor(4));
    expect(four.geometry.corridorAreaLimitPercent).toBeGreaterThan(one.geometry.corridorAreaLimitPercent);
    expect(four.geometry.corridorAreaTargetPercent).toBeGreaterThan(one.geometry.corridorAreaTargetPercent);
  });

  it('5. bedrooms receive stronger privacy depth than living', () => {
    const s = resolveArchitecturalStrategy(inputFor(3));
    expect(s.privacy.preferredDepthByRoomType.bedroom!).toBeGreaterThan(
      s.privacy.preferredDepthByRoomType.living!,
    );
  });

  it('6. narrow envelopes produce relaxed but bounded aspect ratios', () => {
    const wide = resolveArchitecturalStrategy(inputFor(2, undefined, { outlineW: 10.2, outlineH: 7.8 }));
    const narrow = resolveArchitecturalStrategy(inputFor(2, undefined, { outlineW: 14, outlineH: 5.7 }));
    expect(narrow.geometry.relaxedPreferences.length).toBeGreaterThan(0);
    expect(narrow.geometry.maximumAspectRatioByRoomType.bedroom!).toBeGreaterThan(
      wide.geometry.maximumAspectRatioByRoomType.bedroom!,
    );
    for (const [room, active] of Object.entries(narrow.geometry.maximumAspectRatioByRoomType)) {
      expect(active).toBeLessThanOrEqual(ASPECT_RATIO_STANDARDS[room].hard + 1e-9);
    }
  });

  it('7. changing BHK recalculates automatic values', () => {
    const two = resolveArchitecturalStrategy(inputFor(2));
    const three = resolveArchitecturalStrategy(inputFor(3));
    expect(two.geometry.corridorAreaLimitPercent).not.toBe(three.geometry.corridorAreaLimitPercent);
    expect(two.privacy.preferredDepthByRoomType.bedroom).not.toBe(three.privacy.preferredDepthByRoomType.bedroom);
  });

  it('8. changing entrance direction recalculates daylight and privacy posture', () => {
    const dirs: EntranceDirection[] = ['N', 'S', 'E', 'W'];
    const facades = dirs.map(d =>
      resolveArchitecturalStrategy(inputFor(2, undefined, { entranceDir: d })).daylight.preferredFacades.join(''),
    );
    // Apartment entrance wall is not daylight-capable — each direction yields a different set
    expect(new Set(facades).size).toBeGreaterThan(1);
    for (const d of dirs) {
      const s = resolveArchitecturalStrategy(inputFor(2, undefined, { entranceDir: d }));
      expect(s.daylight.preferredFacades).not.toContain(d);
      expect(s.daylight.reasoning.some(r => r.includes(d))).toBe(true);
    }
  });

  it('9. manual overrides survive automatic recalculation when inputs change', () => {
    const overrides: StrategyOverrides = { [OVERRIDE_KEYS.corridorLimit]: 9 };
    const a = resolveArchitecturalStrategy(inputFor(2, overrides));
    expect(a.mode).toBe('hybrid');
    expect(a.geometry.corridorAreaLimitPercent).toBe(9);
    expect(a.manuallyOverriddenFields).toContain(OVERRIDE_KEYS.corridorLimit);
    // Change a core input — the pinned value must be preserved
    const b = resolveArchitecturalStrategy(inputFor(3, overrides));
    expect(b.geometry.corridorAreaLimitPercent).toBe(9);
    expect(b.manuallyOverriddenFields).toContain(OVERRIDE_KEYS.corridorLimit);
    expect(b.mode).toBe('hybrid');
  });

  it('10. reset to auto removes the override and restores automatic values', () => {
    const key = OVERRIDE_KEYS.corridorLimit;
    const withPin = withOverride({}, key, 9);
    const cleared = withoutOverride(withPin, key);
    const auto = resolveArchitecturalStrategy(inputFor(2));
    const restored = resolveArchitecturalStrategy(inputFor(2, cleared));
    expect(JSON.stringify(restored)).toBe(JSON.stringify(auto));
    expect(restored.mode).toBe('automatic');
  });

  it('11. infeasible manual overrides generate warnings and never exceed hard limits silently', () => {
    const s = resolveArchitecturalStrategy(inputFor(2, { [OVERRIDE_KEYS.corridorLimit]: 2 }));
    expect(s.warnings.some(w => w.includes('not feasible'))).toBe(true);
    // The user's value is kept (not silently ignored) but flagged
    expect(s.geometry.corridorAreaLimitPercent).toBe(2);

    const hard = ASPECT_RATIO_STANDARDS.bedroom.hard;
    const over = resolveArchitecturalStrategy(
      inputFor(2, { [OVERRIDE_KEYS.aspectRatio('bedroom')]: hard + 0.6 }),
    );
    expect(over.geometry.maximumAspectRatioByRoomType.bedroom).toBe(hard);
    expect(over.warnings.some(w => w.includes('hard maximum'))).toBe(true);
  });

  it('12. hidden advanced values do not unexpectedly affect generation', () => {
    const key = OVERRIDE_KEYS.corridorLimit;
    const auto = resolveArchitecturalStrategy(inputFor(2));
    // Simulate: user overrode a value, then reset it — no stale residue
    const toggled = withoutOverride(withOverride({}, key, 9), key);
    const resolved = resolveArchitecturalStrategy(inputFor(2, toggled));
    expect(JSON.stringify(resolved)).toBe(JSON.stringify(auto));
    // And a design-prefs snapshot from the auto strategy matches too
    expect(JSON.stringify(designPrefsFromStrategy(resolved))).toBe(
      JSON.stringify(designPrefsFromStrategy(auto)),
    );
  });

  it('13. tier-2 usability always outranks tier 3 — profiles cannot reorder validity hierarchy', () => {
    const profiles: StrategyProfile[] = ['balanced', 'daylight', 'privacy', 'compact'];
    for (const p of profiles) {
      const order = prioritiesForProfile(p);
      expect(order[0]).toBe('areaError');
      const shapeIdx = order.indexOf('shapeQuality');
      for (const t3 of TIER3) {
        expect(shapeIdx).toBeLessThan(order.indexOf(t3));
      }
      expect(order.indexOf('balance')).toBe(order.length - 1);
      // All seven soft metrics present exactly once
      expect(new Set(order).size).toBe(7);
    }
    // A manual profile override cannot smuggle hard constraints into the soft order either
    const s = resolveArchitecturalStrategy(inputFor(2, { [OVERRIDE_KEYS.profile]: 'compact' }));
    expect(s.optimisation.lexicographicPriorities[0]).toBe('areaError');
    expect(s.optimisation.lexicographicPriorities.every(k =>
      ['areaError', 'daylight', 'privacy', 'corridorEfficiency', 'wetClustering', 'shapeQuality', 'balance'].includes(k),
    )).toBe(true);
  });

  it('14. automatic profile selection is deterministic for the same inputs', () => {
    const a = resolveArchitecturalStrategy(inputFor(2));
    const b = resolveArchitecturalStrategy(inputFor(2));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    for (const preset of STRATEGY_PRESETS.map(p => p.id) as StrategyPresetId[]) {
      const x = resolveArchitecturalStrategy(inputFor(3, undefined, { preset }));
      const y = resolveArchitecturalStrategy(inputFor(3, undefined, { preset }));
      expect(x.optimisation.profile).toBe(y.optimisation.profile);
      expect(JSON.stringify(x)).toBe(JSON.stringify(y));
    }
  });

  it('15. resolved strategy and its explanation stay consistent', () => {
    const s = resolveArchitecturalStrategy(inputFor(2));
    const text = s.summary.join('\n');
    expect(text).toContain(`${s.geometry.corridorAreaLimitPercent}%`);
    expect(text.toLowerCase()).toContain('bedroom');
    // Preset change is reflected in the explanation
    const daylight = resolveArchitecturalStrategy(inputFor(2, undefined, { preset: 'max_daylight' }));
    expect(daylight.optimisation.profile).toBe('daylight');
    expect(daylight.summary.join('\n')).toContain('Maximum Daylight');
    // designPrefs bridge stays in sync with the strategy
    const prefs = designPrefsFromStrategy(s);
    expect(prefs.maxCorridorRatio).toBeCloseTo(s.geometry.corridorAreaLimitPercent / 100, 6);
    expect(prefs.privacyOppositeEntry).toBe(s.privacy.keepBedroomsAwayFromEntranceFacade);
  });
});
