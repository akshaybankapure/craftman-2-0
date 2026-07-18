/**
 * Grid A* with pluggable costs + Steiner-tree approximation for multi-target routing.
 */

import {
  cellCenter,
  cellIndex,
  createGrid,
  inBounds,
  indexToCell,
  neighbors4,
  type CellCoord,
  type PlanningGrid,
} from './grid.ts';

export type PathCostFn = (
  from: CellCoord,
  to: CellCoord,
  prevDir: CellCoord | null,
) => number;

export interface PathResult {
  cells: CellCoord[];
  cost: number;
}

const INF = 1e18;

function dirOf(a: CellCoord, b: CellCoord): CellCoord {
  return { cx: Math.sign(b.cx - a.cx), cy: Math.sign(b.cy - a.cy) };
}

function manhattan(a: CellCoord, b: CellCoord): number {
  return Math.abs(a.cx - b.cx) + Math.abs(a.cy - b.cy);
}

/** Default cost: unit distance + turn penalty. */
export function defaultPathCost(
  turnPenalty = 0.35,
): PathCostFn {
  return (_from, _to, prevDir) => {
    let c = 1;
    if (prevDir) {
      const d = dirOf(_from, _to);
      if (d.cx !== prevDir.cx || d.cy !== prevDir.cy) c += turnPenalty;
    }
    return c;
  };
}

export function astarGrid(
  g: PlanningGrid,
  start: CellCoord,
  goal: CellCoord,
  costFn: PathCostFn = defaultPathCost(),
  walkable?: Uint8Array | boolean[] | null,
): PathResult | null {
  if (!inBounds(g, start.cx, start.cy) || !inBounds(g, goal.cx, goal.cy)) return null;
  const n = g.cols * g.rows;
  const startI = cellIndex(g, start.cx, start.cy);
  const goalI = cellIndex(g, goal.cx, goal.cy);
  if (walkable && (!walkable[startI] || !walkable[goalI])) return null;

  const gScore = new Float64Array(n).fill(INF);
  const fScore = new Float64Array(n).fill(INF);
  const came = new Int32Array(n).fill(-1);
  const prevDx = new Int8Array(n).fill(0);
  const prevDy = new Int8Array(n).fill(0);
  const closed = new Uint8Array(n);

  gScore[startI] = 0;
  fScore[startI] = manhattan(start, goal);

  // Binary heap of indices by fScore
  const heap: number[] = [startI];
  const inOpen = new Uint8Array(n);
  inOpen[startI] = 1;

  const less = (a: number, b: number) => fScore[a]! < fScore[b]!;

  const siftUp = (i: number) => {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(heap[i]!, heap[p]!)) break;
      [heap[i], heap[p]] = [heap[p]!, heap[i]!];
      i = p;
    }
  };
  const siftDown = (i: number) => {
    for (;;) {
      let best = i;
      const l = i * 2 + 1;
      const r = l + 1;
      if (l < heap.length && less(heap[l]!, heap[best]!)) best = l;
      if (r < heap.length && less(heap[r]!, heap[best]!)) best = r;
      if (best === i) break;
      [heap[i], heap[best]] = [heap[best]!, heap[i]!];
      i = best;
    }
  };
  const push = (idx: number) => {
    heap.push(idx);
    siftUp(heap.length - 1);
  };
  const pop = (): number => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      siftDown(0);
    }
    return top;
  };

  while (heap.length) {
    const curI = pop();
    inOpen[curI] = 0;
    if (curI === goalI) {
      const cells: CellCoord[] = [];
      let i = goalI;
      while (i !== -1) {
        cells.push(indexToCell(g, i));
        i = came[i]!;
      }
      cells.reverse();
      return { cells, cost: gScore[goalI]! };
    }
    if (closed[curI]) continue;
    closed[curI] = 1;

    const cur = indexToCell(g, curI);
    const pDir: CellCoord | null =
      came[curI] === -1 ? null : { cx: prevDx[curI]!, cy: prevDy[curI]! };

    for (const nb of neighbors4(g, cur.cx, cur.cy)) {
      const ni = cellIndex(g, nb.cx, nb.cy);
      if (closed[ni]) continue;
      if (walkable && !walkable[ni]) continue;
      const step = costFn(cur, nb, pDir);
      const tentative = gScore[curI]! + step;
      if (tentative >= gScore[ni]!) continue;
      came[ni] = curI;
      const d = dirOf(cur, nb);
      prevDx[ni] = d.cx;
      prevDy[ni] = d.cy;
      gScore[ni] = tentative;
      fScore[ni] = tentative + manhattan(nb, goal);
      if (!inOpen[ni]) {
        inOpen[ni] = 1;
        push(ni);
      } else {
        // Decrease-key approximation: re-push
        push(ni);
      }
    }
  }
  return null;
}

