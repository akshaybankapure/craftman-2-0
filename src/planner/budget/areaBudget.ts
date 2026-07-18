import type { AccessNode, AccessNodeCategory, AccessTree, AreaBudget } from '../types.ts';
import type { ProgramSpec } from '../../types/index.ts';
import type { MarketTier } from '../../engine/context/contextProfile.ts';

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
    minArea: 2.0, targetMin: 3, targetMax: 6, maxArea: 8,
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

/** Mirrors spatial TIER_SCALE so compact/standard/premium actually change budgets. */
const TIER_SCALE: Record<MarketTier, { min: number; target: number; max: number; width: number }> = {
  compact: { min: 0.92, target: 0.9, max: 0.92, width: 0.95 },
  standard: { min: 1, target: 1, max: 1, width: 1 },
  premium: { min: 1.05, target: 1.18, max: 1.3, width: 1.05 },
};

const SPEC_TYPE_TO_CATEGORY: Record<string, AccessNodeCategory> = {
  living: 'LIVING',
  kitchen: 'KITCHEN',
  bedroom: 'BEDROOM',
  bathroom: 'COMMON_BATHROOM',
  ensuite: 'ENSUITE_BATHROOM',
  corridor: 'CORRIDOR',
  entry: 'ENTRY',
  foyer: 'FOYER',
  utility: 'UTILITY',
  balcony: 'BALCONY',
};

/** Build area budgets for an access tree given carpet area. */
export function buildAreaBudgets(
  tree: AccessTree,
  carpetArea: number,
  options?: { spec?: ProgramSpec; tier?: MarketTier },
): AreaBudget[] {
  const tier = options?.tier ?? 'standard';
  const scale = TIER_SCALE[tier];
  const specTargets = specTargetByCategory(options?.spec);
  const budgets: AreaBudget[] = [];

  for (const node of tree.nodes) {
    const d = DEFAULTS[node.category];
    const fromSpec = specTargets.get(node.category);
    // Tier scales targets/max (programme ambition). Structural mins stay stable so
    // compact/premium don't break pack validation on min-width alone.
    // Compact keeps the same hard max caps (only targets shrink) — otherwise
    // spatial packs at ~20–26 m² living hard-fail compact max 25.76.
    const maxScale = tier === 'compact' ? 1 : scale.max;
    let maxArea = d.maxArea * maxScale;
    let minArea = d.minArea;
    let targetArea = fromSpec ?? ((d.targetMin + d.targetMax) / 2) * scale.target;
    let minWidth = d.minWidth;
    let minHeight = d.minHeight;

    if (node.category === 'ENTRY' || node.category === 'FOYER') {
      maxArea = Math.min(maxArea, carpetArea * 0.06);
    }
    if (node.category === 'CORRIDOR') {
      // Corridors are circulation, not leftover dumps — keep tight.
      maxArea = Math.min(maxArea, carpetArea * 0.08, 8);
    }
    if (node.category === 'LIVING') {
      // Hard living cap uses maxScale (compact keeps full 28 m²).
      maxArea = Math.min(maxArea, 28 * maxScale);
    }

    targetArea = Math.min(Math.max(targetArea, minArea), maxArea);

    budgets.push({
      roomId: node.id,
      category: node.category,
      minArea,
      targetArea,
      maxArea,
      minWidth,
      minHeight,
      preferredAspectRatio: d.preferredAspectRatio,
      areaPriority: d.areaPriority,
    });
  }

  normalizeTargets(budgets, carpetArea);
  assertFeasible(budgets, carpetArea);
  return budgets;
}

function specTargetByCategory(spec?: ProgramSpec): Map<AccessNodeCategory, number> {
  const out = new Map<AccessNodeCategory, number>();
  if (!spec) return out;
  for (const r of spec.rooms) {
    const cat = SPEC_TYPE_TO_CATEGORY[r.type];
    if (!cat || !(r.targetArea > 0)) continue;
    // Average when multiple programme lines map to one category.
    const prev = out.get(cat);
    out.set(cat, prev == null ? r.targetArea : (prev + r.targetArea) / 2);
  }
  return out;
}

/** Derive a programme node list from ProgramSpec (counts). */
export function programmeFromSpec(spec: ProgramSpec): {
  bedrooms: number;
  bathrooms: number;
  hasUtility: boolean;
  hasBalcony: boolean;
  hasFoyer: boolean;
} {
  const count = (...types: string[]) =>
    spec.rooms
      .filter(r => types.includes(r.type))
      .reduce((s, r) => s + r.count, 0);

  const bathrooms = count('bathroom', 'ensuite');
  return {
    bedrooms: Math.max(1, count('bedroom')),
    bathrooms: Math.max(1, bathrooms),
    hasUtility: count('utility', 'storage') > 0,
    hasBalcony: count('balcony') > 0,
    hasFoyer: count('foyer') > 0 || spec.totalAreaTarget >= 90,
  };
}

function normalizeTargets(budgets: AreaBudget[], carpetArea: number): void {
  const sumTargets = budgets.reduce((s, b) => s + b.targetArea, 0);
  if (sumTargets <= carpetArea * 0.98) {
    // Distribute leftover to high-priority rooms — but prefer bedrooms after
    // living has a fair share, so living never vacuums the entire carpet.
    let leftover = carpetArea * 0.97 - sumTargets;
    const ranked = [...budgets].sort((a, b) => {
      const rankOf = (x: typeof a) =>
        x.category === 'LIVING'
          ? 100
          : x.category === 'BEDROOM'
            ? 90
            : x.category === 'KITCHEN'
              ? 70
              : x.areaPriority;
      return rankOf(b) - rankOf(a);
    });
    // First pass: grow living at most halfway to max, then fill bedrooms.
    for (const pass of [0, 1] as const) {
      for (const b of ranked) {
        if (leftover <= 0) break;
        if (pass === 0 && b.category !== 'LIVING') continue;
        if (pass === 1 && b.category === 'LIVING') continue;
        const room = budgets.find(x => x.roomId === b.roomId)!;
        const headroom = room.maxArea - room.targetArea;
        if (headroom <= 0) continue;
        const grow =
          pass === 0 && room.category === 'LIVING'
            ? Math.min(leftover, headroom * 0.5)
            : Math.min(leftover, headroom);
        if (grow > 0) {
          room.targetArea += grow;
          leftover -= grow;
        }
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
