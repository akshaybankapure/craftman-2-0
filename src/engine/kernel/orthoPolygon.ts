/**
 * Orthogonal rectangle / multi-rect (L-shape) geometry helpers.
 */

export type Rect = { x: number; y: number; w: number; h: number };

export function rectArea(r: Rect): number {
  return Math.max(0, r.w) * Math.max(0, r.h);
}

export function rectOverlapArea(a: Rect, b: Rect): number {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  if (x1 <= x0 || y1 <= y0) return 0;
  return (x1 - x0) * (y1 - y0);
}

export function rectsOverlap(a: Rect, b: Rect, eps = 1e-9): boolean {
  return rectOverlapArea(a, b) > eps;
}

/** Edge-adjacent (shared wall length > eps), not merely corner touch. */
export function sharedWallLength(a: Rect, b: Rect, eps = 1e-6): number {
  // Vertical shared wall
  const touchV =
    Math.abs(a.x + a.w - b.x) < eps || Math.abs(b.x + b.w - a.x) < eps;
  if (touchV) {
    const y0 = Math.max(a.y, b.y);
    const y1 = Math.min(a.y + a.h, b.y + b.h);
    return Math.max(0, y1 - y0);
  }
  // Horizontal shared wall
  const touchH =
    Math.abs(a.y + a.h - b.y) < eps || Math.abs(b.y + b.h - a.y) < eps;
  if (touchH) {
    const x0 = Math.max(a.x, b.x);
    const x1 = Math.min(a.x + a.w, b.x + b.w);
    return Math.max(0, x1 - x0);
  }
  return 0;
}

export function areEdgeAdjacent(a: Rect, b: Rect, minLen = 0.05): boolean {
  return sharedWallLength(a, b) >= minLen;
}

/** Merge axis-aligned rects that share a full edge into fewer parts (greedy). */
export function simplifyOrthoParts(parts: Rect[], eps = 1e-6): Rect[] {
  if (parts.length <= 1) return parts.map(r => ({ ...r }));
  let cur = parts.map(r => ({ ...r }));
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < cur.length; i++) {
      for (let j = i + 1; j < cur.length; j++) {
        const a = cur[i]!;
        const b = cur[j]!;
        // Same height, side-by-side
        if (Math.abs(a.y - b.y) < eps && Math.abs(a.h - b.h) < eps) {
          if (Math.abs(a.x + a.w - b.x) < eps) {
            cur[i] = { x: a.x, y: a.y, w: a.w + b.w, h: a.h };
            cur.splice(j, 1);
            changed = true;
            break outer;
          }
          if (Math.abs(b.x + b.w - a.x) < eps) {
            cur[i] = { x: b.x, y: a.y, w: a.w + b.w, h: a.h };
            cur.splice(j, 1);
            changed = true;
            break outer;
          }
        }
        // Same width, stacked
        if (Math.abs(a.x - b.x) < eps && Math.abs(a.w - b.w) < eps) {
          if (Math.abs(a.y + a.h - b.y) < eps) {
            cur[i] = { x: a.x, y: a.y, w: a.w, h: a.h + b.h };
            cur.splice(j, 1);
            changed = true;
            break outer;
          }
          if (Math.abs(b.y + b.h - a.y) < eps) {
            cur[i] = { x: a.x, y: b.y, w: a.w, h: a.h + b.h };
            cur.splice(j, 1);
            changed = true;
            break outer;
          }
        }
      }
    }
  }
  return cur;
}

/**
 * Convert a set of grid cell indices into a list of maximal rectangles
 * (run-length merge rows then columns). Prefers few large rects.
 */
export function cellsToOrthoRects(
  cols: number,
  rows: number,
  cellSize: number,
  cells: readonly number[],
): Rect[] {
  if (cells.length === 0) return [];
  const mask = new Uint8Array(cols * rows);
  for (const i of cells) {
    if (i >= 0 && i < mask.length) mask[i] = 1;
  }

  // Horizontal runs per row → rects of 1 cell height
  const runs: Rect[] = [];
  for (let cy = 0; cy < rows; cy++) {
    let cx = 0;
    while (cx < cols) {
      while (cx < cols && !mask[cy * cols + cx]) cx++;
      if (cx >= cols) break;
      const start = cx;
      while (cx < cols && mask[cy * cols + cx]) cx++;
      runs.push({
        x: start * cellSize,
        y: cy * cellSize,
        w: (cx - start) * cellSize,
        h: cellSize,
      });
    }
  }
  return simplifyOrthoParts(runs);
}

export function boundingRect(parts: Rect[]): Rect | null {
  if (parts.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of parts) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function aspectRatio(r: Rect): number {
  if (r.w < 1e-9 || r.h < 1e-9) return Infinity;
  return Math.max(r.w, r.h) / Math.min(r.w, r.h);
}

/** Prefer single rectangle when parts form a filled AABB (no holes / missing corners). */
export function preferRectangle(parts: Rect[], eps = 1e-6): Rect[] {
  const bb = boundingRect(parts);
  if (!bb) return [];
  const area = parts.reduce((s, p) => s + rectArea(p), 0);
  if (Math.abs(area - rectArea(bb)) < eps) return [bb];
  return simplifyOrthoParts(parts, eps);
}
