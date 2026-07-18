import type {
  DoorPortal,
  FurnitureKind,
  FurniturePlacement,
  FurnitureRotation,
  FurnishingCertificate,
  NormalizedBrief,
  ReasoningIssue,
  ReasoningResult,
  ResolvedFurnishingSettings,
  RoomFurnishingOverride,
  RoomFurnishingSolution,
  SpaceRegion,
  WallSide
} from "../types.ts";
import { OccupancyGrid } from "../grid/OccupancyGrid.ts";
import { calculateRoomShapeMetrics } from "../geometry/shapeMetrics.ts";
import { stableHash } from "../verify/hash.ts";

interface ItemSpec {
  kind: FurnitureKind;
  widthMm: number;
  depthMm: number;
  mandatory: boolean;
  wallAttached: boolean;
  accessDepthMm: number;
  accessMode: "FRONT" | "BED" | "RING" | "NONE";
  preferCorner?: boolean;
}

interface PlacementCandidate {
  placement: FurniturePlacement;
  score: number;
}

interface SearchState {
  placements: FurniturePlacement[];
  occupied: Set<number>;
  reservedInteractions: Set<number>;
}

const BED_MM: Record<"SINGLE" | "DOUBLE" | "QUEEN" | "KING", [number, number]> = {
  SINGLE: [1000, 2000],
  DOUBLE: [1400, 2000],
  QUEEN: [1600, 2000],
  KING: [1800, 2000]
};

function issue(code: string, message: string, affectedIds: string[] = [], evidence?: Record<string, unknown>): ReasoningIssue {
  const base: ReasoningIssue = { code, stage: "USABILITY", message, affectedIds };
  return evidence === undefined ? base : { ...base, evidence };
}

function cellsForMm(mm: number, cellSizeMm: number): number {
  return Math.max(1, Math.ceil(mm / cellSizeMm));
}

function mergedOverride(settings: ResolvedFurnishingSettings, roomId: string): RoomFurnishingOverride {
  return settings.roomOverrides[roomId] ?? {};
}

