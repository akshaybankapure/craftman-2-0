/**
 * Axis-aligned planning grid over a rectangular envelope.
 * Cell coordinates are integer (cx, cy); world coords are metres.
 */

export type CellCoord = { cx: number; cy: number };

export interface PlanningGrid {
  cellSize: number;
  cols: number;
  rows: number;
  widthM: number;
  heightM: number;
}

export function createGrid(widthM: number, heightM: number, cellSize = 0.3): PlanningGrid {
  const cols = Math.max(1, Math.ceil(widthM / cellSize));
  const rows = Math.max(1, Math.ceil(heightM / cellSize));
  return { cellSize, cols, rows, widthM, heightM };
}

export function cellCount(g: PlanningGrid): number {
  return g.cols * g.rows;
}

export function inBounds(g: PlanningGrid, cx: number, cy: number): boolean {
  return cx >= 0 && cy >= 0 && cx < g.cols && cy < g.rows;
}

export function cellCenter(g: PlanningGrid, cx: number, cy: number): { x: number; y: number } {
  return {
    x: (cx + 0.5) * g.cellSize,
    y: (cy + 0.5) * g.cellSize,
  };
}

export function worldToCell(g: PlanningGrid, x: number, y: number): CellCoord {
  return {
    cx: clamp(Math.floor(x / g.cellSize), 0, g.cols - 1),
    cy: clamp(Math.floor(y / g.cellSize), 0, g.rows - 1),
  };
}

export function cellIndex(g: PlanningGrid, cx: number, cy: number): number {
  return cy * g.cols + cx;
}

export function indexToCell(g: PlanningGrid, i: number): CellCoord {
  return { cx: i % g.cols, cy: Math.floor(i / g.cols) };
}

const DIRS4: CellCoord[] = [
  { cx: 1, cy: 0 },
  { cx: -1, cy: 0 },
  { cx: 0, cy: 1 },
  { cx: 0, cy: -1 },
];

export function neighbors4(g: PlanningGrid, cx: number, cy: number): CellCoord[] {
  const out: CellCoord[] = [];
  for (const d of DIRS4) {
    const nx = cx + d.cx;
    const ny = cy + d.cy;
    if (inBounds(g, nx, ny)) out.push({ cx: nx, cy: ny });
  }
  return out;
}

/** Flood-fill connected component from seed where `mask[i]` is true. */
export function floodFill(
  g: PlanningGrid,
  seed: CellCoord,
  mask: Uint8Array | boolean[],
): number[] {
  const start = cellIndex(g, seed.cx, seed.cy);
  if (!mask[start]) return [];
  const seen = new Uint8Array(cellCount(g));
  const stack = [start];
  const out: number[] = [];
  seen[start] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    out.push(i);
    const { cx, cy } = indexToCell(g, i);
    for (const n of neighbors4(g, cx, cy)) {
      const ni = cellIndex(g, n.cx, n.cy);
      if (!seen[ni] && mask[ni]) {
        seen[ni] = 1;
        stack.push(ni);
      }
    }
  }
  return out;
}

/** Label connected components of `mask`. Returns label array (-1 = empty). */
export function labelRegions(g: PlanningGrid, mask: Uint8Array | boolean[]): {
  labels: Int32Array;
  regionCount: number;
  sizes: number[];
} {
  const n = cellCount(g);
  const labels = new Int32Array(n).fill(-1);
  const sizes: number[] = [];
  let region = 0;
  for (let i = 0; i < n; i++) {
    if (!mask[i] || labels[i] >= 0) continue;
    const { cx, cy } = indexToCell(g, i);
    const cells = floodFill(g, { cx, cy }, mask);
    for (const c of cells) labels[c] = region;
    sizes.push(cells.length);
    region++;
  }
  return { labels, regionCount: region, sizes };
}

/** True if cell touches the envelope exterior (edge of grid). */
export function isExteriorCell(g: PlanningGrid, cx: number, cy: number): boolean {
  return cx === 0 || cy === 0 || cx === g.cols - 1 || cy === g.rows - 1;
}

export type FacadeSide = 'N' | 'S' | 'E' | 'W';

export function facadeOfCell(g: PlanningGrid, cx: number, cy: number): FacadeSide[] {
  const sides: FacadeSide[] = [];
  if (cy === 0) sides.push('N');
  if (cy === g.rows - 1) sides.push('S');
  if (cx === 0) sides.push('W');
  if (cx === g.cols - 1) sides.push('E');
  return sides;
}

/** Bounding rect of a set of cell indices in world metres. */
export function cellsBoundingRect(
  g: PlanningGrid,
  cells: readonly number[],
): { x: number; y: number; w: number; h: number } | null {
  if (cells.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const i of cells) {
    const { cx, cy } = indexToCell(g, i);
    minX = Math.min(minX, cx * g.cellSize);
    minY = Math.min(minY, cy * g.cellSize);
    maxX = Math.max(maxX, (cx + 1) * g.cellSize);
    maxY = Math.max(maxY, (cy + 1) * g.cellSize);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
