import type { Direction, NormalizedBrief, ProgrammeBudget, RoomRequirement, TopologyFamily } from "../types.ts";
import { OccupancyGrid } from "../grid/OccupancyGrid.ts";
import { SeededRandom } from "./random.ts";

interface NormalizedPoint {
  x: number;
  y: number;
}

function transformForEntrance(p: NormalizedPoint, entrance: Direction): NormalizedPoint {
  switch (entrance) {
    case "SOUTH":
      return p;
    case "NORTH":
      return { x: 1 - p.x, y: 1 - p.y };
    case "EAST":
      return { x: 1 - p.y, y: p.x };
    case "WEST":
      return { x: p.y, y: 1 - p.x };
  }
}

function canonicalSeed(
  req: RoomRequirement,
  index: number,
  family: TopologyFamily,
  siblingCount: number
): NormalizedPoint {
  const spread = siblingCount <= 1 ? 0.5 : (index + 1) / (siblingCount + 1);

  if (family === "HALL_CENTRIC") {
    switch (req.type) {
      case "FOYER": return { x: 0.5, y: 0.9 };
      case "LIVING": return { x: 0.48, y: 0.58 };
      case "KITCHEN": return { x: 0.18, y: 0.25 };
      case "BEDROOM": return { x: 0.78, y: 0.2 + 0.55 * spread };
      case "ENSUITE": return { x: 0.92, y: 0.2 + 0.55 * spread };
      case "PRIVATE_LOBBY": return { x: 0.67, y: 0.58 };
      case "BATHROOM": return { x: 0.72, y: 0.62 + 0.08 * spread };
      case "DINING": return { x: 0.35, y: 0.56 };
      case "UTILITY": return { x: 0.08, y: 0.2 };
      case "STUDY": return { x: 0.18, y: 0.7 };
      case "STORAGE": return { x: 0.32, y: 0.86 };
      case "FAMILY_LOUNGE": return { x: 0.45, y: 0.32 };
      default: return { x: 0.5, y: 0.5 };
    }
  }

  if (family === "PRIVATE_LOBBY") {
    switch (req.type) {
      case "FOYER": return { x: 0.48, y: 0.9 };
      case "LIVING": return { x: 0.32, y: 0.58 };
      case "KITCHEN": return { x: 0.18, y: 0.25 };
      case "PRIVATE_LOBBY": return { x: 0.58, y: 0.58 };
      case "BEDROOM": return { x: 0.8, y: 0.18 + 0.58 * spread };
      case "ENSUITE": return { x: 0.94, y: 0.18 + 0.58 * spread };
      case "BATHROOM": return { x: 0.66, y: 0.64 + 0.08 * spread };
      case "DINING": return { x: 0.35, y: 0.43 };
      case "UTILITY": return { x: 0.08, y: 0.2 };
      case "STUDY": return { x: 0.18, y: 0.76 };
      case "STORAGE": return { x: 0.46, y: 0.82 };
      case "FAMILY_LOUNGE": return { x: 0.36, y: 0.3 };
      default: return { x: 0.5, y: 0.5 };
    }
  }

  switch (req.type) {
    case "FOYER": return { x: 0.48, y: 0.9 };
    case "LIVING": return { x: 0.44, y: 0.62 };
    case "KITCHEN": return { x: 0.18, y: 0.42 };
    case "PRIVATE_LOBBY": return { x: 0.58, y: 0.48 };
    case "BEDROOM": return index % 2 === 0 ? { x: 0.78, y: 0.22 + 0.15 * spread } : { x: 0.78, y: 0.68 - 0.15 * spread };
    case "ENSUITE": return index % 2 === 0 ? { x: 0.93, y: 0.16 + 0.15 * spread } : { x: 0.93, y: 0.75 - 0.15 * spread };
    case "BATHROOM": return { x: 0.62, y: 0.62 + 0.08 * spread };
    case "DINING": return { x: 0.32, y: 0.52 };
    case "UTILITY": return { x: 0.08, y: 0.36 };
    case "STUDY": return { x: 0.2, y: 0.78 };
    case "STORAGE": return { x: 0.45, y: 0.84 };
    case "FAMILY_LOUNGE": return { x: 0.44, y: 0.3 };
    default: return { x: 0.5, y: 0.5 };
  }
}

function nearestAvailableCell(grid: OccupancyGrid, tx: number, ty: number, used: Set<number>): number | undefined {
  const startX = Math.max(0, Math.min(grid.width - 1, Math.round(tx)));
  const startY = Math.max(0, Math.min(grid.height - 1, Math.round(ty)));
  const maxRadius = Math.max(grid.width, grid.height);
  for (let radius = 0; radius <= maxRadius; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const x = startX + dx;
        const y = startY + dy;
        if (!grid.inBounds(x, y)) continue;
        const idx = grid.index(x, y);
        if (grid.isInside(idx) && !used.has(idx)) return idx;
      }
    }
  }
  return undefined;
}

export function planSeeds(
  brief: NormalizedBrief,
  budget: ProgrammeBudget,
  grid: OccupancyGrid,
  family: TopologyFamily,
  seed: number
): Record<string, number> | undefined {
  const rng = new SeededRandom(seed);
  const used = new Set<number>();
  const result: Record<string, number> = {};
  const byType = new Map<string, RoomRequirement[]>();
  for (const req of budget.requirements) {
    const list = byType.get(req.type) ?? [];
    list.push(req);
    byType.set(req.type, list);
  }

  const mirror = rng.next() < 0.5;
  for (const req of budget.requirements) {
    const siblings = byType.get(req.type)!;
    const index = siblings.findIndex((r) => r.id === req.id);
    let p = canonicalSeed(req, index, family, siblings.length);
    if (mirror) p = { x: 1 - p.x, y: p.y };
    p = transformForEntrance(p, brief.entranceEdge);
    const hasFoyer = budget.requirements.some((r) => r.type === "FOYER");
    const isEntryHost = req.type === "FOYER" || (!hasFoyer && req.type === "LIVING");
    if (isEntryHost) {
      if (brief.entranceEdge === "SOUTH") p = { x: p.x, y: 1 };
      if (brief.entranceEdge === "NORTH") p = { x: p.x, y: 0 };
      if (brief.entranceEdge === "EAST") p = { x: 1, y: p.y };
      if (brief.entranceEdge === "WEST") p = { x: 0, y: p.y };
    }
    const jitterX = isEntryHost && (brief.entranceEdge === "EAST" || brief.entranceEdge === "WEST") ? 0 : rng.jitter(0.08);
    const jitterY = isEntryHost && (brief.entranceEdge === "NORTH" || brief.entranceEdge === "SOUTH") ? 0 : rng.jitter(0.08);
    const tx = (Math.min(1, Math.max(0, p.x + jitterX))) * (grid.width - 1);
    const ty = (Math.min(1, Math.max(0, p.y + jitterY))) * (grid.height - 1);
    const cell = nearestAvailableCell(grid, tx, ty, used);
    if (cell === undefined) return undefined;
    used.add(cell);
    result[req.id] = cell;
  }
  return result;
}