function specsForRoom(space: SpaceRegion, settings: ResolvedFurnishingSettings): ItemSpec[] {
  const override = mergedOverride(settings, space.id);
  const walkway = settings.minimumWalkwayMm;
  switch (space.type) {
    case "BEDROOM": {
      const bedroom = { ...settings.bedroom, ...override };
      const [bedWidth, bedDepth] = BED_MM[bedroom.bedType ?? settings.bedroom.bedType];
      const specs: ItemSpec[] = [
        { kind: "BED", widthMm: bedWidth, depthMm: bedDepth, mandatory: true, wallAttached: true, accessDepthMm: Math.max(450, walkway), accessMode: "BED" },
        { kind: "WARDROBE", widthMm: bedroom.wardrobeLengthMm ?? settings.bedroom.wardrobeLengthMm, depthMm: 600, mandatory: true, wallAttached: true, accessDepthMm: bedroom.wardrobeType === "HINGED" ? Math.max(750, walkway) : Math.max(550, walkway), accessMode: "FRONT" }
      ];
      if (bedroom.requireDesk) specs.push({ kind: "DESK", widthMm: 1200, depthMm: 600, mandatory: true, wallAttached: true, accessDepthMm: Math.max(700, walkway), accessMode: "FRONT" });
      if (bedroom.requireDressing) specs.push({ kind: "WARDROBE", widthMm: 1200, depthMm: 600, mandatory: true, wallAttached: true, accessDepthMm: Math.max(700, walkway), accessMode: "FRONT" });
      if (bedroom.requireSeating) specs.push({ kind: "SOFA", widthMm: 1200, depthMm: 700, mandatory: true, wallAttached: false, accessDepthMm: 500, accessMode: "FRONT" });
      return specs;
    }
    case "LIVING":
    case "FAMILY_LOUNGE": {
      const living = { ...settings.living, ...override };
      const sofaWidth = living.seatingCapacity <= 2 ? 1600 : living.seatingCapacity <= 3 ? 2100 : living.seatingCapacity <= 5 ? 2700 : 3200;
      const specs: ItemSpec[] = [
        { kind: "SOFA", widthMm: sofaWidth, depthMm: 900, mandatory: true, wallAttached: true, accessDepthMm: Math.max(700, walkway), accessMode: "FRONT" }
      ];
      if (living.requireTvUnit) specs.push({ kind: "TV_UNIT", widthMm: Math.min(2000, Math.max(1200, sofaWidth - 300)), depthMm: 400, mandatory: true, wallAttached: true, accessDepthMm: 0, accessMode: "NONE" });
      if (living.requireDining) {
        const seats = Math.max(2, living.diningSeats);
        specs.push({ kind: "DINING_TABLE", widthMm: seats > 4 ? 1800 : 1400, depthMm: seats > 4 ? 900 : 800, mandatory: true, wallAttached: false, accessDepthMm: Math.max(600, walkway), accessMode: "RING" });
      }
      return specs;
    }
    case "KITCHEN": {
      const kitchen = { ...settings.kitchen, ...override };
      const specs: ItemSpec[] = [
        { kind: "COUNTER_RUN", widthMm: kitchen.minimumCounterLengthMm, depthMm: 600, mandatory: true, wallAttached: true, accessDepthMm: Math.max(700, walkway), accessMode: "FRONT" },
        { kind: "REFRIGERATOR", widthMm: 750, depthMm: 750, mandatory: true, wallAttached: true, accessDepthMm: Math.max(600, walkway), accessMode: "FRONT" }
      ];
      if (kitchen.requireDishwasher) specs.push({ kind: "DISHWASHER", widthMm: 600, depthMm: 650, mandatory: true, wallAttached: true, accessDepthMm: Math.max(750, walkway), accessMode: "FRONT" });
      if (kitchen.requireBreakfastCounter) specs.push({ kind: "BREAKFAST_COUNTER", widthMm: 1500, depthMm: 600, mandatory: true, wallAttached: false, accessDepthMm: Math.max(700, walkway), accessMode: "FRONT" });
      return specs;
    }
    case "BATHROOM":
    case "ENSUITE": {
      const bathroom = { ...settings.bathroom, ...override };
      const specs: ItemSpec[] = [
        { kind: "WC", widthMm: 700, depthMm: 1000, mandatory: true, wallAttached: true, accessDepthMm: 500, accessMode: "FRONT" },
        { kind: "BASIN", widthMm: bathroom.requireDoubleBasin ? 1100 : 500, depthMm: 500, mandatory: true, wallAttached: true, accessDepthMm: 500, accessMode: "FRONT" }
      ];
      if (bathroom.requireShower) specs.push({ kind: "SHOWER", widthMm: bathroom.accessible ? 1200 : 850, depthMm: bathroom.accessible ? 1200 : 850, mandatory: true, wallAttached: true, accessDepthMm: 350, accessMode: "FRONT", preferCorner: true });
      if (bathroom.requireBathtub) specs.push({ kind: "BATHTUB", widthMm: 1700, depthMm: 750, mandatory: true, wallAttached: true, accessDepthMm: 500, accessMode: "FRONT" });
      if (bathroom.requireJacuzzi) specs.push({ kind: "JACUZZI", widthMm: 1500, depthMm: 1500, mandatory: true, wallAttached: true, accessDepthMm: 600, accessMode: "FRONT", preferCorner: true });
      return specs;
    }
    case "DINING":
      return [{ kind: "DINING_TABLE", widthMm: 1600, depthMm: 900, mandatory: true, wallAttached: false, accessDepthMm: Math.max(600, walkway), accessMode: "RING" }];
    case "STUDY":
      return [{ kind: "DESK", widthMm: 1400, depthMm: 700, mandatory: true, wallAttached: true, accessDepthMm: Math.max(700, walkway), accessMode: "FRONT" }];
    case "UTILITY":
      return [{ kind: "WASHING_MACHINE", widthMm: 650, depthMm: 650, mandatory: true, wallAttached: true, accessDepthMm: 700, accessMode: "FRONT" }];
    default:
      return [];
  }
}

function roomCells(grid: OccupancyGrid, label: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < grid.labels.length; i++) if (grid.labels[i] === label) result.push(i);
  return result;
}

function doorCellForRoom(door: DoorPortal, room: SpaceRegion, grid: OccupancyGrid): number | undefined {
  if (door.roomAId === room.id) return door.cellA;
  if (door.roomBId === room.id && door.cellB !== undefined) return door.cellB;
  if (door.exterior && door.roomAId === room.id) return door.cellA;
  const candidates = [door.cellA, door.cellB].filter((v): v is number => v !== undefined);
  return candidates.find((cell) => grid.labels[cell] === room.label);
}

