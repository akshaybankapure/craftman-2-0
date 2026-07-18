import type { MarketTier, RoomRequirement, RoomType } from "../types.ts";

interface StandardSpec {
  minAreaSqM: number;
  targetAreaSqM: number;
  maxAreaSqM: number;
  minWidthMm: number;
  /** Absolute long-side cap — ratio alone cannot stop a huge living room. */
  maxSideMm: number;
  preferredAspectRatio: number;
  hardMaxAspectRatio: number;
  exteriorAccess: RoomRequirement["exteriorAccess"];
  circulationAllowed: boolean;
  expansionWeight: number;
}

const BASE: Record<RoomType, StandardSpec> = {
  LIVING: {
    minAreaSqM: 12,
    targetAreaSqM: 18,
    maxAreaSqM: 28,
    minWidthMm: 3000,
    maxSideMm: 7500,
    preferredAspectRatio: 1.6,
    hardMaxAspectRatio: 2.2,
    exteriorAccess: "REQUIRED",
    circulationAllowed: true,
    expansionWeight: 1.8
  },
  BEDROOM: {
    minAreaSqM: 9.3,
    targetAreaSqM: 12.5,
    maxAreaSqM: 17,
    minWidthMm: 2700,
    maxSideMm: 6000,
    preferredAspectRatio: 1.4,
    hardMaxAspectRatio: 2.0,
    exteriorAccess: "REQUIRED",
    circulationAllowed: false,
    expansionWeight: 1.2
  },
  KITCHEN: {
    minAreaSqM: 5.5,
    targetAreaSqM: 8,
    maxAreaSqM: 12,
    minWidthMm: 2100,
    maxSideMm: 5500,
    preferredAspectRatio: 2,
    hardMaxAspectRatio: 2.8,
    exteriorAccess: "PREFERRED",
    circulationAllowed: false,
    expansionWeight: 0.9
  },
  BATHROOM: {
    minAreaSqM: 2.8,
    targetAreaSqM: 3.8,
    maxAreaSqM: 5.5,
    minWidthMm: 1500,
    maxSideMm: 4500,
    preferredAspectRatio: 1.7,
    hardMaxAspectRatio: 2.8,
    exteriorAccess: "OPTIONAL",
    circulationAllowed: false,
    expansionWeight: 0.25
  },
  ENSUITE: {
    minAreaSqM: 2.8,
    targetAreaSqM: 3.8,
    maxAreaSqM: 5.5,
    minWidthMm: 1500,
    maxSideMm: 4500,
    preferredAspectRatio: 1.7,
    hardMaxAspectRatio: 3.2,
    exteriorAccess: "OPTIONAL",
    circulationAllowed: false,
    expansionWeight: 0.25
  },
  FOYER: {
    minAreaSqM: 1.4,
    targetAreaSqM: 2.5,
    maxAreaSqM: 4.5,
    minWidthMm: 1200,
    maxSideMm: 3500,
    preferredAspectRatio: 1.8,
    hardMaxAspectRatio: 2.5,
    exteriorAccess: "NOT_REQUIRED",
    circulationAllowed: true,
    expansionWeight: 0.15
  },
  PRIVATE_LOBBY: {
    minAreaSqM: 1.5,
    targetAreaSqM: 2.6,
    maxAreaSqM: 4.8,
    minWidthMm: 1000,
    maxSideMm: 6000,
    preferredAspectRatio: 2.5,
    hardMaxAspectRatio: 5,
    exteriorAccess: "NOT_REQUIRED",
    circulationAllowed: true,
    expansionWeight: 0.1
  },
  CORRIDOR: {
    minAreaSqM: 1.5,
    targetAreaSqM: 3,
    maxAreaSqM: 7,
    minWidthMm: 1000,
    maxSideMm: 20000,
    preferredAspectRatio: 4,
    hardMaxAspectRatio: 12,
    exteriorAccess: "NOT_REQUIRED",
    circulationAllowed: true,
    expansionWeight: 0.05
  },
  DINING: {
    minAreaSqM: 5,
    targetAreaSqM: 7.5,
    maxAreaSqM: 12,
    minWidthMm: 2400,
    maxSideMm: 6000,
    preferredAspectRatio: 1.7,
    hardMaxAspectRatio: 2.2,
    exteriorAccess: "PREFERRED",
    circulationAllowed: true,
    expansionWeight: 1
  },
  STUDY: {
    minAreaSqM: 4.5,
    targetAreaSqM: 6.5,
    maxAreaSqM: 10,
    minWidthMm: 2100,
    maxSideMm: 5000,
    preferredAspectRatio: 1.6,
    hardMaxAspectRatio: 2.2,
    exteriorAccess: "PREFERRED",
    circulationAllowed: false,
    expansionWeight: 0.8
  },
  UTILITY: {
    minAreaSqM: 2,
    targetAreaSqM: 3.2,
    maxAreaSqM: 5,
    minWidthMm: 1200,
    maxSideMm: 4500,
    preferredAspectRatio: 2.2,
    hardMaxAspectRatio: 3.0,
    exteriorAccess: "PREFERRED",
    circulationAllowed: false,
    expansionWeight: 0.35
  },
  STORAGE: {
    minAreaSqM: 1.2,
    targetAreaSqM: 2,
    maxAreaSqM: 4,
    minWidthMm: 1000,
    maxSideMm: 4000,
    preferredAspectRatio: 2,
    hardMaxAspectRatio: 3,
    exteriorAccess: "NOT_REQUIRED",
    circulationAllowed: false,
    expansionWeight: 0.2
  },
  FAMILY_LOUNGE: {
    minAreaSqM: 8,
    targetAreaSqM: 12,
    maxAreaSqM: 20,
    minWidthMm: 2800,
    maxSideMm: 6500,
    preferredAspectRatio: 1.6,
    hardMaxAspectRatio: 2.0,
    exteriorAccess: "PREFERRED",
    circulationAllowed: true,
    expansionWeight: 1.2
  }
};

