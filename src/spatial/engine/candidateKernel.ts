/**
 * Per-attempt certified packing kernel.
 * One seed → one packing try → certify or reject. No NSGA / fingerprint selection.
 */

import { extractPolygons, deriveSharedBoundaries } from "../geometry/extract.ts";
import { OccupancyGrid } from "../grid/OccupancyGrid.ts";
import type {
  AccessGraph,
  CertifiedPlan,
  FloorPlanCandidate,
  NormalizedBrief,
  ProgrammeBudget,
  SharedBoundary,
  SpaceRegion,
} from "../types.ts";
import { BATHROOM_DOOR_WIDTH_MM, DEFAULT_DOOR_WIDTH_MM, DOOR_SIDE_CLEARANCE_MM } from "../constants.ts";
import { resolvePhysicalTopology } from "../solver/physicalTopology.ts";
import { planSeeds } from "../solver/seeds.ts";
import { growRegions } from "../solver/regionGrower.ts";
import { packWithSlicingTree } from "../solver/slicingPacker.ts";
import { solveDoors } from "../solver/doors.ts";
import { validateNavigation } from "../solver/navigation.ts";
import { validateGridAndUsability } from "../verify/gridAnalysis.ts";
import { evaluateQuality } from "../solver/quality.ts";
import { IndependentPlanVerifier } from "../verify/IndependentPlanVerifier.ts";
import { FurnishingFeasibilitySolver } from "../furnishing/FurnishingFeasibilitySolver.ts";

export interface PackKernelOptions {
  /**
   * When true, use the injected topology as-is after verifying each required
   * non-exterior edge has a door-capable shared boundary. When false (default),
   * run resolvePhysicalTopology to rebuild the legal graph from geometry.
   */
  externalTopology?: boolean;
  /** Prefer region-grower after this fraction of failed slicing attempts (0–1). */
  growerFallbackAfter?: number;
  /** Attempt index within a family loop (used only for grower timing). */
  localAttempt?: number;
  /** Total attempts planned for the family (used only for grower timing). */
  attemptsPerFamily?: number;
  /** Try region-grower before slicing — diversifies geometry vs the default tree. */
  preferGrower?: boolean;
}

export interface PackKernelResult {
  plan?: CertifiedPlan;
  reasons: string[];
}

const verifier = new IndependentPlanVerifier();
const furnishingSolver = new FurnishingFeasibilitySolver();

function doorCapableLength(boundaries: SharedBoundary[], a: string, b: string, widthMm: number): boolean {
  const boundary = boundaries.find(
    s => (s.roomAId === a && s.roomBId === b) || (s.roomAId === b && s.roomBId === a),
  );
  if (!boundary) return false;
  const needed = widthMm + 2 * DOOR_SIDE_CLEARANCE_MM;
  return boundary.segments.some(s => s.end - s.start >= needed);
}

/**
 * Verify an injected AccessGraph against packed geometry: every required
 * room↔room edge must have a door-capable shared boundary.
 */
export function realiseExternalTopology(
  topology: AccessGraph,
  spaces: SpaceRegion[],
  boundaries: SharedBoundary[],
): { ok: true; topology: AccessGraph } | { ok: false; reasons: string[] } {
  const byId = new Map(spaces.map(s => [s.id, s]));
  const reasons: string[] = [];

  for (const e of topology.edges) {
    if (e.from === "EXTERIOR" || e.to === "EXTERIOR") continue;
    const fromNode = topology.nodes.find(n => n.id === e.from);
    const toNode = topology.nodes.find(n => n.id === e.to);
    const a = fromNode?.roomId;
    const b = toNode?.roomId;
    if (!a || !b) {
      reasons.push(`Topology edge ${e.id} missing room ids.`);
      continue;
    }
    const spaceA = byId.get(a);
    const spaceB = byId.get(b);
    if (!spaceA || !spaceB) {
      reasons.push(`Topology edge ${e.id} references missing space ${a}/${b}.`);
      continue;
    }
    const width = [spaceA.type, spaceB.type].some(t => t === "BATHROOM" || t === "ENSUITE")
      ? BATHROOM_DOOR_WIDTH_MM
      : DEFAULT_DOOR_WIDTH_MM;
    if (!doorCapableLength(boundaries, a, b, width)) {
      reasons.push(`Required edge ${a}↔${b} has no door-capable shared boundary.`);
    }
  }

  if (reasons.length > 0) return { ok: false, reasons };
  return { ok: true, topology };
}

/**
 * One packing attempt: slice/grow → polygons → walls → doors → furnish → nav → certify.
 */