function doorKeepClearCells(room: SpaceRegion, doors: DoorPortal[], grid: OccupancyGrid): Set<number> {
  const result = new Set<number>();
  for (const door of doors) {
    const cell = doorCellForRoom(door, room, grid);
    if (cell === undefined) continue;
    result.add(cell);
    for (const n of grid.neighbours4(cell)) if (grid.labels[n] === room.label) result.add(n);
  }
  return result;
}

function rectCells(grid: OccupancyGrid, x: number, y: number, width: number, height: number): number[] | undefined {
  if (x < 0 || y < 0 || x + width > grid.width || y + height > grid.height) return undefined;
  const cells: number[] = [];
  for (let yy = y; yy < y + height; yy++) for (let xx = x; xx < x + width; xx++) cells.push(grid.index(xx, yy));
  return cells;
}

function sideDelta(side: WallSide): [number, number] {
  if (side === "NORTH") return [0, -1];
  if (side === "SOUTH") return [0, 1];
  if (side === "WEST") return [-1, 0];
  return [1, 0];
}

function edgeCells(grid: OccupancyGrid, x: number, y: number, width: number, height: number, side: WallSide): number[] {
  const result: number[] = [];
  if (side === "NORTH" || side === "SOUTH") {
    const yy = side === "NORTH" ? y : y + height - 1;
    for (let xx = x; xx < x + width; xx++) result.push(grid.index(xx, yy));
  } else {
    const xx = side === "WEST" ? x : x + width - 1;
    for (let yy = y; yy < y + height; yy++) result.push(grid.index(xx, yy));
  }
  return result;
}

function wallContactRatio(grid: OccupancyGrid, label: number, x: number, y: number, width: number, height: number, side: WallSide): number {
  const edge = edgeCells(grid, x, y, width, height, side);
  const [dx, dy] = sideDelta(side);
  let contacts = 0;
  for (const cell of edge) {
    const c = grid.coords(cell);
    const nx = c.x + dx;
    const ny = c.y + dy;
    if (!grid.inBounds(nx, ny) || grid.labels[grid.index(nx, ny)] !== label) contacts++;
  }
  return contacts / Math.max(1, edge.length);
}

function stripOutsideFootprint(
  grid: OccupancyGrid,
  x: number,
  y: number,
  width: number,
  height: number,
  side: WallSide,
  depth: number
): number[] | undefined {
  if (depth <= 0) return [];
  if (side === "NORTH") return rectCells(grid, x, y - depth, width, depth);
  if (side === "SOUTH") return rectCells(grid, x, y + height, width, depth);
  if (side === "WEST") return rectCells(grid, x - depth, y, depth, height);
  return rectCells(grid, x + width, y, depth, height);
}

function frontSide(backSide: WallSide): WallSide {
  if (backSide === "NORTH") return "SOUTH";
  if (backSide === "SOUTH") return "NORTH";
  if (backSide === "WEST") return "EAST";
  return "WEST";
}

function ringCells(grid: OccupancyGrid, x: number, y: number, width: number, height: number, depth: number): number[] | undefined {
  const outer = rectCells(grid, x - depth, y - depth, width + 2 * depth, height + 2 * depth);
  if (!outer) return undefined;
  const footprint = new Set(rectCells(grid, x, y, width, height) ?? []);
  return outer.filter((c) => !footprint.has(c));
}

function bedAccessCells(
  grid: OccupancyGrid,
  x: number,
  y: number,
  width: number,
  height: number,
  backSide: WallSide,
  depth: number,
  alternate: boolean
): number[] | undefined {
  const foot = stripOutsideFootprint(grid, x, y, width, height, frontSide(backSide), depth);
  if (!foot) return undefined;
  const side: WallSide = backSide === "NORTH" || backSide === "SOUTH"
    ? (alternate ? "EAST" : "WEST")
    : (alternate ? "SOUTH" : "NORTH");
  const lateral = stripOutsideFootprint(grid, x, y, width, height, side, depth);
  if (!lateral) return undefined;
  return [...new Set([...foot, ...lateral])];
}

