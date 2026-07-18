import type { Point, Polygon } from "../types.ts";

export function polygonArea(poly: Polygon): number {
  const pts = poly.outer;
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

export function signedPolygonArea(points: Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

export function pointInPolygon(point: Point, poly: Polygon): boolean {
  const pts = poly.outer;
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const pi = pts[i]!;
    const pj = pts[j]!;
    const intersects =
      pi.y > point.y !== pj.y > point.y &&
      point.x < ((pj.x - pi.x) * (point.y - pi.y)) / (pj.y - pi.y || 1e-12) + pi.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function orientation(a: Point, b: Point, c: Point): number {
  const v = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(v) < 1e-9) return 0;
  return v > 0 ? 1 : 2;
}

function onSegment(a: Point, b: Point, c: Point): boolean {
  return (
    b.x <= Math.max(a.x, c.x) &&
    b.x >= Math.min(a.x, c.x) &&
    b.y <= Math.max(a.y, c.y) &&
    b.y >= Math.min(a.y, c.y)
  );
}

export function segmentsIntersect(p1: Point, q1: Point, p2: Point, q2: Point): boolean {
  const o1 = orientation(p1, q1, p2);
  const o2 = orientation(p1, q1, q2);
  const o3 = orientation(p2, q2, p1);
  const o4 = orientation(p2, q2, q1);

  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(p1, p2, q1)) return true;
  if (o2 === 0 && onSegment(p1, q2, q1)) return true;
  if (o3 === 0 && onSegment(p2, p1, q2)) return true;
  if (o4 === 0 && onSegment(p2, q1, q2)) return true;
  return false;
}

export function isSimplePolygon(poly: Polygon): boolean {
  const pts = poly.outer;
  if (pts.length < 4) return false;
  for (let i = 0; i < pts.length; i++) {
    const a1 = pts[i]!;
    const a2 = pts[(i + 1) % pts.length]!;
    for (let j = i + 1; j < pts.length; j++) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === pts.length - 1)) continue;
      const b1 = pts[j]!;
      const b2 = pts[(j + 1) % pts.length]!;
      if (segmentsIntersect(a1, a2, b1, b2)) return false;
    }
  }
  return true;
}

export function isOrthogonalPolygon(poly: Polygon): boolean {
  return poly.outer.every((p, i) => {
    const q = poly.outer[(i + 1) % poly.outer.length]!;
    return p.x === q.x || p.y === q.y;
  });
}

export function boundingBox(poly: Polygon): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of poly.outer) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

export function rectanglePolygon(widthMm: number, heightMm: number): Polygon {
  return {
    outer: [
      { x: 0, y: 0 },
      { x: widthMm, y: 0 },
      { x: widthMm, y: heightMm },
      { x: 0, y: heightMm }
    ]
  };
}

export function simplifyOrthogonalLoop(points: Point[]): Point[] {
  if (points.length <= 4) return points;
  const result: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    const prev = points[(i - 1 + points.length) % points.length]!;
    const curr = points[i]!;
    const next = points[(i + 1) % points.length]!;
    const collinear = (prev.x === curr.x && curr.x === next.x) || (prev.y === curr.y && curr.y === next.y);
    if (!collinear) result.push(curr);
  }
  return result;
}
