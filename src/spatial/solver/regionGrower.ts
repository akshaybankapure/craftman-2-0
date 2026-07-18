import type {
  AccessGraph,
  NormalizedBrief,
  ProgrammeBudget,
  RoomRequirement,
  SpaceRegion
} from "../types.ts";
import { OccupancyGrid, UNASSIGNED_LABEL } from "../grid/OccupancyGrid.ts";
import { SeededRandom } from "./random.ts";


function coreDimensions(req: RoomRequirement, cellSizeMm: number): { w: number; h: number } {
  const cells = (mm: number) => Math.max(1, Math.ceil(mm / cellSizeMm));
  switch (req.type) {
    case "LIVING": return { w: cells(3600), h: cells(3000) };
    case "BEDROOM": return { w: cells(3000), h: cells(req.minWidthMm) };
    case "KITCHEN": return { w: cells(2400), h: cells(1800) };
    case "BATHROOM":
    case "ENSUITE": return { w: cells(2100), h: cells(1500) };
    case "FOYER": return { w: cells(1500), h: cells(1200) };
    case "PRIVATE_LOBBY":
    case "CORRIDOR": return { w: cells(1500), h: cells(req.minWidthMm) };
    case "DINING": return { w: cells(2700), h: cells(2400) };
    case "STUDY": return { w: cells(2400), h: cells(2100) };
    case "UTILITY": return { w: cells(1800), h: cells(1200) };
    default: return { w: cells(1500), h: cells(1000) };
  }
}

function findCoreCells(grid: OccupancyGrid, seedCell: number, w: number, h: number, entranceEdge?: NormalizedBrief["entranceEdge"]): number[] | undefined {
  const seed = grid.coords(seedCell);
  const maxRadius = Math.max(grid.width, grid.height);
  for (let radius = 0; radius <= maxRadius; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const cx = seed.x + dx;
        const cy = seed.y + dy;
        let left = Math.round(cx - (w - 1) / 2);
        let top = Math.round(cy - (h - 1) / 2);
        if (entranceEdge) {
          let minInsideX = grid.width;
          let maxInsideX = -1;
          let minInsideY = grid.height;
          let maxInsideY = -1;
          for (let ii = 0; ii < grid.envelopeMask.length; ii++) {
            if (!grid.isInside(ii)) continue;
            const c = grid.coords(ii);
            minInsideX = Math.min(minInsideX, c.x);
            maxInsideX = Math.max(maxInsideX, c.x);
            minInsideY = Math.min(minInsideY, c.y);
            maxInsideY = Math.max(maxInsideY, c.y);
          }
          if (entranceEdge === "SOUTH") top = maxInsideY - h + 1;
          if (entranceEdge === "NORTH") top = minInsideY;
          if (entranceEdge === "EAST") left = maxInsideX - w + 1;
          if (entranceEdge === "WEST") left = minInsideX;
        }
        const cells: number[] = [];
        let valid = true;
        for (let yy = top; yy < top + h && valid; yy++) {
          for (let xx = left; xx < left + w; xx++) {
            if (!grid.inBounds(xx, yy)) { valid = false; break; }
            const idx = grid.index(xx, yy);
            if (!grid.isInside(idx) || grid.labels[idx] !== UNASSIGNED_LABEL) { valid = false; break; }
            cells.push(idx);
          }
        }
        if (valid) return cells;
      }
    }
  }
  return undefined;
}