export function packCertifiedCandidate(
  brief: NormalizedBrief,
  budget: ProgrammeBudget,
  topology: AccessGraph,
  baseGrid: OccupancyGrid,
  seed: number,
  options: PackKernelOptions = {},
): PackKernelResult {
  const reasons: string[] = [];
  const external = options.externalTopology === true;
  const localAttempt = options.localAttempt ?? 0;
  const attemptsPerFamily = options.attemptsPerFamily ?? 10;
  const growerAfter = options.growerFallbackAfter ?? 0.7;
  const preferGrower = options.preferGrower === true;

  let growth: ReturnType<typeof packWithSlicingTree> | undefined;
  if (preferGrower) {
    const seeds = planSeeds(brief, budget, baseGrid, topology.family, seed);
    growth = seeds
      ? growRegions(brief, budget, topology, baseGrid, seeds, seed + 17)
      : undefined;
  }
  if (!growth) {
    growth = packWithSlicingTree(brief, budget, topology, baseGrid, seed);
  }
  if (!growth && localAttempt >= Math.floor(attemptsPerFamily * growerAfter)) {
    const seeds = planSeeds(brief, budget, baseGrid, topology.family, seed);
    growth = seeds
      ? growRegions(brief, budget, topology, baseGrid, seeds, seed + 17)
      : undefined;
  }
  // Always try region grower once when external topology and slicing failed.
  if (!growth && external) {
    const seeds = planSeeds(brief, budget, baseGrid, topology.family, seed ^ 0xA5A5);
    growth = seeds
      ? growRegions(brief, budget, topology, baseGrid, seeds, seed + 31)
      : undefined;
  }
  if (!growth) {
    return { reasons: ["Spatial packing failed to assign the entire envelope."] };
  }

  const polygons = extractPolygons(growth.grid, growth.spaces);
  for (const space of growth.spaces) {
    const loops = polygons.get(space.id) ?? [];
    if (loops.length !== 1) {
      return { reasons: [`${space.id} extracted into ${loops.length} loops.`] };
    }
    space.polygon = loops[0]!;
  }

  const gridValidation = validateGridAndUsability(brief, growth.grid, growth.spaces);
  if (!gridValidation.passed || !gridValidation.value) {
    return { reasons: gridValidation.fatalErrors.map(e => e.message) };
  }

  const boundaries = deriveSharedBoundaries(growth.grid, growth.spaces);

  let resolvedTopology: AccessGraph;
  if (external) {
    const realised = realiseExternalTopology(topology, growth.spaces, boundaries);
    if (!realised.ok) return { reasons: realised.reasons };
    resolvedTopology = realised.topology;
  } else {
    const physicalTopology = resolvePhysicalTopology(
      topology.family,
      growth.spaces,
      boundaries,
      growth.grid,
      brief.entranceEdge,
    );
    if (!physicalTopology.passed || !physicalTopology.value) {
      return { reasons: physicalTopology.fatalErrors.map(e => e.message) };
    }
    resolvedTopology = physicalTopology.value;
  }

  const doorResult = solveDoors(
    resolvedTopology,
    growth.spaces,
    boundaries,
    growth.grid,
    brief.entranceEdge,
  );
  if (!doorResult.passed || !doorResult.value) {
    return { reasons: doorResult.fatalErrors.map(e => e.message) };
  }

  const furnishingResult = furnishingSolver.solve(
    brief,
    growth.grid,
    growth.spaces,
    doorResult.value,
  );
  if (!furnishingResult.passed || !furnishingResult.value) {
    return { reasons: furnishingResult.fatalErrors.map(e => e.message) };
  }

  const navigationResult = validateNavigation(
    growth.grid,
    growth.spaces,
    doorResult.value,
    furnishingResult.value.blockedCells,
  );
  if (!navigationResult.passed || !navigationResult.value) {
    return { reasons: navigationResult.fatalErrors.map(e => e.message) };
  }

  const usability = gridValidation.value.map(metric => {
    const room = furnishingResult.value!.rooms.find(r => r.roomId === metric.roomId);
    return room
      ? {
          ...metric,
          furnitureTemplatePassed: true,
          connectedWalkableAreaSqM: room.connectedWalkableAreaSqM,
          shapeComplexityScore: room.shape.complexityScore,
          polygonVertexCount: room.shape.vertexCount,
          reflexCornerCount: room.shape.reflexCornerCount,
          notes: [...metric.notes, ...room.notes],
        }
      : metric;
  });
  const quality = evaluateQuality(growth.grid, growth.spaces, doorResult.value, usability);
  const candidate: FloorPlanCandidate = {
    id: `plan_${topology.family.toLowerCase()}_${seed}`,
    brief,
    topology: resolvedTopology,
    grid: growth.grid.toData(),
    spaces: growth.spaces,
    sharedBoundaries: boundaries,
    doors: doorResult.value,
    navigationPaths: navigationResult.value,
    usability,
    furnishing: furnishingResult.value,
    quality,
    diagnostics: {
      attempts: 1,
      topologyFamily: topology.family,
      rejectedReasons: [],
      notes: [...budget.diagnostics],
    },
  };

  const verified = verifier.verify(candidate);
  if (!verified.passed || !verified.value) {
    return { reasons: verified.fatalErrors.map(e => e.message) };
  }

  return {
    plan: { candidate, certificate: verified.value },
    reasons: [],
  };
}
