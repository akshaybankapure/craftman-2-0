import { describe, it, expect } from 'vitest';
import { resolveContextProfile } from '../../context/contextProfile.ts';
import {
  eligibleFamilies,
  generateMissionGraph,
  generateMissionGraphVariants,
  programmeFromContext,
} from '../missionFamilies.ts';
import { ALL_MISSION_FAMILIES, CORRIDOR_LESS_FAMILIES } from '../missionTypes.ts';
import { validateMissionGraph } from '../missionValidate.ts';
import { missionGraphToAccessTree } from '../toAccessTree.ts';
import { isBathroom } from '../../../planner/topology/accessMatrix.ts';
import { bathroomRemovalInvariant } from '../../../planner/topology/generateAccessTrees.ts';
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

function ctx2() {
  return resolveContextProfile({
    spec: SPEC_2BHK,
    bhk: 2,
    carpetAreaM2: 80,
    outlineW: 10.2,
    outlineH: 7.8,
    entranceDir: 'S',
    bathroomCount: 2,
    region: 'india',
  });
}

describe('Mission graph families', () => {
  it('explores multiple graph families for India 2BHK', () => {
    const ctx = ctx2();
    const families = new Set(eligibleFamilies(ctx));
    expect(families.has('central_living_hub')).toBe(true);
    expect(families.has('living_integrated_circulation')).toBe(true);
    const graphs = generateMissionGraphVariants(ctx, 42, 1);
    const used = new Set(graphs.map(g => g.family));
    expect(used.size).toBeGreaterThanOrEqual(3);
  });

  it('every family produces a valid mission graph', () => {
    const ctx = ctx2();
    for (const family of ALL_MISSION_FAMILIES) {
      const g = generateMissionGraph(family, ctx, 100);
      const v = validateMissionGraph(g);
      expect(v.valid, `${family}: ${v.errors.join('; ')}`).toBe(true);
    }
  });

  it('bathrooms always have degree one', () => {
    const ctx = ctx2();
    for (const family of ALL_MISSION_FAMILIES) {
      const g = generateMissionGraph(family, ctx, 11);
      const deg = new Map<string, number>();
      for (const n of g.nodes) deg.set(n.id, 0);
      for (const e of g.edges) {
        deg.set(e.from, (deg.get(e.from) ?? 0) + 1);
        deg.set(e.to, (deg.get(e.to) ?? 0) + 1);
      }
      for (const n of g.nodes) {
        if (n.type === 'COMMON_BATHROOM' || n.type === 'ENSUITE') {
          expect(deg.get(n.id)).toBe(1);
        }
      }
    }
  });

  it('forbids bathroom↔bathroom and bathroom↔kitchen and bedroom↔bedroom', () => {
    const ctx = ctx2();
    for (const family of ALL_MISSION_FAMILIES) {
      const g = generateMissionGraph(family, ctx, 22);
      const byId = new Map(g.nodes.map(n => [n.id, n]));
      for (const e of g.edges) {
        const a = byId.get(e.from)!;
        const b = byId.get(e.to)!;
        const bath = (t: string) => t === 'COMMON_BATHROOM' || t === 'ENSUITE';
        expect(!(bath(a.type) && bath(b.type))).toBe(true);
        expect(!(bath(a.type) && b.type === 'KITCHEN')).toBe(true);
        expect(!(bath(b.type) && a.type === 'KITCHEN')).toBe(true);
        expect(!(a.type === 'BEDROOM' && b.type === 'BEDROOM')).toBe(true);
      }
    }
  });

  it('converts to legal AccessTree for every family', () => {
    const ctx = ctx2();
    for (const family of ALL_MISSION_FAMILIES) {
      const g = generateMissionGraph(family, ctx, 33);
      expect(() => missionGraphToAccessTree(g)).not.toThrow();
      const tree = missionGraphToAccessTree(g);
      expect(bathroomRemovalInvariant(tree)).toBe(true);
      for (const n of tree.nodes) {
        if (isBathroom(n.category)) {
          const deg = tree.edges.filter(
            e => e.parentId === n.id || e.childId === n.id,
          ).length;
          expect(deg).toBe(1);
        }
      }
    }
  });

  it('corridor-less families do not emit a CORRIDOR mission node', () => {
    const ctx = ctx2();
    for (const family of CORRIDOR_LESS_FAMILIES) {
      const g = generateMissionGraph(family, ctx, 44);
      expect(g.nodes.some(n => n.type === 'CORRIDOR')).toBe(false);
      // private threshold or living-hub instead
      expect(
        g.nodes.some(n => n.type === 'PRIVATE_THRESHOLD' || n.type === 'LIVING'),
      ).toBe(true);
    }
  });

  it('same seed is deterministic', () => {
    const ctx = ctx2();
    const a = generateMissionGraph('central_living_hub', ctx, 12345);
    const b = generateMissionGraph('central_living_hub', ctx, 12345);
    expect(a.nodes.map(n => n.id).join(',')).toBe(b.nodes.map(n => n.id).join(','));
    expect(a.edges.map(e => `${e.from}>${e.to}`).join(';')).toBe(
      b.edges.map(e => `${e.from}>${e.to}`).join(';'),
    );
  });

  it('programme matches context bedrooms', () => {
    const ctx = ctx2();
    expect(programmeFromContext(ctx).bedrooms).toBe(2);
  });
});