interface GrowthRoom {
  requirement: RoomRequirement;
  label: number;
  seedCell: number;
  cells: Set<number>;
  frontier: Set<number>;
  target: number;
  max: number;
  desiredNeighbours: Set<string>;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function isExteriorCell(grid: OccupancyGrid, index: number): boolean {
  const { x, y } = grid.coords(index);
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;
  return dirs.some(([dx, dy]) => {
    const nx = x + dx;
    const ny = y + dy;
    if (!grid.inBounds(nx, ny)) return true;
    return !grid.isInside(grid.index(nx, ny));
  });
}

function normalizedDistanceFromEntrance(grid: OccupancyGrid, index: number, brief: NormalizedBrief): number {
  const { x, y } = grid.coords(index);
  const nx = grid.width <= 1 ? 0.5 : x / (grid.width - 1);
  const ny = grid.height <= 1 ? 0.5 : y / (grid.height - 1);
  switch (brief.entranceEdge) {
    case "SOUTH": return 1 - ny;
    case "NORTH": return ny;
    case "EAST": return 1 - nx;
    case "WEST": return nx;
  }
}

function desiredNeighbourIds(graph: AccessGraph, roomId: string): Set<string> {
  const node = graph.nodes.find((n) => n.roomId === roomId);
  if (!node) return new Set();
  const ids = new Set<string>();
  for (const e of graph.edges) {
    const otherNodeId = e.from === node.id ? e.to : e.to === node.id ? e.from : undefined;
    if (!otherNodeId) continue;
    const otherNode = graph.nodes.find((n) => n.id === otherNodeId);
    if (otherNode?.roomId) ids.add(otherNode.roomId);
  }
  return ids;
}

function addFrontier(grid: OccupancyGrid, room: GrowthRoom, index: number): void {
  for (const n of grid.neighbours4(index)) {
    if (grid.labels[n] === UNASSIGNED_LABEL) room.frontier.add(n);
  }
}

function cellScore(
  grid: OccupancyGrid,
  room: GrowthRoom,
  candidate: number,
  roomByLabel: Map<number, GrowthRoom>,
  brief: NormalizedBrief,
  rng: SeededRandom
): number {
  const req = room.requirement;
  const { x, y } = grid.coords(candidate);
  const seed = grid.coords(room.seedCell);
  const manhattan = Math.abs(x - seed.x) + Math.abs(y - seed.y);
  const exterior = isExteriorCell(grid, candidate);
  const depth = normalizedDistanceFromEntrance(grid, candidate, brief);
  let score = -0.11 * manhattan;

  const sameNeighbours = grid.neighbours4(candidate).filter((n) => grid.labels[n] === room.label).length;
  const foreignNeighbours = grid.neighbours4(candidate).filter((n) => grid.labels[n]! >= 0 && grid.labels[n] !== room.label);
  score += sameNeighbours * 4.5;
  score -= Math.max(0, foreignNeighbours.length - 1) * 0.8;

  const newMinX = Math.min(room.minX, x);
  const newMaxX = Math.max(room.maxX, x);
  const newMinY = Math.min(room.minY, y);
  const newMaxY = Math.max(room.maxY, y);
  const boxW = newMaxX - newMinX + 1;
  const boxH = newMaxY - newMinY + 1;
  const aspect = Math.max(boxW, boxH) / Math.max(1, Math.min(boxW, boxH));
  const fillRatio = (room.cells.size + 1) / (boxW * boxH);
  score += fillRatio * 5.5;
  score -= Math.max(0, aspect - req.preferredAspectRatio) * 3.5;

  if (req.exteriorAccess === "REQUIRED") score += exterior ? 5 : -0.7;
  else if (req.exteriorAccess === "PREFERRED") score += exterior ? 2.2 : 0;
  else if (req.exteriorAccess === "NOT_REQUIRED") score -= exterior ? 0.7 : 0;

  if (req.type === "BEDROOM" || req.type === "ENSUITE" || req.type === "BATHROOM") score += depth * 2.2;
  if (req.type === "FOYER") score += (1 - depth) * 4;
  if (req.type === "LIVING") score += (1 - Math.abs(depth - 0.55)) * 1.5;

  for (const n of foreignNeighbours) {
    const other = roomByLabel.get(grid.labels[n]!);
    if (!other) continue;
    if (room.desiredNeighbours.has(other.requirement.id)) score += 3.2;
    if (
      (req.type === "BATHROOM" || req.type === "ENSUITE" || req.type === "KITCHEN" || req.type === "UTILITY") &&
      (other.requirement.type === "BATHROOM" || other.requirement.type === "ENSUITE" || other.requirement.type === "KITCHEN" || other.requirement.type === "UTILITY")
    ) score += 0.8;
  }

  const deficitRatio = Math.max(0, room.target - room.cells.size) / Math.max(1, room.target);
  score += deficitRatio * 2;
  score += rng.jitter(0.25);
  return score;
}

function chooseRoom(rooms: GrowthRoom[], rng: SeededRandom): GrowthRoom | undefined {
  const eligible = rooms.filter((r) => r.frontier.size > 0 && r.cells.size < r.target);
  if (eligible.length === 0) return undefined;
  eligible.sort((a, b) => {
    const da = (a.target - a.cells.size) / Math.max(1, a.target);
    const db = (b.target - b.cells.size) / Math.max(1, b.target);
    return db - da || a.label - b.label;
  });
  const window = Math.min(3, eligible.length);
  return eligible[rng.int(window)]!;
}

export interface GrowthResult {
  grid: OccupancyGrid;
  spaces: SpaceRegion[];
}

export function growRegions(
  brief: NormalizedBrief,
  budget: ProgrammeBudget,
  topology: AccessGraph,
  baseGrid: OccupancyGrid,
  seeds: Record<string, number>,
  seed: number
): GrowthResult | undefined {
  const grid = baseGrid.clone();
  const rng = new SeededRandom(seed);
  const rooms: GrowthRoom[] = budget.requirements.map((requirement, label) => {
    const seedCell = seeds[requirement.id];
    if (seedCell === undefined) throw new Error(`Missing seed for ${requirement.id}`);
    return {
      requirement,
      label,
      seedCell,
      cells: new Set<number>(),
      frontier: new Set<number>(),
      target: budget.targetCellsByRoomId[requirement.id]!,
      max: budget.maxCellsByRoomId[requirement.id]!,
      desiredNeighbours: desiredNeighbourIds(topology, requirement.id),
      minX: baseGrid.coords(seedCell).x,
      minY: baseGrid.coords(seedCell).y,
      maxX: baseGrid.coords(seedCell).x,
      maxY: baseGrid.coords(seedCell).y
    };
  });
  const roomByLabel = new Map(rooms.map((r) => [r.label, r]));

  // Establish compact connected cores before competitive growth. This prevents
  // the Voronoi-like triangular slivers produced by single-cell seeding.
  const hasFoyerForOrder = rooms.some((r) => r.requirement.type === "FOYER");
  const isEntryRoom = (r: GrowthRoom) => r.requirement.type === "FOYER" || (!hasFoyerForOrder && r.requirement.type === "LIVING");
  const placementOrder = [...rooms].sort((a, b) => {
    if (isEntryRoom(a) !== isEntryRoom(b)) return isEntryRoom(a) ? -1 : 1;
    const da = coreDimensions(a.requirement, grid.cellSizeMm);
    const db = coreDimensions(b.requirement, grid.cellSizeMm);
    return db.w * db.h - da.w * da.h;
  });
  for (const room of placementOrder) {
    const dims = coreDimensions(room.requirement, grid.cellSizeMm);
    const hasFoyer = rooms.some((r) => r.requirement.type === "FOYER");
    const entryAnchored = room.requirement.type === "FOYER" || (!hasFoyer && room.requirement.type === "LIVING");
    const core = findCoreCells(grid, room.seedCell, dims.w, dims.h, entryAnchored ? brief.entranceEdge : undefined);
    if (!core) return undefined;
    for (const cell of core) {
      grid.labels[cell] = room.label;
      room.cells.add(cell);
      const c = grid.coords(cell);
      room.minX = Math.min(room.minX, c.x);
      room.maxX = Math.max(room.maxX, c.x);
      room.minY = Math.min(room.minY, c.y);
      room.maxY = Math.max(room.maxY, c.y);
    }
  }
  rooms.forEach((room) => room.cells.forEach((cell) => addFrontier(grid, room, cell)));

  let guard = grid.insideCellCount() * 20;
  while (guard-- > 0) {
    const room = chooseRoom(rooms, rng);
    if (!room) break;
    let bestCell: number | undefined;
    let bestScore = -Infinity;
    for (const cell of room.frontier) {
      if (grid.labels[cell] !== UNASSIGNED_LABEL) {
        room.frontier.delete(cell);
        continue;
      }
      const score = cellScore(grid, room, cell, roomByLabel, brief, rng);
      if (score > bestScore) {
        bestScore = score;
        bestCell = cell;
      }
    }
    if (bestCell === undefined) {
      room.frontier.clear();
      continue;
    }
    grid.labels[bestCell] = room.label;
    room.cells.add(bestCell);
    const added = grid.coords(bestCell);
    room.minX = Math.min(room.minX, added.x);
    room.maxX = Math.max(room.maxX, added.x);
    room.minY = Math.min(room.minY, added.y);
    room.maxY = Math.max(room.maxY, added.y);
    room.frontier.delete(bestCell);
    addFrontier(grid, room, bestCell);
  }

  // Fill remaining cells while preserving connected growth.
  guard = grid.insideCellCount() * 20;
  while (grid.assignedInsideCount() < grid.insideCellCount() && guard-- > 0) {
    let bestRoom: GrowthRoom | undefined;
    let bestCell: number | undefined;
    let bestScore = -Infinity;
    for (const room of rooms) {
      if (room.cells.size >= room.max && rooms.some((r) => r.cells.size < r.max)) continue;
      for (const cell of room.frontier) {
        if (grid.labels[cell] !== UNASSIGNED_LABEL) continue;
        let score = cellScore(grid, room, cell, roomByLabel, brief, rng);
        if (room.cells.size >= room.target) score -= 1.2;
        if (score > bestScore) {
          bestScore = score;
          bestRoom = room;
          bestCell = cell;
        }
      }
    }
    if (!bestRoom || bestCell === undefined) break;
    grid.labels[bestCell] = bestRoom.label;
    bestRoom.cells.add(bestCell);
    const added = grid.coords(bestCell);
    bestRoom.minX = Math.min(bestRoom.minX, added.x);
    bestRoom.maxX = Math.max(bestRoom.maxX, added.x);
    bestRoom.minY = Math.min(bestRoom.minY, added.y);
    bestRoom.maxY = Math.max(bestRoom.maxY, added.y);
    bestRoom.frontier.delete(bestCell);
    addFrontier(grid, bestRoom, bestCell);
  }

  if (grid.assignedInsideCount() !== grid.insideCellCount()) return undefined;

  const spaces: SpaceRegion[] = rooms.map((room) => ({
    id: room.requirement.id,
    type: room.requirement.type,
    label: room.label,
    requirement: room.requirement,
    seedCell: room.seedCell,
    cellCount: room.cells.size
  }));

  return { grid, spaces };
}
