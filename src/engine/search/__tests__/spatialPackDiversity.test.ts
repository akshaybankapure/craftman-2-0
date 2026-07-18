import { describe, it, expect } from 'vitest';
import type { ProgramSpec } from '../../../types/index.ts';
import { generateFloorPlanOptions } from '../../../planner/generateFloorPlan.ts';
import {
  calculateLayoutFingerprint,
  fingerprintKey,
} from '../fingerprint.ts';

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

describe('unified spatialPack diversity', () => {
  it('2 BHK with seeds>=24 produces 2+ distinct spatialPack fingerprints before dedupe', () => {
    const result = generateFloorPlanOptions(SPEC_2BHK, 10.1, 7.8, 'S', {
      seeds: 36,
      retain: 8,
      baseSeed: 11,
      optimizeIterations: 5,
    });

    expect(result.plans.length).toBeGreaterThan(0);
    expect(result.spatialDiagnostics).toBeDefined();

    const converted = result.spatialDiagnostics!.converted;
    expect(converted).toBeGreaterThanOrEqual(2);

    const spatialInRetain = result.plans.filter(
      p => p.debug?.geometryEngine === 'spatialPack',
    );
    if (spatialInRetain.length >= 2) {
      const keys = new Set(
        spatialInRetain.map(p =>
          fingerprintKey(
            p.fingerprint ?? calculateLayoutFingerprint(p, p.missionGraph?.family),
          ),
        ),
      );
      expect(keys.size).toBeGreaterThanOrEqual(2);
    }
  }, 120_000);
});
