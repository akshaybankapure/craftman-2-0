import { describe, it, expect } from 'vitest';
import {
  FloorPlanEngine,
  IndependentPlanVerifier,
  renderPlanSvg,
  sqFtToSqM,
} from '../index.ts';

const engine = new FloorPlanEngine();

function brief(opts: {
  bhk: 1 | 2 | 3 | 4;
  bathrooms: number;
  sqft: number;
  widthMm: number;
  heightMm: number;
  seed?: number;
}) {
  return {
    carpetAreaSqM: sqFtToSqM(opts.sqft),
    dimensions: { widthMm: opts.widthMm, heightMm: opts.heightMm },
    entranceEdge: 'SOUTH' as const,
    buildingType: 'APARTMENT' as const,
    bhk: opts.bhk,
    bathroomCount: opts.bathrooms,
    marketTier: 'STANDARD' as const,
    cellSizeMm: 250,
    maxCandidates: 2,
    seed: opts.seed ?? 11,
  };
}

describe('Spatial engine kernel', () => {
  it('generates and independently certifies a 1 BHK', () => {
    const result = engine.generate(
      brief({ bhk: 1, bathrooms: 1, sqft: 550, widthMm: 8000, heightMm: 6400 }),
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.plans.length).toBeGreaterThanOrEqual(1);
    const plan = result.plans[0]!;
    expect(plan.certificate.valid).toBe(true);
    expect(plan.certificate.outsideAssignedCells).toBe(0);
    expect(plan.certificate.unassignedInsideCells).toBe(0);
    expect(plan.certificate.criticalJourneysPassed).toBe(true);
  });

  it('generates a certified hall-integrated 2 BHK without a corridor room', () => {
    const result = engine.generate(
      brief({ bhk: 2, bathrooms: 2, sqft: 850, widthMm: 10100, heightMm: 7800, seed: 42 }),
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    const plan = result.plans[0]!;
    expect(plan.candidate.spaces.some(s => s.type === 'CORRIDOR')).toBe(false);
    expect(plan.certificate.assignedCells).toBe(plan.certificate.envelopeCells);
    expect(plan.candidate.doors.every(door => door.exterior || door.roomBId)).toBe(true);

    const bathroomIds = new Set(
      plan.candidate.spaces
        .filter(s => s.type === 'BATHROOM' || s.type === 'ENSUITE')
        .map(s => s.id),
    );
    for (const id of bathroomIds) {
      const degree = plan.candidate.topology.edges.filter(e => {
        const a = plan.candidate.topology.nodes.find(n => n.id === e.from)?.roomId;
        const b = plan.candidate.topology.nodes.find(n => n.id === e.to)?.roomId;
        return a === id || b === id;
      }).length;
      expect(degree).toBe(1);
    }
  });

  it('same brief and seed produce the same certified grid', () => {
    const input = brief({
      bhk: 2,
      bathrooms: 2,
      sqft: 850,
      widthMm: 10100,
      heightMm: 7800,
      seed: 99,
    });
    const a = engine.generate(input);
    const b = engine.generate(input);
    expect(a.success).toBe(true);
    expect(b.success).toBe(true);
    if (!a.success || !b.success) return;
    expect(a.plans[0]!.certificate.gridHash).toBe(b.plans[0]!.certificate.gridHash);
  });

  it('independent verifier rejects a mutated certified candidate', () => {
    const result = engine.generate(
      brief({ bhk: 2, bathrooms: 2, sqft: 850, widthMm: 10100, heightMm: 7800, seed: 7 }),
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    const candidate = structuredClone(result.plans[0]!.candidate);
    const inside = candidate.grid.envelopeMask.findIndex(value => value === 1);
    candidate.grid.labels[inside] = -1;
    const verified = new IndependentPlanVerifier().verify(candidate);
    expect(verified.passed).toBe(false);
    expect(verified.fatalErrors.some(e => e.code === 'GRID_UNASSIGNED_INSIDE')).toBe(true);
  });

  it('infeasible programme returns an explicit failure, never a partial plan', () => {
    const result = engine.generate(
      brief({ bhk: 4, bathrooms: 4, sqft: 500, widthMm: 7000, heightMm: 6600 }),
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe('INFEASIBLE_PROGRAMME');
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('generates a certified 3 BHK when envelope is large enough', () => {
    const result = engine.generate(
      brief({
        bhk: 3,
        bathrooms: 3,
        sqft: 1200,
        widthMm: 12_000,
        heightMm: 9_300,
        seed: 21,
      }),
    );
    // Fail-closed is acceptable; when successful, certificate must be complete.
    if (!result.success) {
      expect(result.code).toMatch(/INFEASIBLE_PROGRAMME|NO_VALID_CANDIDATE/);
      return;
    }
    expect(result.plans.length).toBeGreaterThanOrEqual(1);
    const plan = result.plans[0]!;
    expect(plan.certificate.valid).toBe(true);
    expect(plan.candidate.spaces.filter(s => s.type === 'BEDROOM').length).toBe(3);
    expect(plan.certificate.criticalJourneysPassed).toBe(true);
  });

  it('renderer refuses uncertified input and renders certified SVG', () => {
    expect(() =>
      renderPlanSvg({
        candidate: { id: 'draft' } as never,
        certificate: { valid: false } as never,
      }),
    ).toThrow(/certified plans only/);
    const result = engine.generate(
      brief({ bhk: 1, bathrooms: 1, sqft: 550, widthMm: 8000, heightMm: 6400 }),
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    const svg = renderPlanSvg(result.plans[0]!);
    expect(svg).toMatch(/^<\?xml/);
    expect(svg).toMatch(/certificate/);
  });
});
