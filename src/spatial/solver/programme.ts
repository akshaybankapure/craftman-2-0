import { cellAreaSqM } from "../units.ts";
import type {
  NormalizedBrief,
  ProgrammeBudget,
  ReasoningIssue,
  ReasoningResult,
  RoomRequirement,
  RoomType
} from "../types.ts";
import { makeRequirement } from "./standards.ts";

function issue(code: string, message: string, evidence?: Record<string, unknown>): ReasoningIssue {
  const base: ReasoningIssue = { code, stage: "PROGRAMME", message, affectedIds: [] };
  return evidence === undefined ? base : { ...base, evidence };
}

function countExisting(requirements: RoomRequirement[], type: RoomType): number {
  return requirements.filter((r) => r.type === type).length;
}

function add(
  requirements: RoomRequirement[],
  type: RoomType,
  count: number,
  tier: NormalizedBrief["marketTier"],
  overrides?: NormalizedBrief["standardOverrides"]
): void {
  const start = countExisting(requirements, type) + 1;
  for (let i = 0; i < count; i++) {
    requirements.push(makeRequirement(`${type.toLowerCase()}_${start + i}`, type, tier, overrides));
  }
}

function optionalAbsorbers(brief: NormalizedBrief): RoomType[] {
  const requested = brief.optionalSpaces.flatMap((s) => Array.from({ length: s.count ?? 1 }, () => s.type));
  const defaults: RoomType[] = [];
  if (brief.bhk >= 2) defaults.push("DINING");
  if (brief.bhk >= 3 || brief.marketTier === "PREMIUM") defaults.push("STUDY");
  defaults.push("UTILITY", "STORAGE");
  if (brief.bhk >= 4 || brief.marketTier === "PREMIUM") defaults.push("FAMILY_LOUNGE");
  return [...requested, ...defaults];
}

