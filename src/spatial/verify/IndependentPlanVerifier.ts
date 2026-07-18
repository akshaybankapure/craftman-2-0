import { isOrthogonalPolygon, isSimplePolygon, polygonArea } from "../geometry/polygon.ts";
import { deriveSharedBoundaries, extractPolygons } from "../geometry/extract.ts";
import { OccupancyGrid, UNASSIGNED_LABEL } from "../grid/OccupancyGrid.ts";
import type {
  FloorPlanCandidate,
  MathematicalPlanCertificate,
  ReasoningIssue,
  ReasoningResult,
  SharedBoundary
} from "../types.ts";
import { componentCount, validateGridAndUsability } from "./gridAnalysis.ts";
import { stableHash } from "./hash.ts";
import { FurnishingFeasibilitySolver, furnishingContentHash } from "../furnishing/FurnishingFeasibilitySolver.ts";
import { validateNavigation } from "../solver/navigation.ts";

function issue(code: string, stage: ReasoningIssue["stage"], message: string, affectedIds: string[] = [], evidence?: Record<string, unknown>): ReasoningIssue {
  const base: ReasoningIssue = { code, stage, message, affectedIds };
  return evidence === undefined ? base : { ...base, evidence };
}

function matrix(size: number): number[][] {
  return Array.from({ length: size }, () => Array<number>(size).fill(0));
}

function boundaryMatrix(boundaries: SharedBoundary[], candidate: FloorPlanCandidate): number[][] {
  const result = matrix(candidate.spaces.length);
  const index = new Map(candidate.spaces.map((s, i) => [s.id, i]));
  for (const boundary of boundaries) {
    const a = index.get(boundary.roomAId)!;
    const b = index.get(boundary.roomBId)!;
    result[a]![b] = boundary.totalLengthMm;
    result[b]![a] = boundary.totalLengthMm;
  }
  return result;
}

function doorMatrix(candidate: FloorPlanCandidate): number[][] {
  const result = matrix(candidate.spaces.length);
  const index = new Map(candidate.spaces.map((s, i) => [s.id, i]));
  for (const door of candidate.doors) {
    if (door.exterior || !door.roomBId) continue;
    const a = index.get(door.roomAId)!;
    const b = index.get(door.roomBId)!;
    result[a]![b] = 1;
    result[b]![a] = 1;
  }
  return result;
}

function navMatrix(candidate: FloorPlanCandidate): number[][] {
  const result = matrix(candidate.spaces.length);
  const index = new Map(candidate.spaces.map((s, i) => [s.id, i]));
  for (const path of candidate.navigationPaths) {
    const a = index.get(path.fromRoomId);
    const b = index.get(path.toRoomId);
    if (a !== undefined && b !== undefined) {
      result[a]![b] = 1;
      result[b]![a] = 1;
    }
  }
  return result;
}

export class IndependentPlanVerifier {
  private readonly furnishingSolver = new FurnishingFeasibilitySolver();

