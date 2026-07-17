import type { AccessNode, AccessNodeCategory, AccessTree, AreaBudget } from '../types.ts';
import type { ProgramSpec } from '../../types/index.ts';

export class InfeasibleProgrammeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InfeasibleProgrammeError';
  }
}

interface CategoryDefaults {
  minArea: number;
  targetMin: number;
  targetMax: number;
  maxArea: number;
  minWidth: number;
  minHeight: number;
  preferredAspectRatio: number;
  areaPriority: number;
}

const DEFAULTS: Record<AccessNodeCategory, CategoryDefaults> = {
  ENTRY: {
    minArea: 1.5, targetMin: 2, targetMax: 4, maxArea: 5,
    minWidth: 1.0, minHeight: 1.0, preferredAspectRatio: 1.2, areaPriority: 2,
  },
  FOYER: {
    minArea: 1.5, targetMin: 2, targetMax: 4, maxArea: 5,
    minWidth: 1.0, minHeight: 1.0, preferredAspectRatio: 1.2, areaPriority: 2,
  },
  CORRIDOR: {
    minArea: 2.0, targetMin: 3, targetMax: 8, maxArea: 12,
    minWidth: 1.0, minHeight: 1.0, preferredAspectRatio: 3.0, areaPriority: 3,
  },
  LIVING: {
    minArea: 14, targetMin: 17, targetMax: 21, maxArea: 28,
    minWidth: 3.0, minHeight: 3.0, preferredAspectRatio: 1.3, areaPriority: 10,
  },
  KITCHEN: {
    minArea: 6, targetMin: 7, targetMax: 10, maxArea: 14,
    minWidth: 2.1, minHeight: 2.1, preferredAspectRatio: 1.4, areaPriority: 7,
  },
  BEDROOM: {
    minArea: 9.5, targetMin: 11, targetMax: 15, maxArea: 20,
    minWidth: 2.4, minHeight: 2.4, preferredAspectRatio: 1.25, areaPriority: 9,
  },
  COMMON_BATHROOM: {
    minArea: 2.8, targetMin: 3.5, targetMax: 5, maxArea: 6,
    minWidth: 1.2, minHeight: 1.5, preferredAspectRatio: 1.2, areaPriority: 5,
  },
  ENSUITE_BATHROOM: {
    minArea: 2.5, targetMin: 3.0, targetMax: 5, maxArea: 6,
    minWidth: 1.2, minHeight: 1.2, preferredAspectRatio: 1.2, areaPriority: 5,
  },
  UTILITY: {
    minArea: 1.5, targetMin: 2, targetMax: 4, maxArea: 5,
    minWidth: 1.2, minHeight: 1.2, preferredAspectRatio: 1.5, areaPriority: 3,
  },
  BALCONY: {
    minArea: 1.5, targetMin: 2, targetMax: 5, maxArea: 8,
    minWidth: 1.0, minHeight: 1.0, preferredAspectRatio: 2.0, areaPriority: 2,
  },
};

/** Build area budgets for an access tree given carpet area. */
export function buildAreaBudgets(
  tree: AccessTree,
  carpetArea: number,
): AreaBudget[] {
  const budgets: AreaBudget[] = [];

  for (const node of tree.nodes) {
    const d = DEFAULTS[node.category];
    let maxArea = d.maxArea;
    if (node.category === 'ENTRY' || node.category === 'FOYER') {
      maxArea = Math.min(maxArea, carpetArea * 0.06);
    }
    if (node.category === 'CORRIDOR') {
      maxArea = Math.min(maxArea, carpetArea * 0.12);
    }
    budgets.push({
      roomId: node.id,
      category: node.category,
      minArea: d.minArea,
      targetArea: (d.targetMin + d.targetMax) / 2,
      maxArea,
      minWidth: d.minWidth,
      minHeight: d.minHeight,
      preferredAspectRatio: d.preferredAspectRatio,
      areaPriority: d.areaPriority,
    });
  }

  normalizeTargets(budgets, carpetArea);
  assertFeasible(budgets, carpetArea);
  return budgets;
}

/** Derive a programme node list from ProgramSpec (counts). */
export function programmeFromSpec(spec: ProgramSpec): {
  bedrooms: number;
  bathrooms: number;
  hasUtility: boolean;
  hasBalcony: boolean;
  hasFoyer: boolean;
} {
  const count = (t: string) =>
    spec.rooms.filter(r => r.type === t).reduce((s, r) => s + r.count, 0);

  const bathrooms = count('bathroom') + count('ensuite');
  return {
    bedrooms: count('bedroom'),
    bathrooms: Math.max(1, bathrooms),
    hasUtility: count('utility') > 0 || count('storage') > 0,
    hasBalcony: count('balcony') > 0,
    hasFoyer: count('foyer') > 0 || spec.totalAreaTarget >= 60,
  };
}

function normalizeTargets(budgets: AreaBudget[], carpetArea: number): void {
  const sumTargets = budgets.reduce((s, b) => s + b.targetArea, 0);
  if (sumTargets <= carpetArea * 0.98) {
    // Distribute leftover to high-priority rooms
    let leftover = carpetArea * 0.97 - sumTargets;
    const ranked = [...budgets].sort((a, b) => b.areaPriority - a.areaPriority);
    for (const b of ranked) {
      if (leftover <= 0) break;
      const room = budgets.find(x => x.roomId === b.roomId)!;
      const grow = Math.min(leftover, room.maxArea - room.targetArea);
      if (grow > 0) {
        room.targetArea += grow;
        leftover -= grow;
      }
    }
    return;
  }

  // Scale down soft targets but never below minArea
  const mins = budgets.reduce((s, b) => s + b.minArea, 0);
  if (mins > carpetArea) {
    throw new InfeasibleProgrammeError(
      `Programme minimum area ${mins.toFixed(1)} m² exceeds carpet ${carpetArea.toFixed(1)} m²`
    );
  }

  let flexible = sumTargets - mins;
  let available = carpetArea * 0.97 - mins;
  const scale = flexible > 0 ? available / flexible : 0;
  for (const b of budgets) {
    const soft = b.targetArea - b.minArea;
    b.targetArea = b.minArea + soft * scale;
    b.targetArea = Math.min(b.targetArea, b.maxArea);
  }
}

function assertFeasible(budgets: AreaBudget[], carpetArea: number): void {
  const mins = budgets.reduce((s, b) => s + b.minArea, 0);
  if (mins > carpetArea + 1e-6) {
    throw new InfeasibleProgrammeError(
      `Infeasible programme: sum(minArea)=${mins.toFixed(2)} > carpet=${carpetArea.toFixed(2)}`
    );
  }
  for (const b of budgets) {
    if (b.minArea > b.maxArea + 1e-9) {
      throw new InfeasibleProgrammeError(
        `Room ${b.roomId} has minArea ${b.minArea} > maxArea ${b.maxArea}`
      );
    }
  }
}

export function budgetFor(budgets: AreaBudget[], roomId: string): AreaBudget {
  const b = budgets.find(x => x.roomId === roomId);
  if (!b) throw new Error(`Missing budget for ${roomId}`);
  return b;
}

export function nodeById(tree: AccessTree, id: string): AccessNode {
  const n = tree.nodes.find(x => x.id === id);
  if (!n) throw new Error(`Missing node ${id}`);
  return n;
}
