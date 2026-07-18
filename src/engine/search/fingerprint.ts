/**
 * Layout fingerprints for near-duplicate rejection (embedding-style descriptors).
 */

import type { FloorPlan } from '../../planner/types.ts';
import { roomCentroid } from '../../planner/types.ts';
import type { MissionGraph, MissionGraphFamily } from '../topology/missionTypes.ts';

export interface LayoutFingerprint {
  missionGraphFamily: string;
  adjacencySignature: string;
  accessGraphSignature: string;
  corridorSkeletonSignature: string;
  relativeRoomOrdering: string;
  exteriorContactVector: number[];
  aspectRatioVector: number[];
}

export function calculateLayoutFingerprint(
  plan: FloorPlan,
  missionFamily?: MissionGraphFamily | string,
): LayoutFingerprint {
  const family =
    missionFamily ??
    (plan as FloorPlan & { missionGraph?: MissionGraph }).missionGraph?.family ??
    'unknown';

  const adjacencySignature = plan.doors
    .filter(d => d.roomBId !== '__EXTERIOR__')
    .map(d => {
      const a = plan.rooms.find(r => r.id === d.roomAId)?.category ?? '?';
      const b = plan.rooms.find(r => r.id === d.roomBId)?.category ?? '?';
      return [a, b].sort().join('-');
    })
    .sort()
    .join(';');

  const accessGraphSignature = plan.topology.edges
    .map(e => {
      const a = plan.topology.nodes.find(n => n.id === e.parentId)?.category ?? '?';
      const b = plan.topology.nodes.find(n => n.id === e.childId)?.category ?? '?';
      return `${a}>${b}`;
    })
    .sort()
    .join(';');

  const corridorSkeletonSignature = `${plan.spine.shape}:${plan.spine.centreline.length}`;

  const relativeRoomOrdering = [...plan.rooms]
    .map(r => {
      const c = roomCentroid(r);
      const qx = Math.round((c.x / Math.max(1e-6, plan.outlineW)) * 4);
      const qy = Math.round((c.y / Math.max(1e-6, plan.outlineH)) * 4);
      return `${r.category}@${qx},${qy}`;
    })
    .sort()
    .join('|');

  const exteriorContactVector = exteriorContacts(plan);
  const aspectRatioVector = plan.rooms
    .filter(r => r.category !== 'CORRIDOR')
    .map(r => {
      const ar = Math.max(r.w, r.h) / Math.max(1e-6, Math.min(r.w, r.h));
      return Math.round(ar * 10) / 10;
    })
    .sort((a, b) => a - b);

  return {
    missionGraphFamily: family,
    adjacencySignature,
    accessGraphSignature,
    corridorSkeletonSignature,
    relativeRoomOrdering,
    exteriorContactVector,
    aspectRatioVector,
  };
}

function exteriorContacts(plan: FloorPlan): number[] {
  // [N, E, S, W] counts of habitable rooms touching that façade
  const counts = [0, 0, 0, 0];
  const eps = 0.15;
  for (const r of plan.rooms) {
    if (r.category === 'CORRIDOR' || r.category === 'ENTRY' || r.category === 'FOYER') continue;
    if (r.y <= eps) counts[0]!++;
    if (r.x + r.w >= plan.outlineW - eps) counts[1]!++;
    if (r.y + r.h >= plan.outlineH - eps) counts[2]!++;
    if (r.x <= eps) counts[3]!++;
  }
  return counts;
}

export function fingerprintKey(fp: LayoutFingerprint): string {
  return [
    fp.missionGraphFamily,
    fp.accessGraphSignature,
    fp.adjacencySignature,
    fp.corridorSkeletonSignature,
    fp.relativeRoomOrdering,
    fp.exteriorContactVector.join(','),
  ].join('::');
}

/** Structural similarity in [0,1]. High = near-duplicate topology/placement. */
export function fingerprintSimilarity(a: LayoutFingerprint, b: LayoutFingerprint): number {
  let score = 0;
  let n = 0;
  const add = (eq: boolean, w = 1) => {
    score += eq ? w : 0;
    n += w;
  };
  add(a.missionGraphFamily === b.missionGraphFamily, 2);
  add(a.accessGraphSignature === b.accessGraphSignature, 3);
  add(a.adjacencySignature === b.adjacencySignature, 2);
  add(a.corridorSkeletonSignature === b.corridorSkeletonSignature, 1);
  add(a.relativeRoomOrdering === b.relativeRoomOrdering, 2);

  // Exterior contact cosine-ish
  const ea = a.exteriorContactVector;
  const eb = b.exteriorContactVector;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < 4; i++) {
    dot += (ea[i] ?? 0) * (eb[i] ?? 0);
    na += (ea[i] ?? 0) ** 2;
    nb += (eb[i] ?? 0) ** 2;
  }
  const cos = na > 0 && nb > 0 ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 1;
  score += cos;
  n += 1;

  return n > 0 ? score / n : 0;
}

export function isNearDuplicate(
  a: LayoutFingerprint,
  b: LayoutFingerprint,
  threshold = 0.92,
): boolean {
  return fingerprintSimilarity(a, b) >= threshold;
}
