import { DEFAULT_CELL_SIZE_MM } from "../constants.ts";
import { isOrthogonalPolygon, isSimplePolygon, polygonArea, rectanglePolygon } from "../geometry/polygon.ts";
import type { FloorPlanBrief, NormalizedBrief, ReasoningIssue, ReasoningResult } from "../types.ts";
import { resolveFurnishingSettings } from "../furnishing/settings.ts";

function issue(code: string, message: string, evidence?: Record<string, unknown>): ReasoningIssue {
  const base: ReasoningIssue = { code, stage: "BRIEF", message, affectedIds: [] };
  return evidence === undefined ? base : { ...base, evidence };
}

export function normalizeBrief(input: FloorPlanBrief): ReasoningResult<NormalizedBrief> {
  const fatalErrors: ReasoningIssue[] = [];
  const warnings: ReasoningIssue[] = [];

  if (input.bathroomCount < 1 || input.bathroomCount > input.bhk + 2) {
    fatalErrors.push(issue("BRIEF_BATHROOM_COUNT", "Bathroom count is not sensible for the selected BHK.", {
      bathroomCount: input.bathroomCount,
      bhk: input.bhk
    }));
  }

  let envelope = input.envelope;
  let dimensions = input.dimensions;

  if (!envelope && dimensions) envelope = rectanglePolygon(dimensions.widthMm, dimensions.heightMm);
  if (!envelope && input.carpetAreaSqM) {
    const ratio = 1.3;
    const widthM = Math.sqrt(input.carpetAreaSqM * ratio);
    const heightM = input.carpetAreaSqM / widthM;
    dimensions = { widthMm: Math.round(widthM * 1000), heightMm: Math.round(heightM * 1000) };
    envelope = rectanglePolygon(dimensions.widthMm, dimensions.heightMm);
    warnings.push(issue("BRIEF_ENVELOPE_DERIVED", "Envelope dimensions were derived from carpet area.", { widthMm: dimensions.widthMm, heightMm: dimensions.heightMm }));
  }

  if (!envelope) fatalErrors.push(issue("BRIEF_ENVELOPE_MISSING", "An envelope or dimensions are required."));

  if (envelope && (!isSimplePolygon(envelope) || !isOrthogonalPolygon(envelope))) {
    fatalErrors.push(issue("BRIEF_ENVELOPE_INVALID", "The initial engine supports simple orthogonal envelopes only."));
  }

  const envelopeAreaSqM = envelope ? polygonArea(envelope) / 1_000_000 : 0;
  const carpetAreaSqM = input.carpetAreaSqM ?? envelopeAreaSqM;
  if (!(carpetAreaSqM > 0)) fatalErrors.push(issue("BRIEF_AREA_INVALID", "Carpet area must be positive."));

  if (envelope && !dimensions) {
    const xs = envelope.outer.map((p) => p.x);
    const ys = envelope.outer.map((p) => p.y);
    dimensions = {
      widthMm: Math.max(...xs) - Math.min(...xs),
      heightMm: Math.max(...ys) - Math.min(...ys)
    };
  }

  if (envelope && Math.abs(envelopeAreaSqM - carpetAreaSqM) / Math.max(carpetAreaSqM, 1) > 0.08) {
    warnings.push(issue("BRIEF_AREA_ENVELOPE_MISMATCH", "Envelope area and requested carpet area differ by more than 8%; envelope controls geometry.", {
      envelopeAreaSqM,
      requestedCarpetAreaSqM: carpetAreaSqM
    }));
  }

  if (fatalErrors.length > 0 || !envelope || !dimensions) {
    return { passed: false, fatalErrors, repairableErrors: [], warnings, metrics: { envelopeAreaSqM } };
  }

  const value: NormalizedBrief = {
    carpetAreaSqM,
    envelope,
    dimensions,
    entranceEdge: input.entranceEdge,
    buildingType: input.buildingType,
    bhk: input.bhk,
    bathroomCount: input.bathroomCount,
    marketTier: input.marketTier,
    optionalSpaces: input.optionalSpaces ?? [],
    seed: input.seed ?? 1,
    cellSizeMm: input.cellSizeMm ?? DEFAULT_CELL_SIZE_MM,
    maxCandidates: input.maxCandidates ?? 4,
    furnishing: resolveFurnishingSettings(input.marketTier, input.furnishing),
    ...(input.requirements && input.requirements.length > 0
      ? { requirements: input.requirements }
      : {}),
    ...(input.standardOverrides ? { standardOverrides: input.standardOverrides } : {})
  };

  return {
    passed: true,
    value,
    fatalErrors: [],
    repairableErrors: [],
    warnings,
    metrics: { envelopeAreaSqM, carpetAreaSqM, cellSizeMm: value.cellSizeMm }
  };
}