function enumerateCandidates(
  room: SpaceRegion,
  spec: ItemSpec,
  itemIndex: number,
  grid: OccupancyGrid,
  keepClear: Set<number>
): PlacementCandidate[] {
  const cell = grid.cellSizeMm;
  const dimensions: Array<{ w: number; h: number; rotation: FurnitureRotation }> = [
    { w: cellsForMm(spec.widthMm, cell), h: cellsForMm(spec.depthMm, cell), rotation: 0 }
  ];
  if (dimensions[0]!.w !== dimensions[0]!.h) dimensions.push({ w: dimensions[0]!.h, h: dimensions[0]!.w, rotation: 90 });
  const sides: WallSide[] = ["NORTH", "SOUTH", "EAST", "WEST"];
  const result: PlacementCandidate[] = [];
  const accessDepth = cellsForMm(spec.accessDepthMm, cell);
  const doorCoords = [...keepClear].map((i) => grid.coords(i));

  for (const dim of dimensions) {
    for (let y = 0; y <= grid.height - dim.h; y++) {
      for (let x = 0; x <= grid.width - dim.w; x++) {
        const footprint = rectCells(grid, x, y, dim.w, dim.h)!;
        if (!footprint.every((c) => grid.labels[c] === room.label) || footprint.some((c) => keepClear.has(c))) continue;
        const candidateSides = spec.wallAttached ? sides : ["NORTH" as WallSide];
        for (const wallSide of candidateSides) {
          const contact = spec.wallAttached ? wallContactRatio(grid, room.label, x, y, dim.w, dim.h, wallSide) : 0;
          if (spec.wallAttached && contact < 0.75) continue;
          const variants = spec.accessMode === "BED" ? [false, true] : [false];
          for (const alternate of variants) {
            let interaction: number[] | undefined;
            if (spec.accessMode === "NONE") interaction = [];
            else if (spec.accessMode === "RING") interaction = ringCells(grid, x, y, dim.w, dim.h, accessDepth);
            else if (spec.accessMode === "BED") interaction = bedAccessCells(grid, x, y, dim.w, dim.h, wallSide, accessDepth, alternate);
            else interaction = stripOutsideFootprint(grid, x, y, dim.w, dim.h, frontSide(wallSide), accessDepth);
            if (!interaction || !interaction.every((c) => grid.labels[c] === room.label)) continue;
            const centerX = x + dim.w / 2;
            const centerY = y + dim.h / 2;
            const nearestDoor = doorCoords.length
              ? Math.min(...doorCoords.map((d) => Math.abs(d.x - centerX) + Math.abs(d.y - centerY)))
              : 0;
            const cornerBonus = spec.preferCorner
              ? sides.filter((s) => wallContactRatio(grid, room.label, x, y, dim.w, dim.h, s) >= 0.75).length * 8
              : 0;
            const placement: FurniturePlacement = {
              id: `${room.id}_${spec.kind.toLowerCase()}_${itemIndex}_${x}_${y}_${dim.rotation}_${wallSide}`,
              roomId: room.id,
              kind: spec.kind,
              xCell: x,
              yCell: y,
              widthCells: dim.w,
              heightCells: dim.h,
              rotation: dim.rotation,
              ...(spec.wallAttached ? { wallSide } : {}),
              footprintCells: footprint,
              interactionCells: interaction,
              mandatory: spec.mandatory
            };
            result.push({ placement, score: contact * 20 + nearestDoor * 0.3 + cornerBonus - interaction.length * 0.01 });
          }
        }
      }
    }
  }
  result.sort((a, b) => b.score - a.score || a.placement.id.localeCompare(b.placement.id));
  return result.slice(0, spec.kind === "DINING_TABLE" ? 24 : spec.kind === "WC" || spec.kind === "BASIN" || spec.kind === "SHOWER" ? 24 : 18);
}

function conflicts(candidate: FurniturePlacement, state: SearchState, keepClear: Set<number>): boolean {
  for (const cell of candidate.footprintCells) {
    if (state.occupied.has(cell) || state.reservedInteractions.has(cell) || keepClear.has(cell)) return true;
  }
  for (const cell of candidate.interactionCells) if (state.occupied.has(cell)) return true;
  return false;
}

