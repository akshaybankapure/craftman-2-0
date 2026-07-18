/**
 * 1D closed-open interval algebra for door-capable wall segments.
 * Intervals are [start, end) along a wall axis in metres.
 */

export type Interval = { start: number; end: number };

export function intervalLen(i: Interval): number {
  return Math.max(0, i.end - i.start);
}

export function isEmpty(i: Interval, eps = 1e-9): boolean {
  return i.end - i.start <= eps;
}

export function mergeIntervals(intervals: Interval[], eps = 1e-9): Interval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals]
    .filter(i => !isEmpty(i, eps))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  if (sorted.length === 0) return [];
  const out: Interval[] = [{ ...sorted[0]! }];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!;
    const last = out[out.length - 1]!;
    if (cur.start <= last.end + eps) {
      last.end = Math.max(last.end, cur.end);
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

/** Subtract B from A: returns pieces of A that do not overlap any of B. */
export function subtractIntervals(a: Interval[], b: Interval[], eps = 1e-9): Interval[] {
  let remaining = mergeIntervals(a, eps);
  const blockers = mergeIntervals(b, eps);
  for (const block of blockers) {
    const next: Interval[] = [];
    for (const r of remaining) {
      if (block.end <= r.start + eps || block.start >= r.end - eps) {
        next.push(r);
        continue;
      }
      if (block.start > r.start + eps) {
        next.push({ start: r.start, end: Math.min(block.start, r.end) });
      }
      if (block.end < r.end - eps) {
        next.push({ start: Math.max(block.end, r.start), end: r.end });
      }
    }
    remaining = next.filter(i => !isEmpty(i, eps));
  }
  return remaining;
}

export function intersectIntervals(a: Interval[], b: Interval[], eps = 1e-9): Interval[] {
  const A = mergeIntervals(a, eps);
  const B = mergeIntervals(b, eps);
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < A.length && j < B.length) {
    const x = A[i]!;
    const y = B[j]!;
    const start = Math.max(x.start, y.start);
    const end = Math.min(x.end, y.end);
    if (end - start > eps) out.push({ start, end });
    if (x.end < y.end) i++;
    else j++;
  }
  return out;
}

/** Longest sub-interval of `source` that can host a door of `width` with clearances. */
export function longestDoorSlot(
  source: Interval[],
  width: number,
  cornerClearance = 0.05,
  eps = 1e-9,
): Interval | null {
  let best: Interval | null = null;
  let bestLen = 0;
  for (const raw of mergeIntervals(source, eps)) {
    const start = raw.start + cornerClearance;
    const end = raw.end - cornerClearance;
    if (end - start + eps < width) continue;
    const len = end - start;
    if (len > bestLen) {
      bestLen = len;
      best = { start, end };
    }
  }
  return best;
}

export function containsPoint(intervals: Interval[], t: number, eps = 1e-9): boolean {
  return intervals.some(i => t >= i.start - eps && t <= i.end + eps);
}
