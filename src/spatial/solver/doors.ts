import { BATHROOM_DOOR_WIDTH_MM, DEFAULT_DOOR_WIDTH_MM, DOOR_SIDE_CLEARANCE_MM } from "../constants.ts";
import type { AccessGraph, BoundarySegment, DoorPortal, ReasoningIssue, ReasoningResult, SharedBoundary, SpaceRegion } from "../types.ts";
import { OccupancyGrid } from "../grid/OccupancyGrid.ts";

function issue(code: string, message: string, affectedIds: string[] = [], evidence?: Record<string, unknown>): ReasoningIssue {
  const base: ReasoningIssue = { code, stage: "DOORS", message, affectedIds };
  return evidence === undefined ? base : { ...base, evidence };
}

function nodeRoomId(graph: AccessGraph, nodeId: string): string | undefined {
  return graph.nodes.find((n) => n.id === nodeId)?.roomId;
}

function sharedFor(boundaries: SharedBoundary[], a: string, b: string): SharedBoundary | undefined {
  return boundaries.find((s) => (s.roomAId === a && s.roomBId === b) || (s.roomAId === b && s.roomBId === a));
}

function doorWidthFor(a: SpaceRegion, b: SpaceRegion): number {
  return [a.type, b.type].some((t) => t === "BATHROOM" || t === "ENSUITE") ? BATHROOM_DOOR_WIDTH_MM : DEFAULT_DOOR_WIDTH_MM;
}

function chooseSegment(boundary: SharedBoundary, widthMm: number): BoundarySegment | undefined {
  const minimum = widthMm + 2 * DOOR_SIDE_CLEARANCE_MM;
  const candidates = boundary.segments.filter((s) => s.end - s.start >= minimum).sort((a, b) => (b.end - b.start) - (a.end - a.start));
  const chosen = candidates[0];
  if (!chosen) return undefined;
  const center = (chosen.start + chosen.end) / 2;
  return {
    orientation: chosen.orientation,
    fixed: chosen.fixed,
    start: center - widthMm / 2,
    end: center + widthMm / 2
  };
}

function cellsAcrossBoundary(grid: OccupancyGrid, seg: BoundarySegment): { a: number; b: number } | undefined {
  const mid = (seg.start + seg.end) / 2;
  if (seg.orientation === "V") {
    const bx = Math.round(seg.fixed / grid.cellSizeMm);
    const y = Math.min(grid.height - 1, Math.max(0, Math.floor(mid / grid.cellSizeMm)));
    if (bx <= 0 || bx >= grid.width) return undefined;
    return { a: grid.index(bx - 1, y), b: grid.index(bx, y) };
  }
  const by = Math.round(seg.fixed / grid.cellSizeMm);
  const x = Math.min(grid.width - 1, Math.max(0, Math.floor(mid / grid.cellSizeMm)));
  if (by <= 0 || by >= grid.height) return undefined;
  return { a: grid.index(x, by - 1), b: grid.index(x, by) };
}

function exteriorRun(grid: OccupancyGrid, label: number, edge: "NORTH" | "SOUTH" | "EAST" | "WEST"): { segment: BoundarySegment; cell: number } | undefined {
  const candidates: { pos: number; fixed: number; cell: number }[] = [];
  for (let idx = 0; idx < grid.labels.length; idx++) {
    if (grid.labels[idx] !== label) continue;
    const { x, y } = grid.coords(idx);
    if (edge === "NORTH") {
      const outside = y === 0 || !grid.isInside(grid.index(x, y - 1));
      if (outside) candidates.push({ pos: x, fixed: y, cell: idx });
    } else if (edge === "SOUTH") {
      const outside = y + 1 >= grid.height || !grid.isInside(grid.index(x, y + 1));
      if (outside) candidates.push({ pos: x, fixed: y + 1, cell: idx });
    } else if (edge === "WEST") {
      const outside = x === 0 || !grid.isInside(grid.index(x - 1, y));
      if (outside) candidates.push({ pos: y, fixed: x, cell: idx });
    } else {
      const outside = x + 1 >= grid.width || !grid.isInside(grid.index(x + 1, y));
      if (outside) candidates.push({ pos: y, fixed: x + 1, cell: idx });
    }
  }
  if (candidates.length === 0) return undefined;

  // Keep only the requested outermost facade, not internal notches.
  const extreme = edge === "NORTH" || edge === "WEST"
    ? Math.min(...candidates.map((c) => c.fixed))
    : Math.max(...candidates.map((c) => c.fixed));
  const facade = candidates.filter((c) => c.fixed === extreme).sort((a, b) => a.pos - b.pos);
  if (facade.length === 0) return undefined;

  let bestStart = 0;
  let bestEnd = 0;
  let startIndex = 0;
  for (let i = 1; i <= facade.length; i++) {
    if (i < facade.length && facade[i]!.pos === facade[i - 1]!.pos + 1) continue;
    if (i - startIndex > bestEnd - bestStart) {
      bestStart = startIndex;
      bestEnd = i;
    }
    startIndex = i;
  }
  const run = facade.slice(bestStart, bestEnd);
  const middle = run[Math.floor(run.length / 2)]!;
  const centerMm = (middle.pos + 0.5) * grid.cellSizeMm;
  const widthMm = Math.min(DEFAULT_DOOR_WIDTH_MM, run.length * grid.cellSizeMm);
  const fixedMm = middle.fixed * grid.cellSizeMm;
  const segment: BoundarySegment = edge === "NORTH" || edge === "SOUTH"
    ? { orientation: "H", fixed: fixedMm, start: centerMm - widthMm / 2, end: centerMm + widthMm / 2 }
    : { orientation: "V", fixed: fixedMm, start: centerMm - widthMm / 2, end: centerMm + widthMm / 2 };
  return { segment, cell: middle.cell };
}