const TIER_SCALE: Record<MarketTier, { min: number; target: number; max: number; width: number }> = {
  COMPACT: { min: 0.92, target: 0.9, max: 0.92, width: 0.95 },
  STANDARD: { min: 1, target: 1, max: 1, width: 1 },
  PREMIUM: { min: 1.05, target: 1.18, max: 1.3, width: 1.05 }
};

export type StandardOverrideMap = Partial<
  Record<RoomType, Partial<Omit<RoomRequirement, 'id' | 'type'>>>
>;

export function makeRequirement(
  id: string,
  type: RoomType,
  tier: MarketTier,
  overrides?: StandardOverrideMap
): RoomRequirement {
  const base = BASE[type];
  const scale = TIER_SCALE[tier];
  const over = overrides?.[type];
  return {
    id,
    type,
    minAreaSqM: over?.minAreaSqM ?? base.minAreaSqM * scale.min,
    targetAreaSqM: over?.targetAreaSqM ?? base.targetAreaSqM * scale.target,
    maxAreaSqM: over?.maxAreaSqM ?? base.maxAreaSqM * scale.max,
    minWidthMm: over?.minWidthMm ?? Math.round((base.minWidthMm * scale.width) / 50) * 50,
    maxSideMm: over?.maxSideMm ?? base.maxSideMm,
    preferredAspectRatio: over?.preferredAspectRatio ?? base.preferredAspectRatio,
    hardMaxAspectRatio: over?.hardMaxAspectRatio ?? base.hardMaxAspectRatio,
    exteriorAccess: over?.exteriorAccess ?? base.exteriorAccess,
    circulationAllowed: over?.circulationAllowed ?? base.circulationAllowed,
    expansionWeight: over?.expansionWeight ?? base.expansionWeight
  };
}