function floodFree(grid: OccupancyGrid, label: number, blocked: Set<number>, starts: number[]): Set<number> {
  const visited = new Set<number>();
  const queue: number[] = [];
  for (const start of starts) {
    if (grid.labels[start] === label && !blocked.has(start) && !visited.has(start)) {
      visited.add(start);
      queue.push(start);
    }
  }
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++]!;
    for (const n of grid.neighbours4(cur)) {
      if (grid.labels[n] === label && !blocked.has(n) && !visited.has(n)) {
        visited.add(n);
        queue.push(n);
      }
    }
  }
  return visited;
}

function squareIsFree(grid: OccupancyGrid, label: number, blocked: Set<number>, x: number, y: number, size: number): boolean {
  if (x < 0 || y < 0 || x + size > grid.width || y + size > grid.height) return false;
  for (let yy = y; yy < y + size; yy++) for (let xx = x; xx < x + size; xx++) {
    const idx = grid.index(xx, yy);
    if (grid.labels[idx] !== label || blocked.has(idx)) return false;
  }
  return true;
}

function localClearanceCells(grid: OccupancyGrid, label: number, blocked: Set<number>, cellIndex: number, maxSize: number): number {
  const { x, y } = grid.coords(cellIndex);
  for (let size = maxSize; size >= 1; size--) {
    for (let oy = 0; oy < size; oy++) for (let ox = 0; ox < size; ox++) {
      if (squareIsFree(grid, label, blocked, x - ox, y - oy, size)) return size;
    }
  }
  return 0;
}

class MaxHeap {
  private readonly data: Array<{ cell: number; width: number }> = [];
  push(value: { cell: number; width: number }): void {
    this.data.push(value);
    let i = this.data.length - 1;
    while (i > 0) {
      const p = Math.floor((i - 1) / 2);
      if (this.data[p]!.width >= this.data[i]!.width) break;
      [this.data[p], this.data[i]] = [this.data[i]!, this.data[p]!];
      i = p;
    }
  }
  pop(): { cell: number; width: number } | undefined {
    if (!this.data.length) return undefined;
    const root = this.data[0]!;
    const last = this.data.pop()!;
    if (this.data.length) {
      this.data[0] = last;
      let i = 0;
      while (true) {
        let best = i;
        const l = i * 2 + 1;
        const r = l + 1;
        if (l < this.data.length && this.data[l]!.width > this.data[best]!.width) best = l;
        if (r < this.data.length && this.data[r]!.width > this.data[best]!.width) best = r;
        if (best === i) break;
        [this.data[i], this.data[best]] = [this.data[best]!, this.data[i]!];
        i = best;
      }
    }
    return root;
  }
}

function widestReachability(
  grid: OccupancyGrid,
  label: number,
  blocked: Set<number>,
  starts: Array<{ cell: number; widthCells: number }>,
  maxWidthCells: number
): Int16Array {
  const best = new Int16Array(grid.labels.length);
  const heap = new MaxHeap();
  for (const start of starts) {
    if (grid.labels[start.cell] !== label || blocked.has(start.cell)) continue;
    const width = Math.max(start.widthCells, localClearanceCells(grid, label, blocked, start.cell, maxWidthCells));
    best[start.cell] = width;
    heap.push({ cell: start.cell, width });
  }
  while (true) {
    const current = heap.pop();
    if (!current) break;
    if (current.width !== best[current.cell]) continue;
    for (const n of grid.neighbours4(current.cell)) {
      if (grid.labels[n] !== label || blocked.has(n)) continue;
      const local = localClearanceCells(grid, label, blocked, n, maxWidthCells);
      const width = Math.min(current.width, local);
      if (width > best[n]!) {
        best[n] = width;
        heap.push({ cell: n, width });
      }
    }
  }
  return best;
}

function roomMinimumWalkway(settings: ResolvedFurnishingSettings, room: SpaceRegion): number {
  if (room.type === "BATHROOM" || room.type === "ENSUITE") return settings.bathroom.accessible ? 900 : Math.min(500, settings.minimumWalkwayMm);
  if (room.type === "KITCHEN") return Math.max(550, Math.min(750, settings.minimumWalkwayMm));
  if (room.type === "PRIVATE_LOBBY" || room.type === "CORRIDOR" || room.type === "FOYER") return Math.max(900, settings.minimumWalkwayMm);
  return settings.minimumWalkwayMm;
}

