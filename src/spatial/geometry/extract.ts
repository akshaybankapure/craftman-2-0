import { simplifyOrthogonalLoop } from "./polygon.ts";
import type { Point, Polygon, SharedBoundary, SpaceRegion } from "../types.ts";
import { OccupancyGrid } from "../grid/OccupancyGrid.ts";

interface Edge {
  start: Point;
  end: Point;
}

function key(p: Point): string {
  return `${p.x},${p.y}`;
}

function traceLoops(edges: Edge[]): Point[][] {
  const byStart = new Map<string, Edge[]>();
  for (const edge of edges) {
    const list = byStart.get(key(edge.start)) ?? [];
    list.push(edge);
    byStart.set(key(edge.start), list);
  }
  const unused = new Set(edges.map((_, i) => i));
  const indexByEdge = new Map<Edge, number>(edges.map((e, i) => [e, i]));
  const loops: Point[][] = [];

  while (unused.size > 0) {
    const firstIndex = unused.values().next().value as number;
    const first = edges[firstIndex]!;
    const loop: Point[] = [first.start];
    let current = first;
    unused.delete(firstIndex);
    let guard = edges.length + 5;

    while (guard-- > 0) {
      loop.push(current.end);
      if (current.end.x === first.start.x && current.end.y === first.start.y) break;
      const candidates = (byStart.get(key(current.end)) ?? []).filter((e) => unused.has(indexByEdge.get(e)!));
      if (candidates.length === 0) break;
      current = candidates[0]!;
      unused.delete(indexByEdge.get(current)!);
    }

    if (loop.length >= 4 && loop[loop.length - 1]!.x === loop[0]!.x && loop[loop.length - 1]!.y === loop[0]!.y) {
      loop.pop();
      loops.push(simplifyOrthogonalLoop(loop));
    }
  }
  return loops;
}

export function extractPolygons(grid: OccupancyGrid, spaces: SpaceRegion[]): Map<string, Polygon[]> {
  const result = new Map<string, Polygon[]>();
  for (const space of spaces) {
    const edges: Edge[] = [];
    for (let idx = 0; idx < grid.labels.length; idx++) {
      if (grid.labels[idx] !== space.label) continue;
      const { x, y } = grid.coords(idx);
      const top = y > 0 ? grid.labels[grid.index(x, y - 1)] : -999;
      const right = x + 1 < grid.width ? grid.labels[grid.index(x + 1, y)] : -999;
      const bottom = y + 1 < grid.height ? grid.labels[grid.index(x, y + 1)] : -999;
      const left = x > 0 ? grid.labels[grid.index(x - 1, y)] : -999;
      if (top !== space.label) edges.push({ start: { x, y }, end: { x: x + 1, y } });
      if (right !== space.label) edges.push({ start: { x: x + 1, y }, end: { x: x + 1, y: y + 1 } });
      if (bottom !== space.label) edges.push({ start: { x: x + 1, y: y + 1 }, end: { x, y: y + 1 } });
      if (left !== space.label) edges.push({ start: { x, y: y + 1 }, end: { x, y } });
    }
    const loops = traceLoops(edges).map((loop) => ({
      outer: loop.map((p) => ({ x: p.x * grid.cellSizeMm, y: p.y * grid.cellSizeMm }))
    }));
    result.set(space.id, loops);
  }
  return result;
}

interface UnitWall {
  a: number;
  b: number;
  orientation: "H" | "V";
  fixed: number;
  start: number;
  end: number;
}

export function deriveSharedBoundaries(grid: OccupancyGrid, spaces: SpaceRegion[]): SharedBoundary[] {
  const walls: UnitWall[] = [];
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const idx = grid.index(x, y);
      const a = grid.labels[idx]!;
      if (a < 0) continue;
      if (x + 1 < grid.width) {
        const b = grid.labels[grid.index(x + 1, y)]!;
        if (b >= 0 && a !== b) walls.push({ a: Math.min(a, b), b: Math.max(a, b), orientation: "V", fixed: x + 1, start: y, end: y + 1 });
      }
      if (y + 1 < grid.height) {
        const b = grid.labels[grid.index(x, y + 1)]!;
        if (b >= 0 && a !== b) walls.push({ a: Math.min(a, b), b: Math.max(a, b), orientation: "H", fixed: y + 1, start: x, end: x + 1 });
      }
    }
  }

  const groups = new Map<string, UnitWall[]>();
  for (const wall of walls) {
    const k = `${wall.a}:${wall.b}:${wall.orientation}:${wall.fixed}`;
    const list = groups.get(k) ?? [];
    list.push(wall);
    groups.set(k, list);
  }

  const segmentsByPair = new Map<string, SharedBoundary>();
  for (const list of groups.values()) {
    list.sort((u, v) => u.start - v.start);
    let current = { ...list[0]! };
    const merged: UnitWall[] = [];
    for (let i = 1; i < list.length; i++) {
      const next = list[i]!;
      if (next.start === current.end) current.end = next.end;
      else {
        merged.push(current);
        current = { ...next };
      }
    }
    merged.push(current);

    for (const seg of merged) {
      const pairKey = `${seg.a}:${seg.b}`;
      const existing = segmentsByPair.get(pairKey) ?? {
        roomAId: spaces[seg.a]!.id,
        roomBId: spaces[seg.b]!.id,
        segments: [],
        totalLengthMm: 0
      };
      existing.segments.push({
        orientation: seg.orientation,
        fixed: seg.fixed * grid.cellSizeMm,
        start: seg.start * grid.cellSizeMm,
        end: seg.end * grid.cellSizeMm
      });
      existing.totalLengthMm += (seg.end - seg.start) * grid.cellSizeMm;
      segmentsByPair.set(pairKey, existing);
    }
  }
  return [...segmentsByPair.values()];
}