export function solveDoors(
  graph: AccessGraph,
  spaces: SpaceRegion[],
  boundaries: SharedBoundary[],
  grid: OccupancyGrid,
  entranceEdge: "NORTH" | "SOUTH" | "EAST" | "WEST"
): ReasoningResult<DoorPortal[]> {
  const fatalErrors: ReasoningIssue[] = [];
  const doors: DoorPortal[] = [];
  const spaceById = new Map(spaces.map((s) => [s.id, s]));

  for (const e of graph.edges) {
    const roomAId = nodeRoomId(graph, e.from);
    const roomBId = nodeRoomId(graph, e.to);
    if (!roomAId || !roomBId) {
      const roomId = roomAId ?? roomBId;
      if (!roomId) continue;
      const room = spaceById.get(roomId)!;
      const run = exteriorRun(grid, room.label, entranceEdge);
      if (!run || run.segment.end - run.segment.start < DEFAULT_DOOR_WIDTH_MM * 0.8) {
        fatalErrors.push(issue("DOOR_NO_ENTRANCE_EDGE", `${roomId} does not have enough frontage on the selected entrance edge.`, [roomId]));
        continue;
      }
      const centerMm = run.segment.orientation === "H"
        ? { x: (run.segment.start + run.segment.end) / 2, y: run.segment.fixed }
        : { x: run.segment.fixed, y: (run.segment.start + run.segment.end) / 2 };
      doors.push({ id: `door_${e.id}`, roomAId: roomId, boundary: run.segment, centerMm, widthMm: run.segment.end - run.segment.start, cellA: run.cell, exterior: true });
      continue;
    }

    const a = spaceById.get(roomAId)!;
    const b = spaceById.get(roomBId)!;
    const boundary = sharedFor(boundaries, roomAId, roomBId);
    if (!boundary) {
      fatalErrors.push(issue("DOOR_NO_SHARED_WALL", `${roomAId} and ${roomBId} do not share a physical wall.`, [roomAId, roomBId]));
      continue;
    }
    const widthMm = doorWidthFor(a, b);
    const segment = chooseSegment(boundary, widthMm);
    if (!segment) {
      fatalErrors.push(issue("DOOR_WALL_TOO_SHORT", `${roomAId} and ${roomBId} do not share a door-capable wall interval.`, [roomAId, roomBId], { totalLengthMm: boundary.totalLengthMm, widthMm }));
      continue;
    }
    const cells = cellsAcrossBoundary(grid, segment);
    if (!cells) {
      fatalErrors.push(issue("DOOR_CELL_MAPPING", "Door could not be mapped to adjacent grid cells.", [roomAId, roomBId]));
      continue;
    }
    const labels = new Set([grid.labels[cells.a], grid.labels[cells.b]]);
    if (!labels.has(a.label) || !labels.has(b.label)) {
      fatalErrors.push(issue("DOOR_WRONG_ROOMS", "Door boundary does not separate the intended rooms.", [roomAId, roomBId]));
      continue;
    }
    const centerMm = segment.orientation === "H"
      ? { x: (segment.start + segment.end) / 2, y: segment.fixed }
      : { x: segment.fixed, y: (segment.start + segment.end) / 2 };
    const cellA = grid.labels[cells.a] === a.label ? cells.a : cells.b;
    const cellB = cellA === cells.a ? cells.b : cells.a;
    doors.push({ id: `door_${e.id}`, roomAId, roomBId, boundary: segment, centerMm, widthMm, cellA, cellB, exterior: false });
  }

  return {
    passed: fatalErrors.length === 0,
    ...(fatalErrors.length === 0 ? { value: doors } : {}),
    fatalErrors,
    repairableErrors: [],
    warnings: [],
    metrics: { doorCount: doors.length, requiredEdgeCount: graph.edges.length }
  };
}
