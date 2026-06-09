/**
 * Objective functions. Every objective is a MINIMIZATION (lower = better) so
 * NSGA-II can treat them uniformly. These are deterministic functions of a
 * solved graph — they never run the LLM and never randomize.
 */

import type { FloorGraph, ObjectiveScores, Vec2 } from '../types/index.ts';
import { dist, polygonArea, sub, len } from '../geometry/vec2.ts';

function facePts(graph: FloorGraph, loop: string[]): Vec2[] {
  return loop.map((id) => graph.vertices.get(id)!.pos);
}

/** Sum of |area - target| over all rooms, normalized by total target area. */
function areaError(graph: FloorGraph): number {
  let err = 0;
  let total = 0;
  for (const face of graph.faces.values()) {
    const a = Math.abs(polygonArea(facePts(graph, face.loop)));
    err += Math.abs(a - face.targetArea);
    total += face.targetArea;
  }
  return total > 0 ? err / total : 0;
}

/** Total corridor perimeter length / total usable area. Lower = leaner circulation. */
function circulation(graph: FloorGraph): number {
  let corridorLen = 0;
  let usable = 0;
  for (const face of graph.faces.values()) {
    const pts = facePts(graph, face.loop);
    const a = Math.abs(polygonArea(pts));
    usable += a;
    if (face.type === 'corridor') {
      for (let i = 0; i < pts.length; i++) {
        corridorLen += len(sub(pts[(i + 1) % pts.length], pts[i]));
      }
    }
  }
  return usable > 0 ? corridorLen / usable : 1;
}

/** Fraction of habitable rooms WITHOUT adequate exterior wall exposure.
 *  A room "has daylight" if any of its edges lies near the building outline. */
function daylight(graph: FloorGraph, outline: Vec2[]): number {
  const habitable = ['living', 'kitchen', 'bedroom', 'office'];
  let needs = 0;
  let lit = 0;
  for (const face of graph.faces.values()) {
    if (!habitable.includes(face.type)) continue;
    needs++;
    const pts = facePts(graph, face.loop);
    const hasExterior = pts.some((p) =>
      outline.some((o) => dist(p, o) < 0.75)
    );
    if (hasExterior) lit++;
  }
  return needs > 0 ? 1 - lit / needs : 0;
}

/** How far exterior walls deviate from a regular grid. We measure variance of
 *  exterior edge angles from the dominant axis — regular buildings score low. */
function structuralIrregularity(graph: FloorGraph): number {
  const angles: number[] = [];
  for (const edge of graph.edges.values()) {
    if (!edge.isExterior) continue;
    const a = graph.vertices.get(edge.a)!.pos;
    const b = graph.vertices.get(edge.b)!.pos;
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    // Fold into [0, pi/2) so parallel/antiparallel walls are equivalent.
    angles.push(((ang % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2));
  }
  if (angles.length === 0) return 0;
  const mean = angles.reduce((s, x) => s + x, 0) / angles.length;
  const variance =
    angles.reduce((s, x) => s + (x - mean) ** 2, 0) / angles.length;
  return Math.min(1, variance * 4); // normalize roughly into 0..1
}

/** Penalizes rooms with high aspect ratios (long and skinny). 
 *  Perfect square = 1.0. We return (maxDimension / minDimension) - 1. */
function shapeScore(graph: FloorGraph): number {
  let totalPenalty = 0;
  for (const face of graph.faces.values()) {
    const pts = loopToPts(graph, face.loop);
    const minX = Math.min(...pts.map(p => p.x));
    const maxX = Math.max(...pts.map(p => p.x));
    const minY = Math.min(...pts.map(p => p.y));
    const maxY = Math.max(...pts.map(p => p.y));
    const w = maxX - minX;
    const h = maxY - minY;
    const aspect = Math.max(w / (h || 1), h / (w || 1));
    if (aspect > 2.5) totalPenalty += (aspect - 2.5); // Penalty for very thin rooms
  }
  return Math.min(1, totalPenalty / graph.faces.size);
}

function loopToPts(graph: FloorGraph, loop: string[]): Vec2[] {
  return loop.map(id => graph.vertices.get(id)!.pos);
}

export function scoreObjectives(
  graph: FloorGraph,
  outline: Vec2[]
): ObjectiveScores {
  return {
    areaError: areaError(graph),
    circulation: circulation(graph) + shapeScore(graph), // combine for simplicity or add to type
    daylight: daylight(graph, outline),
    structuralIrregularity: structuralIrregularity(graph),
  };
}

export function objectiveVector(s: ObjectiveScores): number[] {
  return [s.areaError, s.circulation, s.daylight, s.structuralIrregularity];
}
