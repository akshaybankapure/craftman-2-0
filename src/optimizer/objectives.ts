/**
 * Soft objective functions for valid floor plans.
 * Hard connectivity / door legality live in validateFloorPlan — not here.
 * Centroid MST graph construction has been removed.
 */

import type { FloorGraph, ObjectiveScores, Vec2 } from '../types/index.ts';
import { dist, polygonArea, sub, len } from '../geometry/vec2.ts';
import type { FloorPlan, RoutePolyline } from '../planner/types.ts';
import { roomArea, roomCentroid } from '../planner/types.ts';

function facePts(graph: FloorGraph, loop: string[]): Vec2[] {
  return loop.map((id) => graph.vertices.get(id)!.pos);
}

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

function structuralIrregularity(graph: FloorGraph): number {
  const angles: number[] = [];
  for (const edge of graph.edges.values()) {
    if (!edge.isExterior) continue;
    const a = graph.vertices.get(edge.a)!.pos;
    const b = graph.vertices.get(edge.b)!.pos;
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    angles.push(((ang % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2));
  }
  if (angles.length === 0) return 0;
  const mean = angles.reduce((s, x) => s + x, 0) / angles.length;
  const variance =
    angles.reduce((s, x) => s + (x - mean) ** 2, 0) / angles.length;
  return Math.min(1, variance * 4);
}

/** Portal-based flow info for Graph overlay (doors only, no MST). */
export interface FlowInfo {
  flowScore: number;
  pathLengths: Map<string, number>;
  noEntry: boolean;
  edges: { faceA: string; faceB: string; doorPt: { x: number; y: number }; route?: Vec2[] }[];
}

/** Build FlowInfo from a validated FloorPlan (preferred). */
export function flowInfoFromPlan(plan: FloorPlan): FlowInfo {
  const entry = plan.rooms.find(r => r.category === 'ENTRY');
  if (!entry) {
    return { flowScore: 0, pathLengths: new Map(), noEntry: true, edges: [] };
  }

  const adj = new Map<string, string[]>();
  for (const r of plan.rooms) adj.set(r.id, []);
  const edges: FlowInfo['edges'] = [];

  for (const d of plan.doors) {
    if (d.roomBId === '__EXTERIOR__') continue;
    adj.get(d.roomAId)!.push(d.roomBId);
    adj.get(d.roomBId)!.push(d.roomAId);
    const route = plan.routes.find(
      r =>
        (r.roomAId === d.roomAId && r.roomBId === d.roomBId) ||
        (r.roomAId === d.roomBId && r.roomBId === d.roomAId),
    );
    edges.push({
      faceA: d.roomAId,
      faceB: d.roomBId,
      doorPt: d.position,
      route: route?.points,
    });
  }

  const pathLengths = new Map<string, number>();
  const q = [entry.id];
  pathLengths.set(entry.id, 0);
  while (q.length) {
    const cur = q.shift()!;
    const distN = pathLengths.get(cur)!;
    for (const n of adj.get(cur) ?? []) {
      if (!pathLengths.has(n)) {
        pathLengths.set(n, distN + 1);
        q.push(n);
      }
    }
  }

  let sum = 0;
  let count = 0;
  for (const r of plan.rooms) {
    if (r.id === entry.id) continue;
    sum += pathLengths.get(r.id) ?? 10;
    count++;
  }

  return {
    flowScore: count > 0 ? sum / count : 0,
    pathLengths,
    noEntry: false,
    edges,
  };
}

/**
 * Legacy adapter: derive door edges from shared face geometry on a FloorGraph.
 * Does NOT run MST — only includes faces that share a wall ≥ 1.0m.
 */
export function computeRoomIntegration(graph: FloorGraph): FlowInfo {
  let entryId: string | null = null;
  const faceIds = Array.from(graph.faces.keys());
  for (const faceId of faceIds) {
    if (graph.faces.get(faceId)!.type === 'entry') {
      entryId = faceId;
      break;
    }
  }
  if (!entryId) {
    return { flowScore: 0, pathLengths: new Map(), noEntry: true, edges: [] };
  }

  const rects = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const id of faceIds) {
    const face = graph.faces.get(id)!;
    const pts = facePts(graph, face.loop);
    const xs = pts.map(p => p.x);
    const ys = pts.map(p => p.y);
    rects.set(id, {
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
    });
  }

  const edges: FlowInfo['edges'] = [];
  const adj = new Map<string, string[]>();
  for (const id of faceIds) adj.set(id, []);

  const minShare = 1.0;
  const eps = 0.05;
  for (let i = 0; i < faceIds.length; i++) {
    for (let j = i + 1; j < faceIds.length; j++) {
      const a = faceIds[i];
      const b = faceIds[j];
      const r1 = rects.get(a)!;
      const r2 = rects.get(b)!;
      let doorPt: Vec2 | null = null;

      if (Math.abs(r1.x + r1.w - r2.x) < eps || Math.abs(r2.x + r2.w - r1.x) < eps) {
        const y1 = Math.max(r1.y, r2.y);
        const y2 = Math.min(r1.y + r1.h, r2.y + r2.h);
        if (y2 - y1 >= minShare) {
          const x = Math.abs(r1.x + r1.w - r2.x) < eps ? r1.x + r1.w : r2.x + r2.w;
          doorPt = { x, y: (y1 + y2) / 2 };
        }
      }
      if (!doorPt && (Math.abs(r1.y + r1.h - r2.y) < eps || Math.abs(r2.y + r2.h - r1.y) < eps)) {
        const x1 = Math.max(r1.x, r2.x);
        const x2 = Math.min(r1.x + r1.w, r2.x + r2.w);
        if (x2 - x1 >= minShare) {
          const y = Math.abs(r1.y + r1.h - r2.y) < eps ? r1.y + r1.h : r2.y + r2.h;
          doorPt = { x: (x1 + x2) / 2, y };
        }
      }
      if (!doorPt) continue;

      // Only architecturally plausible pairs (soft filter for legacy view)
      const tA = graph.faces.get(a)!.type;
      const tB = graph.faces.get(b)!.type;
      if (!legacyAllowed(tA, tB)) continue;

      edges.push({ faceA: a, faceB: b, doorPt });
      adj.get(a)!.push(b);
      adj.get(b)!.push(a);
    }
  }

  const pathLengths = new Map<string, number>();
  const q = [entryId];
  pathLengths.set(entryId, 0);
  while (q.length) {
    const cur = q.shift()!;
    for (const n of adj.get(cur) ?? []) {
      if (!pathLengths.has(n)) {
        pathLengths.set(n, pathLengths.get(cur)! + 1);
        q.push(n);
      }
    }
  }

  let sum = 0;
  let count = 0;
  for (const id of faceIds) {
    if (id === entryId) continue;
    sum += pathLengths.get(id) ?? 10;
    count++;
  }

  return {
    flowScore: count > 0 ? sum / count : 0,
    pathLengths,
    noEntry: false,
    edges,
  };
}

