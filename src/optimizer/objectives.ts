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

const VALID_CONNECTIONS: Record<string, string[]> = {
  entry: ['living', 'corridor'],
  bathroom: ['corridor', 'bedroom', 'living'],
  kitchen: ['living', 'corridor'],
  bedroom: ['corridor', 'living', 'bathroom'],
  corridor: ['living', 'kitchen', 'bedroom', 'bathroom', 'entry', 'corridor'],
  living: ['entry', 'kitchen', 'bedroom', 'corridor', 'bathroom', 'living'],
  storage: ['corridor', 'kitchen', 'living'],
  office: ['corridor', 'living', 'bedroom'],
};

export function isValidDoorTransition(typeA: string, typeB: string): boolean {
  if (typeA === typeB) return true;
  // If either room is of an unknown type (e.g. storage, office, or custom test types), allow it as a fallback.
  if (!VALID_CONNECTIONS[typeA] || !VALID_CONNECTIONS[typeB]) return true;
  const allowed = VALID_CONNECTIONS[typeA] || [];
  return allowed.includes(typeB);
}

function getSharedEdges(graph: FloorGraph): Map<string, { faceA: string, faceB: string, edgeId: string }> {
  const edgeToFaces = new Map<string, string[]>();
  for (const [faceId, face] of graph.faces) {
    const loop = face.loop;
    const n = loop.length;
    for (let i = 0; i < n; i++) {
      const v1 = loop[i];
      const v2 = loop[(i + 1) % n];
      const sortedEdgeKey = v1 < v2 ? `${v1}-${v2}` : `${v2}-${v1}`;
      
      for (const [edgeId, edge] of graph.edges) {
        const ea = edge.a;
        const eb = edge.b;
        const eKey = ea < eb ? `${ea}-${eb}` : `${eb}-${ea}`;
        if (eKey === sortedEdgeKey) {
          const list = edgeToFaces.get(edgeId) ?? [];
          list.push(faceId);
          edgeToFaces.set(edgeId, list);
          break;
        }
      }
    }
  }
  
  const shared = new Map<string, { faceA: string, faceB: string, edgeId: string }>();
  for (const [edgeId, faces] of edgeToFaces) {
    if (faces.length === 2) {
      const [fa, fb] = faces;
      const key = fa < fb ? `${fa}-${fb}` : `${fb}-${fa}`;
      shared.set(key, { faceA: fa, faceB: fb, edgeId });
    }
  }
  return shared;
}

export function computeRoomIntegration(graph: FloorGraph) {
  let entryId: string | null = null;
  for (const [faceId, face] of graph.faces) {
    if (face.type === 'entry') {
      entryId = faceId;
      break;
    }
  }
  
  const pathLengths = new Map<string, number>();
  if (!entryId) {
    return { flowScore: 0, pathLengths, noEntry: true };
  }
  
  const adj = new Map<string, string[]>();
  for (const [faceId] of graph.faces) {
    adj.set(faceId, []);
  }
  
  const sharedEdges = getSharedEdges(graph);
  for (const { faceA, faceB } of sharedEdges.values()) {
    const faceAObj = graph.faces.get(faceA)!;
    const faceBObj = graph.faces.get(faceB)!;
    if (isValidDoorTransition(faceAObj.type, faceBObj.type)) {
      adj.get(faceA)!.push(faceB);
      adj.get(faceB)!.push(faceA);
    }
  }
  
  const queue: string[] = [entryId];
  pathLengths.set(entryId, 0);
  
  while (queue.length > 0) {
    const curr = queue.shift()!;
    const dist = pathLengths.get(curr)!;
    
    for (const neighbor of adj.get(curr)!) {
      if (!pathLengths.has(neighbor)) {
        pathLengths.set(neighbor, dist + 1);
        queue.push(neighbor);
      }
    }
  }
  
  let sum = 0;
  let count = 0;
  for (const [faceId, face] of graph.faces) {
    if (faceId === entryId) continue;
    const len = pathLengths.get(faceId) ?? 6;
    sum += len;
    count++;
  }
  
  const flowScore = count > 0 ? sum / count : 0;
  return { flowScore, pathLengths, noEntry: false };
}

function loopToPts(graph: FloorGraph, loop: string[]): Vec2[] {
  return loop.map(id => graph.vertices.get(id)!.pos);
}

export function scoreObjectives(
  graph: FloorGraph,
  outline: Vec2[]
): ObjectiveScores {
  const flowInfo = computeRoomIntegration(graph);
  
  // Count isolated rooms (only if an entry room exists)
  let isolatedCount = 0;
  if (!flowInfo.noEntry) {
    for (const [faceId] of graph.faces) {
      if (!flowInfo.pathLengths.has(faceId)) {
        isolatedCount++;
      }
    }
  }
  
  // Check corridor bridge utility
  let corridorPenalty = 0;
  const sharedEdges = getSharedEdges(graph);
  for (const [faceId, face] of graph.faces) {
    if (face.type === 'corridor') {
      let adjCount = 0;
      for (const { faceA, faceB } of sharedEdges.values()) {
        if (faceA === faceId || faceB === faceId) {
          const neighbor = faceA === faceId ? faceB : faceA;
          const neighborObj = graph.faces.get(neighbor)!;
          if (isValidDoorTransition(face.type, neighborObj.type)) {
            adjCount++;
          }
        }
      }
      if (adjCount < 2) {
        corridorPenalty += 0.5; // corridor must bridge at least 2 rooms
      }
    }
  }

  const baseCirculation = circulation(graph);
  const layoutPenalty = shapeScore(graph) + (isolatedCount * 2.0) + corridorPenalty;

  return {
    areaError: areaError(graph),
    circulation: baseCirculation + layoutPenalty,
    daylight: daylight(graph, outline),
    structuralIrregularity: structuralIrregularity(graph),
  };
}

export function objectiveVector(s: ObjectiveScores): number[] {
  return [s.areaError, s.circulation, s.daylight, s.structuralIrregularity];
}