/**
 * Steiner-tree approximation: iteratively connect farthest unreached terminal
 * to the growing tree via A*, then merge path cells into the tree.
 */
export function steinerTreeApprox(
  g: PlanningGrid,
  terminals: CellCoord[],
  costFn: PathCostFn = defaultPathCost(),
  walkable?: Uint8Array | boolean[] | null,
): { treeCells: Set<number>; paths: PathResult[]; totalCost: number } | null {
  if (terminals.length === 0) return { treeCells: new Set(), paths: [], totalCost: 0 };
  if (terminals.length === 1) {
    const i = cellIndex(g, terminals[0]!.cx, terminals[0]!.cy);
    return { treeCells: new Set([i]), paths: [], totalCost: 0 };
  }

  const tree = new Set<number>();
  const paths: PathResult[] = [];
  let totalCost = 0;

  // Seed with first terminal
  const seed = terminals[0]!;
  tree.add(cellIndex(g, seed.cx, seed.cy));
  const remaining = terminals.slice(1).map(t => ({ ...t }));

  while (remaining.length) {
    let bestIdx = -1;
    let bestPath: PathResult | null = null;
    let bestAttach: CellCoord | null = null;

    // Sample attach points: all current tree cells (cap for performance)
    const attachPoints: CellCoord[] = [];
    for (const i of tree) attachPoints.push(indexToCell(g, i));
    // Cap dense trees
    const attach =
      attachPoints.length > 80
        ? attachPoints.filter((_, k) => k % Math.ceil(attachPoints.length / 80) === 0)
        : attachPoints;

    for (let ti = 0; ti < remaining.length; ti++) {
      const term = remaining[ti]!;
      for (const a of attach) {
        const path = astarGrid(g, a, term, costFn, walkable);
        if (!path) continue;
        if (!bestPath || path.cost < bestPath.cost) {
          bestPath = path;
          bestIdx = ti;
          bestAttach = a;
        }
      }
    }

    if (!bestPath || bestIdx < 0 || !bestAttach) return null;
    for (const c of bestPath.cells) tree.add(cellIndex(g, c.cx, c.cy));
    paths.push(bestPath);
    totalCost += bestPath.cost;
    remaining.splice(bestIdx, 1);
  }

  return { treeCells: tree, paths, totalCost };
}

/** Convert path cells to world-space centreline polyline. */
export function pathToCentreline(g: PlanningGrid, cells: CellCoord[]): { x: number; y: number }[] {
  return cells.map(c => cellCenter(g, c.cx, c.cy));
}

/** Dilate a set of centreline cells into a corridor of approx `widthM`. */
export function dilateCorridor(
  g: PlanningGrid,
  centreline: Set<number>,
  widthM: number,
): Set<number> {
  const half = Math.max(0, Math.floor(widthM / g.cellSize / 2));
  const out = new Set<number>(centreline);
  if (half === 0) return out;
  for (const i of centreline) {
    const { cx, cy } = indexToCell(g, i);
    for (let dx = -half; dx <= half; dx++) {
      for (let dy = -half; dy <= half; dy++) {
        if (Math.abs(dx) + Math.abs(dy) > half + 0.5) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (inBounds(g, nx, ny)) out.add(cellIndex(g, nx, ny));
      }
    }
  }
  return out;
}

/** Convenience: create grid + path for tests. */
export function pathOnEnvelope(
  widthM: number,
  heightM: number,
  start: { x: number; y: number },
  goal: { x: number; y: number },
  cellSize = 0.3,
): PathResult | null {
  const g = createGrid(widthM, heightM, cellSize);
  const s = {
    cx: Math.min(g.cols - 1, Math.max(0, Math.floor(start.x / cellSize))),
    cy: Math.min(g.rows - 1, Math.max(0, Math.floor(start.y / cellSize))),
  };
  const t = {
    cx: Math.min(g.cols - 1, Math.max(0, Math.floor(goal.x / cellSize))),
    cy: Math.min(g.rows - 1, Math.max(0, Math.floor(goal.y / cellSize))),
  };
  return astarGrid(g, s, t);
}