function legacyAllowed(a: string, b: string): boolean {
  const pair = [a, b].sort().join('|');
  const forbidden = new Set([
    'bathroom|bathroom',
    'ensuite|ensuite',
    'bathroom|ensuite',
    'bathroom|kitchen',
    'ensuite|kitchen',
    'bathroom|living',
    'ensuite|living',
    'bedroom|bedroom',
  ]);
  if (forbidden.has(pair)) return false;
  return true;
}

export function scoreObjectives(
  graph: FloorGraph,
  outline: Vec2[]
): ObjectiveScores {
  return {
    areaError: areaError(graph),
    circulation: circulation(graph),
    daylight: daylight(graph, outline),
    structuralIrregularity: structuralIrregularity(graph),
  };
}

export function scorePlanSoft(plan: FloorPlan): ObjectiveScores {
  let areaErr = 0;
  for (const r of plan.rooms) {
    const b = plan.budgets.find(x => x.roomId === r.id);
    if (!b) continue;
    areaErr += Math.abs(roomArea(r) - b.targetArea) / Math.max(1, b.targetArea);
  }
  areaErr /= Math.max(1, plan.rooms.length);

  return {
    areaError: areaErr,
    circulation: plan.validation.metrics.corridorAreaRatio,
    daylight: plan.scores?.daylight ?? 0,
    structuralIrregularity: plan.scores?.shapeQuality ?? 0,
  };
}

export function objectiveVector(scores: ObjectiveScores): number[] {
  return [
    scores.areaError,
    scores.circulation,
    scores.daylight,
    scores.structuralIrregularity,
  ];
}

export type { RoutePolyline };
void roomCentroid;
