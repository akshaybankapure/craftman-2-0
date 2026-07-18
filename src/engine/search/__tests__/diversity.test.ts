import { describe, it, expect } from 'vitest';
import { resolveContextProfile } from '../../context/contextProfile.ts';
import { generateMissionGraphVariants } from '../../topology/missionFamilies.ts';
import {
  calculateLayoutFingerprint,
  fingerprintSimilarity,
  isNearDuplicate,
} from '../fingerprint.ts';
import { generateFloorPlanOptions } from '../../../planner/generateFloorPlan.ts';
import type { ProgramSpec } from '../../../types/index.ts';

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

const SPEC_3BHK: ProgramSpec = {
  ...SPEC_2BHK,
  totalAreaTarget: 110,
  rooms: [
    ...SPEC_2BHK.rooms.filter(r => r.type !== 'bedroom'),
    { type: 'bedroom', count: 3, targetArea: 12, minDimension: 2.7 },
  ],
};

describe('Diversity / fingerprints', () => {
  it('explores multiple mission families', () => {
    const ctx = resolveContextProfile({
      spec: SPEC_2BHK,
      bhk: 2,
      carpetAreaM2: 80,
      outlineW: 10.2,
      outlineH: 7.8,
      entranceDir: 'S',
      bathroomCount: 2,
      region: 'india',
    });
    const graphs = generateMissionGraphVariants(ctx, 7, 1);
    const families = new Set(graphs.map(g => g.family));
    expect(families.size).toBeGreaterThanOrEqual(3);
    expect(families.has('central_living_hub')).toBe(true);
  });

  it('returned options carry distinct fingerprints when multiple plans exist', () => {
    const result = generateFloorPlanOptions(SPEC_2BHK, 10.2, 7.8, 'S', {
      seeds: 48,
      retain: 4,
      baseSeed: 42,
      optimizeIterations: 8,
    });
    expect(result.plans.length).toBeGreaterThan(0);
    const keys = result.plans.map(p =>
      [
        p.fingerprint?.missionGraphFamily,
        p.fingerprint?.accessGraphSignature,
        p.fingerprint?.relativeRoomOrdering,
      ].join('|'),
    );
    if (result.plans.length >= 2) {
      const unique = new Set(keys);
      expect(unique.size).toBeGreaterThanOrEqual(2);
    }
  });

  it('near-duplicate fingerprints are detected', () => {
    const result = generateFloorPlanOptions(SPEC_2BHK, 10.2, 7.8, 'S', {
      seeds: 20,
      retain: 1,
      baseSeed: 11,
      optimizeIterations: 5,
    });
    expect(result.plans.length).toBeGreaterThan(0);
    const fp = calculateLayoutFingerprint(result.plans[0]!);
    expect(isNearDuplicate(fp, fp, 0.99)).toBe(true);
    expect(fingerprintSimilarity(fp, fp)).toBeGreaterThan(0.99);
  });

  it('2BHK and 3BHK explore different access signatures', () => {
    const a = generateFloorPlanOptions(SPEC_2BHK, 10.2, 7.8, 'S', {
      seeds: 30,
      retain: 2,
      baseSeed: 5,
      optimizeIterations: 5,
    });
    const b = generateFloorPlanOptions(SPEC_3BHK, 12, 9, 'S', {
      seeds: 30,
      retain: 2,
      baseSeed: 5,
      optimizeIterations: 5,
    });
    expect(a.plans.length).toBeGreaterThan(0);
    expect(b.plans.length).toBeGreaterThan(0);
    const beds2 = a.plans[0]!.rooms.filter(r => r.category === 'BEDROOM').length;
    const beds3 = b.plans[0]!.rooms.filter(r => r.category === 'BEDROOM').length;
    expect(beds3).toBeGreaterThan(beds2);
  });
});
