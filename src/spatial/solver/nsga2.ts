import type { CertifiedPlan } from "../types.ts";

export interface ObjectiveVector {
  areaError: number;
  shapeComplexity: number;
  circulationWaste: number;
  furnishingDiscomfort: number;
  daylightLoss: number;
  privacyLoss: number;
}

export interface RankedPlan {
  plan: CertifiedPlan;
  objectives: ObjectiveVector;
  front: number;
  crowdingDistance: number;
}

export function objectivesForPlan(plan: CertifiedPlan): ObjectiveVector {
  const candidate = plan.candidate;
  const roomCount = Math.max(1, candidate.furnishing.rooms.length);
  const shapeComplexity = candidate.furnishing.rooms.reduce((sum, room) => sum + room.shape.complexityScore, 0) / roomCount;
  const furnishingDiscomfort = candidate.furnishing.rooms.reduce((sum, room) => {
    const roomSpace = candidate.spaces.find((s) => s.id === room.roomId)!;
    const roomArea = Math.max(0.01, roomSpace.cellCount * candidate.grid.cellSizeMm * candidate.grid.cellSizeMm / 1_000_000);
    const walkableRatio = room.connectedWalkableAreaSqM / roomArea;
    return sum + Math.max(0, 0.25 - walkableRatio);
  }, 0) / roomCount;
  return {
    areaError: 1 - candidate.quality.areaFit,
    shapeComplexity,
    circulationWaste: 1 - candidate.quality.circulation,
    furnishingDiscomfort,
    daylightLoss: 1 - candidate.quality.exteriorAccess,
    privacyLoss: 1 - candidate.quality.privacy
  };
}

function values(o: ObjectiveVector): number[] {
  return [o.areaError, o.shapeComplexity, o.circulationWaste, o.furnishingDiscomfort, o.daylightLoss, o.privacyLoss];
}

function dominates(a: ObjectiveVector, b: ObjectiveVector): boolean {
  const av = values(a);
  const bv = values(b);
  let strictlyBetter = false;
  for (let i = 0; i < av.length; i++) {
    if (av[i]! > bv[i]! + 1e-12) return false;
    if (av[i]! + 1e-12 < bv[i]!) strictlyBetter = true;
  }
  return strictlyBetter;
}

export function rankPlansNsga2(plans: CertifiedPlan[]): RankedPlan[] {
  const ranked: RankedPlan[] = plans.map((plan) => ({ plan, objectives: objectivesForPlan(plan), front: -1, crowdingDistance: 0 }));
  const dominatedByCount = new Int32Array(ranked.length);
  const dominatesList: number[][] = Array.from({ length: ranked.length }, () => []);
  const fronts: number[][] = [[]];

  for (let i = 0; i < ranked.length; i++) {
    for (let j = 0; j < ranked.length; j++) {
      if (i === j) continue;
      if (dominates(ranked[i]!.objectives, ranked[j]!.objectives)) dominatesList[i]!.push(j);
      else if (dominates(ranked[j]!.objectives, ranked[i]!.objectives)) dominatedByCount[i] = dominatedByCount[i]! + 1;
    }
    if (dominatedByCount[i] === 0) {
      ranked[i]!.front = 0;
      fronts[0]!.push(i);
    }
  }

  let frontIndex = 0;
  while (fronts[frontIndex]?.length) {
    const next: number[] = [];
    for (const i of fronts[frontIndex]!) {
      for (const j of dominatesList[i]!) {
        dominatedByCount[j] = dominatedByCount[j]! - 1;
        if (dominatedByCount[j] === 0) {
          ranked[j]!.front = frontIndex + 1;
          next.push(j);
        }
      }
    }
    if (next.length) fronts.push(next);
    frontIndex++;
  }

  for (const front of fronts) {
    if (!front.length) continue;
    const objectiveCount = values(ranked[front[0]!]!.objectives).length;
    for (let objective = 0; objective < objectiveCount; objective++) {
      const sorted = [...front].sort((a, b) => values(ranked[a]!.objectives)[objective]! - values(ranked[b]!.objectives)[objective]!);
      ranked[sorted[0]!]!.crowdingDistance = Infinity;
      ranked[sorted[sorted.length - 1]!]!.crowdingDistance = Infinity;
      const min = values(ranked[sorted[0]!]!.objectives)[objective]!;
      const max = values(ranked[sorted[sorted.length - 1]!]!.objectives)[objective]!;
      if (max <= min || sorted.length < 3) continue;
      for (let k = 1; k < sorted.length - 1; k++) {
        const prev = values(ranked[sorted[k - 1]!]!.objectives)[objective]!;
        const next = values(ranked[sorted[k + 1]!]!.objectives)[objective]!;
        ranked[sorted[k]!]!.crowdingDistance += (next - prev) / (max - min);
      }
    }
  }

  return ranked.sort((a, b) => a.front - b.front || b.crowdingDistance - a.crowdingDistance || b.plan.candidate.quality.total - a.plan.candidate.quality.total);
}

export function selectPlansNsga2(plans: CertifiedPlan[], count: number): CertifiedPlan[] {
  return rankPlansNsga2(plans).slice(0, count).map((entry) => entry.plan);
}
