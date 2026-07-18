import { boundingBox, polygonArea, signedPolygonArea } from "./polygon.ts";
import type { Polygon, RoomShapeMetrics } from "../types.ts";

function perimeter(poly: Polygon): number {
  let total = 0;
  for (let i = 0; i < poly.outer.length; i++) {
    const a = poly.outer[i]!;
    const b = poly.outer[(i + 1) % poly.outer.length]!;
    total += Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }
  return total;
}

export function calculateRoomShapeMetrics(poly: Polygon, minimumUsefulEdgeMm = 500): RoomShapeMetrics {
  const pts = poly.outer;
  const area = polygonArea(poly);
  const p = perimeter(poly);
  const box = boundingBox(poly);
  const boxArea = Math.max(1, (box.maxX - box.minX) * (box.maxY - box.minY));
  const boundingFillRatio = area / boxArea;
  const orientation = Math.sign(signedPolygonArea(pts)) || 1;
  let reflexCornerCount = 0;
  let shortEdgeCount = 0;

  for (let i = 0; i < pts.length; i++) {
    const prev = pts[(i - 1 + pts.length) % pts.length]!;
    const cur = pts[i]!;
    const next = pts[(i + 1) % pts.length]!;
    const cross = (cur.x - prev.x) * (next.y - cur.y) - (cur.y - prev.y) * (next.x - cur.x);
    if (Math.sign(cross) !== 0 && Math.sign(cross) !== orientation) reflexCornerCount++;
    const edgeLength = Math.abs(cur.x - next.x) + Math.abs(cur.y - next.y);
    if (edgeLength < minimumUsefulEdgeMm) shortEdgeCount++;
  }

  const idealPerimeter = 4 * Math.sqrt(Math.max(1, area));
  const perimeterEfficiency = Math.min(1, idealPerimeter / Math.max(idealPerimeter, p));
  const extraVertices = Math.max(0, pts.length - 4);
  const complexityScore =
    extraVertices * 1.5 +
    reflexCornerCount * 3 +
    shortEdgeCount * 2 +
    (1 - perimeterEfficiency) * 12 +
    (1 - boundingFillRatio) * 10;

  return {
    vertexCount: pts.length,
    reflexCornerCount,
    perimeterMm: p,
    perimeterEfficiency,
    boundingFillRatio,
    shortEdgeCount,
    complexityScore
  };
}
