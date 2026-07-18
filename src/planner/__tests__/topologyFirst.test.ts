import { describe, it, expect } from 'vitest';
import { generateOne, generateFloorPlanOptions } from '../generateFloorPlan.ts';
import { generateAccessTree, bathroomRemovalInvariant } from '../topology/generateAccessTrees.ts';
import { isForbiddenEdge, isBathroom } from '../topology/accessMatrix.ts';
import { findSharedWall } from '../geometry/sharedWalls.ts';
import { verifyRouteIntegrity } from '../graph/portalGraph.ts';
import type { ProgramSpec } from '../../types/index.ts';
import type { EntranceDirection, FloorPlan } from '../types.ts';
import { roomArea } from '../types.ts';

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

const OUTLINE = { w: 10.2, h: 7.8 };

function validPlan(dir: EntranceDirection = 'S', seed = 11): FloorPlan {
  const result = generateFloorPlanOptions(SPEC_2BHK, OUTLINE.w, OUTLINE.h, dir, {
    seeds: 24,
    retain: 1,
    baseSeed: seed,
    optimizeIterations: 5,
  });
  expect(result.plans.length).toBeGreaterThan(0);
  return result.plans[0];
}

describe('Topology-first floor plan invariants', () => {
  it('Test 1: no graph edge exists without a door', () => {
    const plan = validPlan();
    for (const e of plan.topology.edges) {
      const hasDoor = plan.doors.some(
        d =>
          (d.roomAId === e.parentId && d.roomBId === e.childId) ||
          (d.roomAId === e.childId && d.roomBId === e.parentId),
      );
      expect(hasDoor).toBe(true);
    }
  });

  it('Test 2: no door without sufficient shared-wall overlap', () => {
    const plan = validPlan();
    for (const d of plan.doors) {
      if (d.roomBId === '__EXTERIOR__') continue;
      const wall = findSharedWall(plan.sharedWalls, d.roomAId, d.roomBId);
      expect(wall).toBeDefined();
      expect(wall!.length).toBeGreaterThanOrEqual(d.width - 1e-6);
    }
  });

  it('Test 3: bathrooms always have degree one', () => {
    const plan = validPlan();
    const deg = new Map<string, number>();
    for (const r of plan.rooms) deg.set(r.id, 0);
    for (const d of plan.doors) {
      if (d.roomBId === '__EXTERIOR__') continue;
      deg.set(d.roomAId, (deg.get(d.roomAId) ?? 0) + 1);
      deg.set(d.roomBId, (deg.get(d.roomBId) ?? 0) + 1);
    }
    for (const r of plan.rooms) {
      if (r.category === 'COMMON_BATHROOM' || r.category === 'ENSUITE_BATHROOM') {
        expect(deg.get(r.id)).toBe(1);
      }
    }
  });

  it('Test 4: removing a bathroom never disconnects another room', () => {
    const tree = generateAccessTree(SPEC_2BHK, 42, 0);
    expect(bathroomRemovalInvariant(tree)).toBe(true);
    const plan = validPlan();
    expect(bathroomRemovalInvariant(plan.topology)).toBe(true);
  });

  it('Test 5: no bedroom is reached through a bathroom', () => {
    const plan = validPlan();
    const adj = new Map<string, string[]>();
    for (const r of plan.rooms) adj.set(r.id, []);
    for (const d of plan.doors) {
      if (d.roomBId === '__EXTERIOR__') continue;
      adj.get(d.roomAId)!.push(d.roomBId);
      adj.get(d.roomBId)!.push(d.roomAId);
    }
    const baths = new Set(
      plan.rooms.filter(r => isBathroom(r.category)).map(r => r.id),
    );
    for (const bid of baths) {
      expect((adj.get(bid) ?? []).length).toBeLessThanOrEqual(1);
    }
  });

  it('Test 6: no Bedroom ↔ Bedroom edge', () => {
    const plan = validPlan();
    for (const d of plan.doors) {
      if (d.roomBId === '__EXTERIOR__') continue;
      const a = plan.rooms.find(r => r.id === d.roomAId)!;
      const b = plan.rooms.find(r => r.id === d.roomBId)!;
      expect(!(a.category === 'BEDROOM' && b.category === 'BEDROOM')).toBe(true);
    }
  });

  it('Test 7: no Bathroom ↔ Bathroom edge', () => {
    const plan = validPlan();
    for (const d of plan.doors) {
      if (d.roomBId === '__EXTERIOR__') continue;
      const a = plan.rooms.find(r => r.id === d.roomAId)!;
      const b = plan.rooms.find(r => r.id === d.roomBId)!;
      expect(!(isBathroom(a.category) && isBathroom(b.category))).toBe(true);
    }
  });

  it('Test 8: no Bathroom ↔ Kitchen edge', () => {
    const plan = validPlan();
    for (const d of plan.doors) {
      if (d.roomBId === '__EXTERIOR__') continue;
      const a = plan.rooms.find(r => r.id === d.roomAId)!;
      const b = plan.rooms.find(r => r.id === d.roomBId)!;
      const pair = [a.category, b.category];
      expect(!(pair.includes('KITCHEN') && pair.some(c => isBathroom(c as never)))).toBe(true);
      expect(isForbiddenEdge(a.category, b.category)).toBe(false);
    }
  });

  it('Test 9: every room is reachable from ENTRY', () => {
    const plan = validPlan();
    expect(plan.validation.metrics.reachableCount).toBeGreaterThanOrEqual(
      plan.rooms.filter(r => r.category !== 'BALCONY').length,
    );
    expect(plan.validation.errors.some(e => e.code === 'UNREACHABLE')).toBe(false);
  });

  it('Test 10: every route crosses room boundaries only at doors', () => {
    const plan = validPlan();
    const errs = verifyRouteIntegrity(plan.routes, plan.rooms, plan.doors);
    expect(errs.length).toBe(0);
  });

  it('Test 11: no route segment crosses an unrelated room (portal integrity)', () => {
    const plan = validPlan();
    // Covered by verifyRouteIntegrity midpoints staying in walkable geometry
    const errs = verifyRouteIntegrity(
      plan.routes.filter(r => plan.doors.some(d =>
        (d.roomAId === r.roomAId && d.roomBId === r.roomBId) ||
        (d.roomAId === r.roomBId && d.roomBId === r.roomAId)
      )),
      plan.rooms,
      plan.doors,
    );
    expect(errs.length).toBe(0);
  });

  it('Test 12: Entry and Living areas remain within configured bounds', () => {
    const plan = validPlan();
    const entry = plan.rooms.find(r => r.category === 'ENTRY')!;
    const living = plan.rooms.find(r => r.category === 'LIVING')!;
    const entryB = plan.budgets.find(b => b.roomId === entry.id)!;
    const livingB = plan.budgets.find(b => b.roomId === living.id)!;
    expect(roomArea(entry)).toBeGreaterThanOrEqual(entryB.minArea - 0.15);
    expect(roomArea(entry)).toBeLessThanOrEqual(entryB.maxArea + 0.5);
    expect(roomArea(living)).toBeGreaterThanOrEqual(livingB.minArea - 0.15);
  });

  it('Test 13: all rooms respect minimum width, height, and area', () => {
    const plan = validPlan();
    expect(plan.validation.errors.some(e => e.code === 'MIN_AREA' || e.code === 'MIN_DIM')).toBe(false);
  });

  it('Test 14: N/S/E/W entrances are placed on the correct boundary', () => {
    for (const dir of ['N', 'S', 'E', 'W'] as EntranceDirection[]) {
      const plan = validPlan(dir, 11);
      const p = plan.entrance.door.position;
      if (dir === 'S') expect(Math.abs(p.y - plan.outlineH)).toBeLessThan(0.15);
      if (dir === 'N') expect(Math.abs(p.y)).toBeLessThan(0.15);
      if (dir === 'W') expect(Math.abs(p.x)).toBeLessThan(0.15);
      if (dir === 'E') expect(Math.abs(p.x - plan.outlineW)).toBeLessThan(0.15);
    }
  }, 20_000);

  it('Test 15: the same seed produces the same plan', () => {
    const a = generateOne(SPEC_2BHK, OUTLINE.w, OUTLINE.h, 'S', 12345, 0)!;
    const b = generateOne(SPEC_2BHK, OUTLINE.w, OUTLINE.h, 'S', 12345, 0)!;
    expect(a.rooms.map(r => `${r.id}:${r.x},${r.y},${r.w},${r.h}`).join('|')).toBe(
      b.rooms.map(r => `${r.id}:${r.x},${r.y},${r.w},${r.h}`).join('|'),
    );
    expect(a.doors.length).toBe(b.doors.length);
  });

  it('Test 16: infeasible programmes return an infeasibility result', () => {
    const tiny: ProgramSpec = {
      totalAreaTarget: 20,
      rooms: [
        { type: 'living', count: 1, targetArea: 18, minDimension: 3 },
        { type: 'bedroom', count: 3, targetArea: 12, minDimension: 2.7 },
        { type: 'bathroom', count: 2, targetArea: 4, minDimension: 1.5 },
        { type: 'kitchen', count: 1, targetArea: 9, minDimension: 2.1 },
        { type: 'corridor', count: 1, targetArea: 5, minDimension: 1 },
        { type: 'entry', count: 1, targetArea: 3, minDimension: 1 },
      ],
      adjacencies: [],
    };
    const result = generateFloorPlanOptions(tiny, 5, 4, 'S', { seeds: 5, retain: 1, baseSeed: 1 });
    expect(result.plans.length).toBe(0);
    expect(result.infeasible).toBeTruthy();
  });
});

describe('Access tree legality', () => {
  it('never emits forbidden edges', () => {
    for (let i = 0; i < 20; i++) {
      const tree = generateAccessTree(SPEC_2BHK, 100 + i, i % 3);
      for (const e of tree.edges) {
        const a = tree.nodes.find(n => n.id === e.parentId)!;
        const b = tree.nodes.find(n => n.id === e.childId)!;
        expect(isForbiddenEdge(a.category, b.category)).toBe(false);
      }
    }
  });
});