  verify(candidate: FloorPlanCandidate): ReasoningResult<MathematicalPlanCertificate> {
    const fatalErrors: ReasoningIssue[] = [];
    const grid = new OccupancyGrid(candidate.grid);
    const usability = validateGridAndUsability(candidate.brief, grid, candidate.spaces);
    fatalErrors.push(...usability.fatalErrors);

    const extracted = extractPolygons(grid, candidate.spaces);
    const polygonHashParts: Array<string | number> = [];
    for (const space of candidate.spaces) {
      const loops = extracted.get(space.id) ?? [];
      if (loops.length !== 1) {
        fatalErrors.push(issue("VERIFY_POLYGON_COMPONENTS", "GEOMETRY", `${space.id} extracted to ${loops.length} polygon loops.`, [space.id]));
        continue;
      }
      const polygon = loops[0]!;
      if (!isSimplePolygon(polygon) || !isOrthogonalPolygon(polygon)) fatalErrors.push(issue("VERIFY_POLYGON_INVALID", "GEOMETRY", `${space.id} has an invalid polygon.`, [space.id]));
      const expectedArea = space.cellCount * grid.cellSizeMm * grid.cellSizeMm;
      const actualArea = polygonArea(polygon);
      if (Math.abs(expectedArea - actualArea) > 1e-6) fatalErrors.push(issue("VERIFY_POLYGON_AREA_MISMATCH", "GEOMETRY", `${space.id} polygon area differs from grid area.`, [space.id], { expectedArea, actualArea }));
      polygonHashParts.push(space.id, ...polygon.outer.flatMap((p) => [p.x, p.y]));
    }

    const recomputedBoundaries = deriveSharedBoundaries(grid, candidate.spaces);
    const boundaryKey = (s: SharedBoundary): string => `${[s.roomAId, s.roomBId].sort().join(":")}:${s.totalLengthMm}`;
    const expectedBoundaryKeys = [...candidate.sharedBoundaries].map(boundaryKey).sort();
    const actualBoundaryKeys = [...recomputedBoundaries].map(boundaryKey).sort();
    if (expectedBoundaryKeys.join("|") !== actualBoundaryKeys.join("|")) fatalErrors.push(issue("VERIFY_SHARED_WALL_MISMATCH", "WALLS", "Stored shared walls differ from walls recomputed from the grid."));

    const boundaryLookup = new Map(recomputedBoundaries.map((b) => [[b.roomAId, b.roomBId].sort().join(":"), b]));
    for (const door of candidate.doors) {
      if (door.exterior) continue;
      if (!door.roomBId) {
        fatalErrors.push(issue("VERIFY_DOOR_MISSING_ROOM", "DOORS", `${door.id} has no second room.`, [door.id]));
        continue;
      }
      const boundary = boundaryLookup.get([door.roomAId, door.roomBId].sort().join(":"));
      if (!boundary) fatalErrors.push(issue("VERIFY_DOOR_NO_WALL", "DOORS", `${door.id} does not lie between rooms with a shared wall.`, [door.id]));
      if (door.cellB === undefined) fatalErrors.push(issue("VERIFY_DOOR_NO_CELL_PAIR", "DOORS", `${door.id} has no cell crossing pair.`, [door.id]));
    }

    const topologyRoomEdges = candidate.topology.edges.filter((e) => {
      const a = candidate.topology.nodes.find((n) => n.id === e.from)?.roomId;
      const b = candidate.topology.nodes.find((n) => n.id === e.to)?.roomId;
      return a && b;
    });
    for (const e of topologyRoomEdges) {
      const a = candidate.topology.nodes.find((n) => n.id === e.from)!.roomId!;
      const b = candidate.topology.nodes.find((n) => n.id === e.to)!.roomId!;
      const exists = candidate.doors.some((d) => !d.exterior && ((d.roomAId === a && d.roomBId === b) || (d.roomAId === b && d.roomBId === a)));
      if (!exists) fatalErrors.push(issue("VERIFY_GRAPH_EDGE_WITHOUT_DOOR", "DOORS", `Topology edge ${a} ↔ ${b} has no door.`, [a, b]));
    }


    const storedFurnishingHash = furnishingContentHash(candidate.furnishing.settings, candidate.furnishing.rooms);
    if (storedFurnishingHash !== candidate.furnishing.hash) {
      fatalErrors.push(issue("VERIFY_FURNISHING_CONTENT_HASH", "USABILITY", "Stored furniture placements do not match their furnishing hash.", [], { stored: candidate.furnishing.hash, calculated: storedFurnishingHash }));
    }
    const furnishing = this.furnishingSolver.solve(candidate.brief, grid, candidate.spaces, candidate.doors);
    if (!furnishing.passed || !furnishing.value) {
      fatalErrors.push(...furnishing.fatalErrors.map((e) => issue(`VERIFY_${e.code}`, "USABILITY", e.message, e.affectedIds, e.evidence)));
    } else if (furnishing.value.hash !== candidate.furnishing.hash) {
      fatalErrors.push(issue("VERIFY_FURNISHING_MISMATCH", "USABILITY", "Stored furnishing proof differs from an independent furnishing solve.", [], { stored: candidate.furnishing.hash, recomputed: furnishing.value.hash }));
    }

    const navigation = validateNavigation(grid, candidate.spaces, candidate.doors, candidate.furnishing.blockedCells);
    if (!navigation.passed) fatalErrors.push(...navigation.fatalErrors.map((e) => issue(`VERIFY_${e.code}`, "NAVIGATION", e.message, e.affectedIds, e.evidence)));

    const outsideAssignedCells = Array.from(grid.labels).filter((label, i) => !grid.isInside(i) && label >= 0).length;
    const unassignedInsideCells = Array.from(grid.labels).filter((label, i) => grid.isInside(i) && label === UNASSIGNED_LABEL).length;
    const roomComponentCounts: Record<string, number> = {};
    const roomAreasSqM: Record<string, number> = {};
    const roomMinimumWidthsMm: Record<string, number> = {};
    for (const space of candidate.spaces) {
      roomComponentCounts[space.id] = componentCount(grid, space.label);
      roomAreasSqM[space.id] = space.cellCount * grid.cellSizeMm * grid.cellSizeMm / 1_000_000;
      const metric = usability.value?.find((m) => m.roomId === space.id);
      roomMinimumWidthsMm[space.id] = metric ? Math.min(metric.largestRectangleWidthMm, metric.largestRectangleHeightMm) : 0;
    }

    if (fatalErrors.length > 0) return { passed: false, fatalErrors, repairableErrors: [], warnings: usability.warnings, metrics: { fatalCount: fatalErrors.length } };

    const briefHash = stableHash([
      candidate.brief.carpetAreaSqM,
      candidate.brief.bhk,
      candidate.brief.bathroomCount,
      candidate.brief.entranceEdge,
      candidate.brief.furnishing.clearanceProfile,
      candidate.brief.furnishing.minimumWalkwayMm,
      candidate.brief.furnishing.bedroom.bedType,
      candidate.brief.furnishing.bedroom.wardrobeLengthMm,
      candidate.brief.furnishing.kitchen.minimumCounterLengthMm,
      candidate.brief.furnishing.bathroom.requireJacuzzi,
      ...candidate.brief.envelope.outer.flatMap((p) => [p.x, p.y])
    ]);
    const gridHash = stableHash([grid.width, grid.height, grid.cellSizeMm, ...Array.from(grid.labels)]);
    const polygonHash = stableHash(polygonHashParts);
    const certificate: MathematicalPlanCertificate = {
      valid: true,
      candidateId: candidate.id,
      briefHash,
      gridHash,
      polygonHash,
      furnishingHash: candidate.furnishing.hash,
      cellSizeMm: grid.cellSizeMm,
      envelopeCells: grid.insideCellCount(),
      assignedCells: grid.assignedInsideCount(),
      outsideAssignedCells,
      unassignedInsideCells,
      roomComponentCounts,
      roomAreasSqM,
      roomMinimumWidthsMm,
      sharedWallMatrix: boundaryMatrix(recomputedBoundaries, candidate),
      doorConnectivityMatrix: doorMatrix(candidate),
      navigationConnectivityMatrix: navMatrix(candidate),
      criticalJourneysPassed: navigation.passed && candidate.navigationPaths.length >= Math.max(0, candidate.spaces.length - 1),
      furnishingRoomsPassed: furnishing.value?.rooms.length ?? 0
    };
    return { passed: true, value: certificate, fatalErrors: [], repairableErrors: [], warnings: usability.warnings, metrics: { certificate: true } };
  }
}
