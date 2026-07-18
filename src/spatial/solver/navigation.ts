import type { DoorPortal, NavigationPath, ReasoningIssue, ReasoningResult, SpaceRegion } from "../types.ts";
import { OccupancyGrid } from "../grid/OccupancyGrid.ts";

function issue(code: string, message: string, affectedIds: string[] = [], evidence?: Record<string, unknown>): ReasoningIssue {
  const base: ReasoningIssue = { code, stage: "NAVIGATION", message, affectedIds };
  return evidence === undefined ? base : { ...base, evidence };
}

function pairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function shortestPath(grid: OccupancyGrid, start: number, goal: number, allowedCrossings: Set<string>, blocked: Set<number>): number[] | undefined {
  const prev = new Int32Array(grid.labels.length);
  prev.fill(-1);
  const visited = new Uint8Array(grid.labels.length);
  const queue = new Int32Array(grid.labels.length);
  let head = 0;
  let tail = 0;
  queue[tail++] = start;
  visited[start] = 1;

  while (head < tail) {
    const cur = queue[head++]!;
    if (cur === goal) break;
    for (const n of grid.neighbours4(cur)) {
      if (visited[n] || !grid.isInside(n) || grid.labels[n]! < 0 || (blocked.has(n) && n !== goal)) continue;
      const sameRoom = grid.labels[cur] === grid.labels[n];
      if (!sameRoom && !allowedCrossings.has(pairKey(cur, n))) continue;
      visited[n] = 1;
      prev[n] = cur;
      queue[tail++] = n;
    }
  }
  if (!visited[goal]) return undefined;
  const path: number[] = [];
  let cur = goal;
  while (cur !== -1) {
    path.push(cur);
    if (cur === start) break;
    cur = prev[cur]!;
  }
  path.reverse();
  return path;
}

function roomSequence(path: number[], grid: OccupancyGrid, spaces: SpaceRegion[]): string[] {
  const byLabel = new Map(spaces.map((s) => [s.label, s.id]));
  const result: string[] = [];
  let previous: string | undefined;
  for (const cell of path) {
    const id = byLabel.get(grid.labels[cell]!);
    if (id && id !== previous) {
      result.push(id);
      previous = id;
    }
  }
  return result;
}

export function validateNavigation(
  grid: OccupancyGrid,
  spaces: SpaceRegion[],
  doors: DoorPortal[],
  blockedCells: Iterable<number> = []
): ReasoningResult<NavigationPath[]> {
  const fatalErrors: ReasoningIssue[] = [];
  const paths: NavigationPath[] = [];
  const allowedCrossings = new Set<string>();
  const blocked = new Set(blockedCells);
  for (const door of doors) if (!door.exterior && door.cellB !== undefined) allowedCrossings.add(pairKey(door.cellA, door.cellB));
  const entry = doors.find((d) => d.exterior);
  if (!entry) {
    fatalErrors.push(issue("NAVIGATION_NO_ENTRY", "No exterior entry portal exists."));
    return { passed: false, fatalErrors, repairableErrors: [], warnings: [], metrics: {} };
  }
  const byId = new Map(spaces.map((s) => [s.id, s]));
  const forbiddenTransitTypes = new Set(["BEDROOM", "BATHROOM", "ENSUITE"]);

  for (const target of spaces) {
    if (target.id === entry.roomAId) continue;
    const goals = doors
      .filter((d) => d.roomAId === target.id || d.roomBId === target.id)
      .map((d) => d.roomAId === target.id ? d.cellA : d.cellB)
      .filter((cell): cell is number => cell !== undefined && grid.labels[cell] === target.label);
    const alternatives = goals
      .map((goal) => shortestPath(grid, entry.cellA, goal, allowedCrossings, blocked))
      .filter((path): path is number[] => path !== undefined)
      .sort((a, b) => a.length - b.length);
    const path = alternatives[0];
    if (!path) {
      fatalErrors.push(issue("NAVIGATION_UNREACHABLE", `${target.id} is unreachable from Entry without crossing furniture or walls.`, [target.id]));
      continue;
    }
    const sequence = roomSequence(path, grid, spaces);
    const rawTransit = sequence.slice(1, -1).filter((id) => forbiddenTransitTypes.has(byId.get(id)!.type));
    let transit = rawTransit;
    if (target.type === "ENSUITE") {
      const parentDoor = doors.find((d) => !d.exterior && (d.roomAId === target.id || d.roomBId === target.id));
      const owner = parentDoor ? (parentDoor.roomAId === target.id ? parentDoor.roomBId : parentDoor.roomAId) : undefined;
      transit = rawTransit.filter((id) => id !== owner);
    }
    if (transit.length) fatalErrors.push(issue("NAVIGATION_PRIVATE_TRANSIT", `Path to ${target.id} passes through a private terminal room.`, [target.id, ...transit], { sequence }));
    paths.push({ fromRoomId: entry.roomAId, toRoomId: target.id, cellPath: path, lengthMm: Math.max(0, path.length - 1) * grid.cellSizeMm, crossedRoomIds: sequence });
  }

  // Ensuite must be directly reachable from its owning bedroom through a door.
  for (const ensuite of spaces.filter((s) => s.type === "ENSUITE")) {
    const door = doors.find((d) => !d.exterior && (d.roomAId === ensuite.id || d.roomBId === ensuite.id));
    if (!door || door.cellB === undefined) {
      fatalErrors.push(issue("NAVIGATION_ENSUITE_NO_DOOR", `${ensuite.id} has no valid bedroom door.`, [ensuite.id]));
      continue;
    }
    const otherId = door.roomAId === ensuite.id ? door.roomBId : door.roomAId;
    if (!otherId || byId.get(otherId)?.type !== "BEDROOM") fatalErrors.push(issue("NAVIGATION_ENSUITE_WRONG_PARENT", `${ensuite.id} is not attached to a bedroom.`, [ensuite.id]));
  }

  return {
    passed: fatalErrors.length === 0,
    ...(fatalErrors.length === 0 ? { value: paths } : {}),
    fatalErrors,
    repairableErrors: [],
    warnings: [],
    metrics: { pathCount: paths.length, reachableRooms: paths.length + 1, requiredRooms: spaces.length }
  };
}