function minimumWalkableAreaSqM(room: SpaceRegion, settings: ResolvedFurnishingSettings): number {
  const profileFactor = settings.clearanceProfile === "ULTRA_COMPACT" ? 0.75 : settings.clearanceProfile === "COMPACT" ? 0.9 : settings.clearanceProfile === "PREMIUM" ? 1.25 : settings.clearanceProfile === "ACCESSIBLE" ? 1.4 : 1;
  if (room.type === "BEDROOM") return 1.1 * profileFactor;
  if (room.type === "LIVING" || room.type === "FAMILY_LOUNGE") return 2.5 * profileFactor;
  if (room.type === "KITCHEN") return 0.8 * profileFactor;
  if (room.type === "BATHROOM" || room.type === "ENSUITE") return 0.55 * profileFactor;
  return 0.4;
}

function validateArrangement(
  room: SpaceRegion,
  grid: OccupancyGrid,
  doors: DoorPortal[],
  placements: FurniturePlacement[],
  settings: ResolvedFurnishingSettings
): { valid: boolean; connected: number; totalFree: number; score: number; notes: string[] } {
  const blocked = new Set(placements.flatMap((p) => p.footprintCells));
  const roomDoorData = doors
    .filter((d) => d.roomAId === room.id || d.roomBId === room.id)
    .map((d) => ({ cell: doorCellForRoom(d, room, grid), widthCells: Math.max(1, Math.floor(d.widthMm / grid.cellSizeMm)) }))
    .filter((d): d is { cell: number; widthCells: number } => d.cell !== undefined);
  if (!roomDoorData.length) return { valid: false, connected: 0, totalFree: 0, score: -Infinity, notes: ["Room has no physical door cell."] };

  const connected = floodFree(grid, room.label, blocked, roomDoorData.map((d) => d.cell));
  const allRoomCells = roomCells(grid, room.label);
  const totalFree = allRoomCells.length - blocked.size;
  const mandatoryTargets = placements.filter((p) => p.mandatory && p.interactionCells.length > 0);
  for (const target of mandatoryTargets) {
    if (!target.interactionCells.some((cell) => connected.has(cell))) {
      return { valid: false, connected: connected.size, totalFree, score: -Infinity, notes: [`${target.kind} has no connected interaction zone.`] };
    }
  }
  if (roomDoorData.some((d) => !connected.has(d.cell))) return { valid: false, connected: connected.size, totalFree, score: -Infinity, notes: ["Door portals are not connected through free room space."] };

  const minimumWalkwayMm = roomMinimumWalkway(settings, room);
  const requiredWidthCells = cellsForMm(minimumWalkwayMm, grid.cellSizeMm);
  const widest = widestReachability(grid, room.label, blocked, roomDoorData, Math.max(requiredWidthCells, 5));
  for (const target of mandatoryTargets) {
    const width = Math.max(...target.interactionCells.map((cell) => widest[cell] ?? 0));
    if (width < requiredWidthCells) {
      return { valid: false, connected: connected.size, totalFree, score: -Infinity, notes: [`Route to ${target.kind} is narrower than ${minimumWalkwayMm} mm.`] };
    }
  }

  const connectedAreaSqM = connected.size * grid.cellSizeMm * grid.cellSizeMm / 1_000_000;
  const minArea = minimumWalkableAreaSqM(room, settings);
  if (connectedAreaSqM + 1e-9 < minArea) {
    return { valid: false, connected: connected.size, totalFree, score: -Infinity, notes: [`Connected walkable area ${connectedAreaSqM.toFixed(2)} m² is below ${minArea.toFixed(2)} m².`] };
  }

  const interactionUnion = new Set(placements.flatMap((p) => p.interactionCells));
  const unreachableFree = totalFree - connected.size;
  let score = connected.size * 2 + interactionUnion.size * 0.1 - unreachableFree * 4 - placements.length * 0.25;

  // Living sofa ↔ TV: face each other within a real viewing band (1.8–4.5 m).
  if (room.type === "LIVING" || room.type === "FAMILY_LOUNGE") {
    const sofa = placements.find((p) => p.kind === "SOFA");
    const tv = placements.find((p) => p.kind === "TV_UNIT");
    if (sofa && tv) {
      const sofaCx = sofa.xCell + sofa.widthCells / 2;
      const sofaCy = sofa.yCell + sofa.heightCells / 2;
      const tvCx = tv.xCell + tv.widthCells / 2;
      const tvCy = tv.yCell + tv.heightCells / 2;
      const distMm = Math.hypot(sofaCx - tvCx, sofaCy - tvCy) * grid.cellSizeMm;
      if (distMm < 1800 || distMm > 4500) {
        return {
          valid: false,
          connected: connected.size,
          totalFree,
          score: -Infinity,
          notes: [`Sofa–TV viewing distance ${(distMm / 1000).toFixed(1)} m is outside 1.8–4.5 m.`],
        };
      }
      // Prefer opposite walls; adjacent is allowed if distance is in band.
      if (sofa.wallSide && tv.wallSide && tv.wallSide === frontSide(sofa.wallSide)) {
        score += 10;
      } else if (sofa.wallSide && tv.wallSide && tv.wallSide === sofa.wallSide) {
        return {
          valid: false,
          connected: connected.size,
          totalFree,
          score: -Infinity,
          notes: ["Sofa and TV cannot share the same wall."],
        };
      }
      score += 8 - Math.abs(distMm - 3000) / 500;
    }
  }

  return { valid: true, connected: connected.size, totalFree, score, notes: [`Connected walkable area ${connectedAreaSqM.toFixed(2)} m².`, `Widest required routes meet ${minimumWalkwayMm} mm.`] };
}

