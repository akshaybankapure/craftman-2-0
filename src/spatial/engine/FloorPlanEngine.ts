import { OccupancyGrid } from "../grid/OccupancyGrid.ts";
import type {
  CertifiedPlan,
  FloorPlanBrief,
  GenerationFailure,
  GenerationResult,
  GenerationSuccess,
  ReasoningStage,
} from "../types.ts";
import { normalizeBrief } from "../solver/brief.ts";
import { buildProgrammeBudget } from "../solver/programme.ts";
import { generateTopologyVariants, validateTopology } from "../solver/topology.ts";
import { selectPlansNsga2 } from "../solver/nsga2.ts";
import { packCertifiedCandidate } from "./candidateKernel.ts";

function failure(
  code: string,
  message: string,
  failedStage: ReasoningStage,
  reasons: string[],
  attempts: number,
  suggestedChanges: string[] = [],
): GenerationFailure {
  return { success: false, code, message, failedStage, reasons, suggestedChanges, attempts };
}

function fingerprint(plan: CertifiedPlan): string {
  const c = plan.candidate;
  const order = c.spaces
    .map(s => {
      const p = s.polygon?.outer ?? [];
      const cx = p.reduce((sum, q) => sum + q.x, 0) / Math.max(1, p.length);
      const cy = p.reduce((sum, q) => sum + q.y, 0) / Math.max(1, p.length);
      return `${s.type}:${Math.round(cx / 500)}:${Math.round(cy / 500)}`;
    })
    .sort()
    .join("|");
  return `${c.topology.family}|${order}`;
}

/**
 * Standalone batch API. Generation loop is a thin wrapper over packCertifiedCandidate.
 */
export class FloorPlanEngine {
  generate(input: FloorPlanBrief): GenerationResult {
    const briefResult = normalizeBrief(input);
    if (!briefResult.passed || !briefResult.value) {
      return failure(
        "INVALID_BRIEF",
        "The floor-plan brief is invalid.",
        "BRIEF",
        briefResult.fatalErrors.map(e => e.message),
        0,
        ["Correct the envelope, area or programme inputs."],
      );
    }
    const brief = briefResult.value;
    const baseGrid = OccupancyGrid.rasterize(brief.envelope, brief.cellSizeMm);
    const budgetResult = buildProgrammeBudget(brief, baseGrid.insideCellCount());
    if (!budgetResult.passed || !budgetResult.value) {
      return failure(
        "INFEASIBLE_PROGRAMME",
        "The requested room programme cannot fit the envelope.",
        "PROGRAMME",
        budgetResult.fatalErrors.map(e => e.message),
        0,
        ["Increase carpet area, reduce rooms, or select a more compact tier."],
      );
    }
    const budget = budgetResult.value;
    const topologies = generateTopologyVariants(brief, budget);
    const accepted: CertifiedPlan[] = [];
    const rejectedReasons: string[] = [];
    let attempts = 0;
    const roomCount = budget.requirements.length;
    const baseAttempts = Math.min(480, Math.max(120, 40 * roomCount));
    const attemptsPerFamily = Math.max(
      40,
      Math.ceil(baseAttempts / Math.max(1, topologies.length)),
    );

    for (const topology of topologies) {
      const topologyResult = validateTopology(topology, budget);
      if (!topologyResult.passed) {
        rejectedReasons.push(...topologyResult.fatalErrors.map(e => e.message));
        continue;
      }
      let acceptedForFamily = 0;
      for (let localAttempt = 0; localAttempt < attemptsPerFamily; localAttempt++) {
        if (acceptedForFamily >= Math.max(2, brief.maxCandidates)) break;
        attempts++;
        const attemptSeed = brief.seed + attempts * 104729;
        const packed = packCertifiedCandidate(
          brief,
          budget,
          topology,
          baseGrid,
          attemptSeed,
          { localAttempt, attemptsPerFamily },
        );
        if (!packed.plan) {
          rejectedReasons.push(...packed.reasons);
          continue;
        }
        accepted.push(packed.plan);
        acceptedForFamily++;
      }
    }

    const unique = new Map<string, CertifiedPlan>();
    for (const plan of accepted.sort(
      (a, b) => b.candidate.quality.total - a.candidate.quality.total,
    )) {
      const key = fingerprint(plan);
      if (!unique.has(key)) unique.set(key, plan);
    }
    const plans = selectPlansNsga2([...unique.values()], brief.maxCandidates);
    if (plans.length === 0) {
      const counts = new Map<string, number>();
      for (const reason of rejectedReasons) counts.set(reason, (counts.get(reason) ?? 0) + 1);
      const common = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([reason, count]) => `${reason} (${count}×)`);
      return failure(
        "NO_VALID_CANDIDATE",
        "The engine rejected every candidate instead of rendering an invalid plan.",
        "CERTIFICATION",
        common,
        attempts,
        [
          "Try a finer grid, a larger envelope, fewer bathrooms, or another envelope proportion.",
        ],
      );
    }

    const success: GenerationSuccess = { success: true, plans, attempts };
    return success;
  }
}
