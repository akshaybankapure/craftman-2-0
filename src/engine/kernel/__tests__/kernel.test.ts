import { describe, it, expect } from 'vitest';
import {
  RNG,
  StreamBank,
  streamSeed,
  mergeIntervals,
  subtractIntervals,
  longestDoorSlot,
  addUndirected,
  emptyAdj,
  bfsReachable,
  articulationPoints,
  createGrid,
  floodFill,
  cellIndex,
  labelRegions,
  astarGrid,
  steinerTreeApprox,
  defaultPathCost,
  sharedWallLength,
  areEdgeAdjacent,
  cellsToOrthoRects,
  preferRectangle,
  simplifyOrthoParts,
} from '../index.ts';

describe('RNG streams', () => {
  it('is deterministic for the same seed', () => {
    const a = new RNG(42);
    const b = new RNG(42);
    expect([a.next(), a.next(), a.int(0, 100)]).toEqual([b.next(), b.next(), b.int(0, 100)]);
  });

  it('named streams diverge from each other', () => {
    const bank = new StreamBank(99);
    const t = bank.stream('topology');
    const z = bank.stream('zoning');
    expect(t.next()).not.toBe(z.next());
    // but same name is stable
    expect(new StreamBank(99).stream('topology').next()).toBe(
      new StreamBank(99).stream('topology').next(),
    );
  });

  it('streamSeed mixes name into seed', () => {
    expect(streamSeed(1, 'a')).not.toBe(streamSeed(1, 'b'));
  });

  it('softmaxPick is deterministic and in range', () => {
    const rng = new RNG(7);
    const idx = rng.softmaxPick([1, 5, 1], 0.5);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(3);
    expect(new RNG(7).softmaxPick([1, 5, 1], 0.5)).toBe(idx);
  });
});

describe('intervals', () => {
  it('merges overlapping intervals', () => {
    expect(mergeIntervals([
      { start: 0, end: 2 },
      { start: 1.5, end: 3 },
      { start: 5, end: 6 },
    ])).toEqual([
      { start: 0, end: 3 },
      { start: 5, end: 6 },
    ]);
  });

  it('subtracts blockers', () => {
    const out = subtractIntervals(
      [{ start: 0, end: 10 }],
      [{ start: 3, end: 5 }],
    );
    expect(out).toEqual([
      { start: 0, end: 3 },
      { start: 5, end: 10 },
    ]);
  });

  it('finds longest door slot with clearance', () => {
    const slot = longestDoorSlot([{ start: 0, end: 3 }], 0.8, 0.05);
    expect(slot).not.toBeNull();
    expect(slot!.end - slot!.start).toBeGreaterThanOrEqual(0.8);
  });
});

describe('graphs', () => {
  it('BFS reaches all connected nodes', () => {
    const adj = emptyAdj(['a', 'b', 'c', 'd']);
    addUndirected(adj, 'a', 'b');
    addUndirected(adj, 'b', 'c');
    expect([...bfsReachable(adj, 'a')].sort()).toEqual(['a', 'b', 'c']);
  });

  it('finds articulation points', () => {
    // a-b-c with d off b → b is cut vertex
    const adj = emptyAdj(['a', 'b', 'c', 'd']);
    addUndirected(adj, 'a', 'b');
    addUndirected(adj, 'b', 'c');
    addUndirected(adj, 'b', 'd');
    const ap = articulationPoints(adj);
    expect(ap.has('b')).toBe(true);
  });
});

describe('grid + pathfinding', () => {
  it('flood fills a connected region', () => {
    const g = createGrid(3, 3, 1);
    const mask = new Uint8Array(9);
    mask[0] = 1; mask[1] = 1; mask[3] = 1; // L shape
    const cells = floodFill(g, { cx: 0, cy: 0 }, mask);
    expect(cells.sort()).toEqual([0, 1, 3].sort());
  });

  it('labels disconnected regions', () => {
    const g = createGrid(3, 1, 1);
    const mask = [true, false, true];
    const { regionCount } = labelRegions(g, mask);
    expect(regionCount).toBe(2);
  });

  it('A* finds a path around blocked cells', () => {
    const g = createGrid(5, 3, 1);
    const walk = new Uint8Array(15).fill(1);
    // Block middle column except bottom
    walk[cellIndex(g, 2, 0)] = 0;
    walk[cellIndex(g, 2, 1)] = 0;
    const path = astarGrid(g, { cx: 0, cy: 0 }, { cx: 4, cy: 0 }, defaultPathCost(), walk);
    expect(path).not.toBeNull();
    expect(path!.cells[0]).toEqual({ cx: 0, cy: 0 });
    expect(path!.cells[path!.cells.length - 1]).toEqual({ cx: 4, cy: 0 });
  });

  it('Steiner approx connects multiple terminals', () => {
    const g = createGrid(6, 6, 1);
    const result = steinerTreeApprox(g, [
      { cx: 0, cy: 0 },
      { cx: 5, cy: 0 },
      { cx: 2, cy: 5 },
    ]);
    expect(result).not.toBeNull();
    expect(result!.treeCells.size).toBeGreaterThan(3);
  });
});

describe('ortho geometry', () => {
  it('treats edge contact as adjacency and corner as not', () => {
    const a = { x: 0, y: 0, w: 2, h: 2 };
    const edge = { x: 2, y: 0.5, w: 1, h: 1 };
    const corner = { x: 2, y: 2, w: 1, h: 1 };
    expect(areEdgeAdjacent(a, edge)).toBe(true);
    expect(sharedWallLength(a, corner)).toBe(0);
    expect(areEdgeAdjacent(a, corner)).toBe(false);
  });

  it('simplifies side-by-side runs into one rect', () => {
    const merged = simplifyOrthoParts([
      { x: 0, y: 0, w: 1, h: 1 },
      { x: 1, y: 0, w: 1, h: 1 },
    ]);
    expect(merged).toEqual([{ x: 0, y: 0, w: 2, h: 1 }]);
  });

  it('cellsToOrthoRects + preferRectangle recovers filled AABB', () => {
    const cols = 3;
    const rows = 2;
    const cells = [0, 1, 2, 3, 4, 5];
    const parts = cellsToOrthoRects(cols, rows, 1, cells);
    const pref = preferRectangle(parts);
    expect(pref).toHaveLength(1);
    expect(pref[0]).toEqual({ x: 0, y: 0, w: 3, h: 2 });
  });
});