function shapeThreshold(room: SpaceRegion): number {
  if (room.type === "BATHROOM" || room.type === "ENSUITE") return 20;
  if (room.type === "BEDROOM") return 22;
  if (room.type === "KITCHEN") return 28;
  if (room.type === "LIVING" || room.type === "FAMILY_LOUNGE") return 34;
  return 40;
}

function searchRoom(
  room: SpaceRegion,
  grid: OccupancyGrid,
  doors: DoorPortal[],
  settings: ResolvedFurnishingSettings
): { solution?: RoomFurnishingSolution; reason?: string } {
  if (!room.polygon) return { reason: "Room polygon is missing." };
  const shape = calculateRoomShapeMetrics(room.polygon, grid.cellSizeMm * 2);
  if (shape.complexityScore > shapeThreshold(room)) return { reason: `Shape complexity ${shape.complexityScore.toFixed(1)} exceeds ${shapeThreshold(room)}.` };

  const specs = specsForRoom(room, settings).sort((a, b) => (b.widthMm * b.depthMm) - (a.widthMm * a.depthMm));
  const keepClear = doorKeepClearCells(room, doors, grid);
  const roomDoorCells = doors
    .filter((d) => d.roomAId === room.id || d.roomBId === room.id)
    .map((d) => doorCellForRoom(d, room, grid))
    .filter((c): c is number => c !== undefined);
  if (!roomDoorCells.length) return { reason: "Room has no physical access portal." };

  if (!specs.length) {
    const arrangement = validateArrangement(room, grid, doors, [], settings);
    if (!arrangement.valid) return { reason: arrangement.notes.join(" ") };
    return {
      solution: {
        roomId: room.id,
        placements: [],
        doorCells: roomDoorCells,
        connectedWalkableCells: arrangement.connected,
        connectedWalkableAreaSqM: arrangement.connected * grid.cellSizeMm * grid.cellSizeMm / 1_000_000,
        totalFreeCells: arrangement.totalFree,
        minimumWalkwayMm: roomMinimumWalkway(settings, room),
        mandatoryKinds: [],
        arrangementScore: arrangement.score - shape.complexityScore,
        shape,
        notes: arrangement.notes
      }
    };
  }

  const lists = specs.map((spec, index) => enumerateCandidates(room, spec, index, grid, keepClear));
  const missingIndex = lists.findIndex((list) => list.length === 0);
  if (missingIndex >= 0) return { reason: `No legal placement exists for ${specs[missingIndex]!.kind}.` };

  let best: RoomFurnishingSolution | undefined;
  let evaluated = 0;
  const maxEvaluations = room.type === "BATHROOM" || room.type === "ENSUITE" ? 5000 : 2500;

  const dfs = (index: number, state: SearchState): void => {
    if (evaluated >= maxEvaluations || best) return;
    if (index === lists.length) {
      evaluated++;
      const arrangement = validateArrangement(room, grid, doors, state.placements, settings);
      if (!arrangement.valid) return;
      const candidateScore = arrangement.score - shape.complexityScore;
      if (!best) {
        best = {
          roomId: room.id,
          placements: state.placements.map((p) => ({ ...p, footprintCells: [...p.footprintCells], interactionCells: [...p.interactionCells] })),
          doorCells: roomDoorCells,
          connectedWalkableCells: arrangement.connected,
          connectedWalkableAreaSqM: arrangement.connected * grid.cellSizeMm * grid.cellSizeMm / 1_000_000,
          totalFreeCells: arrangement.totalFree,
          minimumWalkwayMm: roomMinimumWalkway(settings, room),
          mandatoryKinds: specs.filter((s) => s.mandatory).map((s) => s.kind),
          arrangementScore: candidateScore,
          shape,
          notes: [...arrangement.notes, `Evaluated ${evaluated} complete arrangements.`]
        };
      }
      return;
    }
    for (const option of lists[index]!) {
      if (conflicts(option.placement, state, keepClear)) continue;
      const nextOccupied = new Set(state.occupied);
      option.placement.footprintCells.forEach((c) => nextOccupied.add(c));
      const nextInteractions = new Set(state.reservedInteractions);
      option.placement.interactionCells.forEach((c) => nextInteractions.add(c));
      dfs(index + 1, { placements: [...state.placements, option.placement], occupied: nextOccupied, reservedInteractions: nextInteractions });
      if (evaluated >= maxEvaluations || best) break;
    }
  };

  dfs(0, { placements: [], occupied: new Set(), reservedInteractions: new Set() });
  return best ? { solution: best } : { reason: `No arrangement of ${specs.map((s) => s.kind).join(", ")} preserves access, clearance and connected walkable space.` };
}

