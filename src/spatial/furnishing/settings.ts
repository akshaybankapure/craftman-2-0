import type {
  BathroomFurnishingSettings,
  BedroomFurnishingSettings,
  FurnishingSettings,
  KitchenFurnishingSettings,
  LivingFurnishingSettings,
  MarketTier,
  ResolvedFurnishingSettings
} from "../types.ts";

const PROFILE_BY_TIER: Record<MarketTier, ResolvedFurnishingSettings["clearanceProfile"]> = {
  COMPACT: "COMPACT",
  STANDARD: "STANDARD",
  PREMIUM: "PREMIUM"
};

const WALKWAY_MM: Record<ResolvedFurnishingSettings["clearanceProfile"], number> = {
  ULTRA_COMPACT: 450,
  COMPACT: 500,
  STANDARD: 600,
  PREMIUM: 750,
  ACCESSIBLE: 900
};

function bedroomDefaults(profile: ResolvedFurnishingSettings["clearanceProfile"]): Required<BedroomFurnishingSettings> {
  if (profile === "ULTRA_COMPACT") return { bedType: "DOUBLE", wardrobeLengthMm: 1200, wardrobeType: "SLIDING", requireDesk: false, requireDressing: false, requireSeating: false };
  if (profile === "COMPACT") return { bedType: "DOUBLE", wardrobeLengthMm: 1500, wardrobeType: "SLIDING", requireDesk: false, requireDressing: false, requireSeating: false };
  if (profile === "PREMIUM") return { bedType: "KING", wardrobeLengthMm: 2400, wardrobeType: "HINGED", requireDesk: false, requireDressing: false, requireSeating: true };
  if (profile === "ACCESSIBLE") return { bedType: "QUEEN", wardrobeLengthMm: 1800, wardrobeType: "SLIDING", requireDesk: false, requireDressing: false, requireSeating: false };
  return { bedType: "QUEEN", wardrobeLengthMm: 1800, wardrobeType: "HINGED", requireDesk: false, requireDressing: false, requireSeating: false };
}

function livingDefaults(profile: ResolvedFurnishingSettings["clearanceProfile"]): Required<LivingFurnishingSettings> {
  return {
    seatingCapacity: profile === "PREMIUM" ? 5 : profile === "ULTRA_COMPACT" ? 2 : 3,
    requireTvUnit: true,
    requireDining: false,
    diningSeats: profile === "PREMIUM" ? 6 : 4
  };
}

function kitchenDefaults(profile: ResolvedFurnishingSettings["clearanceProfile"]): Required<KitchenFurnishingSettings> {
  return {
    layout: "AUTO",
    minimumCounterLengthMm: profile === "PREMIUM" ? 3000 : profile === "ULTRA_COMPACT" ? 1800 : profile === "COMPACT" ? 1950 : 2100,
    requireDishwasher: false,
    requireBreakfastCounter: false
  };
}

function bathroomDefaults(profile: ResolvedFurnishingSettings["clearanceProfile"]): Required<BathroomFurnishingSettings> {
  return {
    requireShower: true,
    requireBathtub: false,
    requireJacuzzi: false,
    requireDoubleBasin: false,
    accessible: profile === "ACCESSIBLE"
  };
}

export function resolveFurnishingSettings(tier: MarketTier, input: FurnishingSettings | undefined): ResolvedFurnishingSettings {
  const clearanceProfile = input?.clearanceProfile ?? PROFILE_BY_TIER[tier];
  return {
    clearanceProfile,
    minimumWalkwayMm: WALKWAY_MM[clearanceProfile],
    bedroom: { ...bedroomDefaults(clearanceProfile), ...(input?.bedroom ?? {}) },
    living: { ...livingDefaults(clearanceProfile), ...(input?.living ?? {}) },
    kitchen: { ...kitchenDefaults(clearanceProfile), ...(input?.kitchen ?? {}) },
    bathroom: { ...bathroomDefaults(clearanceProfile), ...(input?.bathroom ?? {}) },
    roomOverrides: { ...(input?.roomOverrides ?? {}) }
  };
}
