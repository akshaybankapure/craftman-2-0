import type { FloorPlan } from '../types.ts';
import { roomCentroid } from '../types.ts';

export function planSignature(plan: FloorPlan): string {
  const adj = plan.doors
    .filter(d => d.roomBId !== '__EXTERIOR__')
    .map(d => [d.roomAId, d.roomBId].sort().join('-'))
    .sort()
    .join(';');

  const doorGraph = adj;

  const centroids = plan.rooms
    .map(r => {
      const c = roomCentroid(r);
      return `${r.category}:${c.x.toFixed(1)},${c.y.toFixed(1)}`;
    })
    .sort()
    .join('|');

  const corridor = `${plan.spine.shape}:${plan.spine.width.toFixed(2)}`;

  const topo = plan.topology.edges
    .map(e => `${e.parentId}>${e.childId}`)
    .sort()
    .join(';');

  return `${topo}::${doorGraph}::${corridor}::${centroids}`;
}

export function geometricSimilarity(a: FloorPlan, b: FloorPlan): number {
  if (a.rooms.length !== b.rooms.length) return 0;
  const sortedA = [...a.rooms].sort((x, y) => x.category.localeCompare(y.category) || x.id.localeCompare(y.id));
  const sortedB = [...b.rooms].sort((x, y) => x.category.localeCompare(y.category) || x.id.localeCompare(y.id));
  const n = Math.min(sortedA.length, sortedB.length);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const ca = roomCentroid(sortedA[i]);
    const cb = roomCentroid(sortedB[i]);
    const d = Math.hypot(ca.x - cb.x, ca.y - cb.y);
    sum += Math.max(0, 1 - d / 5);
  }
  return sum / Math.max(1, n);
}

export function dedupePlans(plans: FloorPlan[], similarityThreshold = 0.97): FloorPlan[] {
  const out: FloorPlan[] = [];
  const sigs = new Set<string>();
  for (const p of plans) {
    const sig = planSignature(p);
    if (sigs.has(sig)) continue;
    const tooSimilar = out.some(o => geometricSimilarity(o, p) >= similarityThreshold);
    if (tooSimilar) continue;
    sigs.add(sig);
    out.push(p);
  }
  return out;
}