export function furnishingContentHash(
  settings: ResolvedFurnishingSettings,
  rooms: RoomFurnishingSolution[]
): string {
  return stableHash([
    settings.clearanceProfile,
    settings.minimumWalkwayMm,
    settings.bedroom.bedType,
    settings.bedroom.wardrobeLengthMm,
    settings.kitchen.minimumCounterLengthMm,
    settings.bathroom.requireBathtub,
    settings.bathroom.requireJacuzzi,
    settings.bathroom.requireDoubleBasin,
    ...rooms.flatMap((room) => [
      room.roomId,
      Math.round(room.connectedWalkableAreaSqM * 1000),
      Math.round(room.shape.complexityScore * 100),
      ...room.placements.flatMap((p) => [p.kind, p.xCell, p.yCell, p.widthCells, p.heightCells, p.rotation, ...p.footprintCells])
    ])
  ]);
}

export class FurnishingFeasibilitySolver {
  solve(
    brief: NormalizedBrief,
    grid: OccupancyGrid,
    spaces: SpaceRegion[],
    doors: DoorPortal[]
  ): ReasoningResult<FurnishingCertificate> {
    const fatalErrors: ReasoningIssue[] = [];
    const rooms: RoomFurnishingSolution[] = [];
    const blockedCells = new Set<number>();

    for (const room of spaces) {
      const result = searchRoom(room, grid, doors, brief.furnishing);
      if (!result.solution) {
        fatalErrors.push(issue("FURNISHING_INFEASIBLE", `${room.id} is not practically furnishable: ${result.reason ?? "unknown reason"}`, [room.id], {
          roomType: room.type,
          profile: brief.furnishing.clearanceProfile
        }));
        continue;
      }
      rooms.push(result.solution);
      for (const placement of result.solution.placements) for (const cell of placement.footprintCells) blockedCells.add(cell);
    }

    if (fatalErrors.length) {
      return {
        passed: false,
        fatalErrors,
        repairableErrors: [],
        warnings: [],
        metrics: { passedRooms: rooms.length, requiredRooms: spaces.length }
      };
    }

    const hash = furnishingContentHash(brief.furnishing, rooms);
    const certificate: FurnishingCertificate = {
      valid: true,
      settings: brief.furnishing,
      rooms,
      blockedCells: [...blockedCells].sort((a, b) => a - b),
      hash
    };
    return {
      passed: true,
      value: certificate,
      fatalErrors: [],
      repairableErrors: [],
      warnings: [],
      metrics: { passedRooms: rooms.length, placementCount: rooms.reduce((n, r) => n + r.placements.length, 0) }
    };
  }
}