export function buildProgrammeBudget(
  brief: NormalizedBrief,
  envelopeCellCount: number
): ReasoningResult<ProgrammeBudget> {
  const fatalErrors: ReasoningIssue[] = [];
  const warnings: ReasoningIssue[] = [];
  const diagnostics: string[] = [];
  const tier = brief.marketTier;
  const overrides = brief.standardOverrides;
  const requirements: RoomRequirement[] = [];

  if (brief.requirements && brief.requirements.length > 0) {
    requirements.push(...brief.requirements.map((r) => ({ ...r })));
    diagnostics.push("Using externally injected programme requirements.");
  } else {
    add(requirements, "LIVING", 1, tier, overrides);
    add(requirements, "KITCHEN", 1, tier, overrides);
    add(requirements, "BEDROOM", brief.bhk, tier, overrides);

    const ensuiteCount = Math.min(brief.bathroomCount, Math.max(1, Math.floor(brief.bhk / 2)));
    const commonCount = brief.bathroomCount - ensuiteCount;
    add(requirements, "ENSUITE", ensuiteCount, tier, overrides);
    add(requirements, "BATHROOM", commonCount, tier, overrides);

    const envelopeAreaSqMEarly = envelopeCellCount * cellAreaSqM(brief.cellSizeMm);
    const addFoyer = brief.marketTier === "PREMIUM" || envelopeAreaSqMEarly >= 105;
    if (addFoyer) add(requirements, "FOYER", 1, tier, overrides);
    // Lobby is optional for compact 1BHK; 2BHK+ still gets a short private lobby
    // when common baths need privacy (not a full corridor spine).
    if (commonCount > 0 && brief.bhk >= 2) {
      add(requirements, "PRIVATE_LOBBY", 1, tier, overrides);
    }
  }

  const envelopeAreaSqM = envelopeCellCount * cellAreaSqM(brief.cellSizeMm);
  const cellArea = cellAreaSqM(brief.cellSizeMm);
  const minCells: Record<string, number> = {};
  const targetCells: Record<string, number> = {};
  const maxCells: Record<string, number> = {};

  const calculate = (req: RoomRequirement): void => {
    minCells[req.id] = Math.max(1, Math.ceil(req.minAreaSqM / cellArea));
    targetCells[req.id] = Math.max(minCells[req.id]!, Math.round(req.targetAreaSqM / cellArea));
    maxCells[req.id] = Math.max(targetCells[req.id]!, Math.floor(req.maxAreaSqM / cellArea));
  };
  requirements.forEach(calculate);

  let minimumTotal = requirements.reduce((sum, r) => sum + minCells[r.id]!, 0);
  if (minimumTotal > envelopeCellCount) {
    fatalErrors.push(issue("PROGRAMME_INFEASIBLE_MIN_AREA", "The minimum programme cannot fit inside the envelope.", {
      minimumCells: minimumTotal,
      envelopeCellCount,
      minimumAreaSqM: minimumTotal * cellArea,
      envelopeAreaSqM
    }));
    return {
      passed: false,
      fatalErrors,
      repairableErrors: [],
      warnings,
      metrics: { minimumCells: minimumTotal, envelopeCellCount }
    };
  }

  let targetTotal = requirements.reduce((sum, r) => sum + targetCells[r.id]!, 0);

  if (targetTotal > envelopeCellCount) {
    let deficit = targetTotal - envelopeCellCount;
    const shrinkable = [...requirements].sort((a, b) => b.expansionWeight - a.expansionWeight);
    while (deficit > 0) {
      let changed = false;
      for (const req of shrinkable) {
        if (targetCells[req.id]! > minCells[req.id]!) {
          targetCells[req.id]!--;
          deficit--;
          changed = true;
          if (deficit === 0) break;
        }
      }
      if (!changed) break;
    }
    diagnostics.push("Target areas were compressed toward minimums to fit the envelope.");
  }

  targetTotal = requirements.reduce((sum, r) => sum + targetCells[r.id]!, 0);
  let extra = envelopeCellCount - targetTotal;

  // First enlarge the required programme up to useful maxima. Optional rooms are
  // introduced only when the core programme can no longer absorb space sensibly.
  const expandRooms = (rooms: RoomRequirement[]): void => {
    const ordered = [...rooms].sort((a, b) => b.expansionWeight - a.expansionWeight);
    while (extra > 0) {
      let changed = false;
      for (const req of ordered) {
        if (targetCells[req.id]! < maxCells[req.id]!) {
          targetCells[req.id] = targetCells[req.id]! + 1;
          extra--;
          changed = true;
          if (extra === 0) break;
        }
      }
      if (!changed) break;
    }
  };

  expandRooms(requirements);

  for (const type of optionalAbsorbers(brief)) {
    if (extra <= 0) break;
    const req = makeRequirement(
      `${type.toLowerCase()}_${countExisting(requirements, type) + 1}`,
      type,
      tier,
      overrides
    );
    const min = Math.ceil(req.minAreaSqM / cellArea);
    if (extra >= min) {
      requirements.push(req);
      calculate(req);
      targetCells[req.id] = minCells[req.id]!;
      extra -= targetCells[req.id]!;
      diagnostics.push(`Added ${type} after the core programme reached useful maxima.`);
      expandRooms([req]);
    }
  }

  expandRooms(requirements);

  if (extra > 0) {
    warnings.push(issue("PROGRAMME_UNDERUTILISED_AREA", "The selected programme has more area than its useful room maxima. A flexible family lounge was added.", {
      extraCells: extra,
      extraAreaSqM: extra * cellArea
    }));
    const flex = makeRequirement(
      `family_lounge_${countExisting(requirements, "FAMILY_LOUNGE") + 1}`,
      "FAMILY_LOUNGE",
      tier,
      overrides
    );
    flex.minAreaSqM = extra * cellArea;
    flex.targetAreaSqM = extra * cellArea;
    flex.maxAreaSqM = Math.max(flex.maxAreaSqM, extra * cellArea);
    requirements.push(flex);
    minCells[flex.id] = extra;
    targetCells[flex.id] = extra;
    maxCells[flex.id] = extra;
    extra = 0;
  }

  const finalTotal = requirements.reduce((sum, r) => sum + targetCells[r.id]!, 0);
  if (finalTotal !== envelopeCellCount) {
    fatalErrors.push(issue("PROGRAMME_CELL_BALANCE", "Programme target cells do not conserve envelope area.", {
      finalTotal,
      envelopeCellCount
    }));
  }

  minimumTotal = requirements.reduce((sum, r) => sum + minCells[r.id]!, 0);
  const budget: ProgrammeBudget = {
    requirements,
    targetCellsByRoomId: targetCells,
    minCellsByRoomId: minCells,
    maxCellsByRoomId: maxCells,
    envelopeCellCount,
    wallAllowanceRatio: 0,
    diagnostics
  };

  return {
    passed: fatalErrors.length === 0,
    ...(fatalErrors.length === 0 ? { value: budget } : {}),
    fatalErrors,
    repairableErrors: [],
    warnings,
    metrics: {
      envelopeCellCount,
      minimumTotal,
      targetTotal: finalTotal,
      roomCount: requirements.length
    }
  };
}
