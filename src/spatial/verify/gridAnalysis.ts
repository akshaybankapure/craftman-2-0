import type { NormalizedBrief, ReasoningIssue, ReasoningResult, SpaceRegion, UsabilityMetric } from "../types.ts";
import { OccupancyGrid, UNASSIGNED_LABEL } from "../grid/OccupancyGrid.ts";
import { calculateRoomShapeMetrics } from "../geometry/shapeMetrics.ts";

export function componentCount(grid: OccupancyGrid, label: number): number {
  const visited = new Uint8Array(grid.labels.length);
  let count = 0;
  for (let i = 0; i < grid.labels.length; i++) {
    if (grid.labels[i] !== label || visited[i]) continue;
    count++;
    const queue = [i];
    visited[i] = 1;
    while (queue.length) {
      const cur = queue.shift()!;
      for (const n of grid.neighbours4(cur)) {
        if (!visited[n] && grid.labels[n] === label) {
          visited[n] = 1;
          queue.push(n);
        }
      }
    }
  }
  return count;
}

export function touchesExterior(grid: OccupancyGrid, label: number): boolean {
  for (let i = 0; i < grid.labels.length; i++) {
    if (grid.labels[i] !== label) continue;
    const { x, y } = grid.coords(i);
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;
    if (dirs.some(([dx, dy]) => {
      const nx = x + dx;
      const ny = y + dy;
      return !grid.inBounds(nx, ny) || !grid.isInside(grid.index(nx, ny));
    })) return true;
  }
  return false;
}

function largestRectangleCells(grid: OccupancyGrid, label: number): { width: number; height: number; area: number } {
  const heights = new Int32Array(grid.width);
  let best = { width: 0, height: 0, area: 0 };
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const idx = grid.index(x, y);
      heights[x] = grid.labels[idx] === label ? heights[x]! + 1 : 0;
    }
    const stack: number[] = [];
    for (let x = 0; x <= grid.width; x++) {
      const current = x === grid.width ? 0 : heights[x]!;
      while (stack.length && heights[stack[stack.length - 1]!]! > current) {
        const top = stack.pop()!;
        const h = heights[top]!;
        const left = stack.length ? stack[stack.length - 1]! + 1 : 0;
        const w = x - left;
        if (w * h > best.area) best = { width: w, height: h, area: w * h };
      }
      stack.push(x);
    }
  }
  return best;
}

function boundingDimensions(grid: OccupancyGrid, label: number): { width: number; height: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < grid.labels.length; i++) {
    if (grid.labels[i] !== label) continue;
    const { x, y } = grid.coords(i);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { width: maxX - minX + 1, height: maxY - minY + 1 };
}

function templateFits(space: SpaceRegion, wMm: number, hMm: number): { pass: boolean; note: string } {
  const a = Math.max(wMm, hMm);
  const b = Math.min(wMm, hMm);
  let needA = 0;
  let needB = 0;
  switch (space.type) {
    case "BEDROOM": needA = 3000; needB = space.requirement.minWidthMm; break;
    case "LIVING": needA = 3600; needB = 3000; break;
    case "KITCHEN": needA = 2400; needB = 1800; break;
    case "BATHROOM":
    case "ENSUITE": needA = 2100; needB = 1500; break;
    case "DINING": needA = 2700; needB = 2400; break;
    case "STUDY": needA = 2400; needB = 2100; break;
    case "UTILITY": needA = 1800; needB = 1200; break;
    case "FOYER": needA = 1500; needB = 1200; break;
    case "PRIVATE_LOBBY":
    case "CORRIDOR": needA = 1500; needB = space.requirement.minWidthMm; break;
    default: needA = 1500; needB = 1000;
  }
  return { pass: a >= needA && b >= needB, note: `largest usable rectangle ${Math.round(a)}×${Math.round(b)} mm; requires ${needA}×${needB} mm` };
}

export function validateGridAndUsability(
  brief: NormalizedBrief,
  grid: OccupancyGrid,
  spaces: SpaceRegion[]
): ReasoningResult<UsabilityMetric[]> {
  const fatalErrors: ReasoningIssue[] = [];
  const warnings: ReasoningIssue[] = [];
  let outsideAssigned = 0;
  let unassignedInside = 0;
  for (let i = 0; i < grid.labels.length; i++) {
    if (!grid.isInside(i) && grid.labels[i]! >= 0) outsideAssigned++;
    if (grid.isInside(i) && grid.labels[i] === UNASSIGNED_LABEL) unassignedInside++;
  }
  if (outsideAssigned) fatalErrors.push({ code: "GRID_OUTSIDE_ASSIGNMENT", stage: "GRID", message: "Cells outside the envelope are assigned.", affectedIds: [], evidence: { outsideAssigned } });
  if (unassignedInside) fatalErrors.push({ code: "GRID_UNASSIGNED_INSIDE", stage: "GRID", message: "Inside-envelope cells remain unassigned.", affectedIds: [], evidence: { unassignedInside } });

  const metrics: UsabilityMetric[] = [];
  const cellAreaSqM = (grid.cellSizeMm * grid.cellSizeMm) / 1_000_000;
  for (const space of spaces) {
    const components = componentCount(grid, space.label);
    if (components !== 1) fatalErrors.push({ code: "GRID_DISCONNECTED_ROOM", stage: "GEOMETRY", message: `${space.id} has ${components} connected components.`, affectedIds: [space.id], evidence: { components } });
    const areaSqM = space.cellCount * cellAreaSqM;
    if (areaSqM + 1e-9 < space.requirement.minAreaSqM) fatalErrors.push({ code: "ROOM_MIN_AREA", stage: "GEOMETRY", message: `${space.id} is below minimum area.`, affectedIds: [space.id], evidence: { areaSqM, minAreaSqM: space.requirement.minAreaSqM } });
    if (areaSqM - 1e-9 > space.requirement.maxAreaSqM && space.type !== "FAMILY_LOUNGE") warnings.push({ code: "ROOM_MAX_AREA", stage: "GEOMETRY", message: `${space.id} exceeds its useful maximum area.`, affectedIds: [space.id], evidence: { areaSqM, maxAreaSqM: space.requirement.maxAreaSqM } });
    if (space.requirement.exteriorAccess === "REQUIRED" && !touchesExterior(grid, space.label)) fatalErrors.push({ code: "ROOM_EXTERIOR_REQUIRED", stage: "GEOMETRY", message: `${space.id} requires an exterior wall.`, affectedIds: [space.id] });

    const largest = largestRectangleCells(grid, space.label);
    const wMm = largest.width * grid.cellSizeMm;
    const hMm = largest.height * grid.cellSizeMm;
    const box = boundingDimensions(grid, space.label);
    // Score usable furniture rectangle, not the possibly-L bounding box.
    const usableW = Math.max(1, largest.width);
    const usableH = Math.max(1, largest.height);
    const ratio = Math.max(usableW, usableH) / Math.min(usableW, usableH);
    const fillRatio = space.cellCount / Math.max(1, box.width * box.height);
    const minFillRatio = space.type === "BEDROOM" ? 0.74
      : space.type === "BATHROOM" || space.type === "ENSUITE" ? 0.78
      : space.type === "KITCHEN" ? 0.72
      : space.type === "LIVING" ? 0.68
      : space.type === "FOYER" || space.type === "PRIVATE_LOBBY" ? 0.68
      : 0.6;
    if (fillRatio < minFillRatio) fatalErrors.push({ code: "ROOM_LOW_RECTANGULARITY", stage: "USABILITY", message: `${space.id} is excessively notched or wraps around other rooms.`, affectedIds: [space.id], evidence: { fillRatio, minFillRatio } });
    const fit = templateFits(space, wMm, hMm);
    if (!fit.pass) fatalErrors.push({ code: "ROOM_FURNITURE_FIT", stage: "USABILITY", message: `${space.id} cannot fit its essential template.`, affectedIds: [space.id], evidence: { largestRectangleWidthMm: wMm, largestRectangleHeightMm: hMm, note: fit.note } });
    if (ratio > space.requirement.hardMaxAspectRatio && space.type !== "CORRIDOR" && space.type !== "PRIVATE_LOBBY") {
      fatalErrors.push({
        code: "ROOM_ASPECT_RATIO",
        stage: "USABILITY",
        message: `${space.id} has impractical bounding aspect ratio ${ratio.toFixed(2)}.`,
        affectedIds: [space.id],
        evidence: { ratio, hardMax: space.requirement.hardMaxAspectRatio },
      });
    }
    const longSideMm = Math.max(wMm, hMm);
    if (space.type !== "CORRIDOR" && space.type !== "PRIVATE_LOBBY" && longSideMm > space.requirement.maxSideMm + 1) {
      fatalErrors.push({
        code: "ROOM_MAX_SIDE",
        stage: "USABILITY",
        message: `${space.id} usable long side ${(longSideMm / 1000).toFixed(2)} m exceeds ${(space.requirement.maxSideMm / 1000).toFixed(2)} m.`,
        affectedIds: [space.id],
        evidence: { longSideMm, maxSideMm: space.requirement.maxSideMm },
      });
    }

    const shape = space.polygon ? calculateRoomShapeMetrics(space.polygon, grid.cellSizeMm * 2) : { vertexCount: 0, reflexCornerCount: 0, complexityScore: 0 };
    metrics.push({
      roomId: space.id,
      largestRectangleWidthMm: wMm,
      largestRectangleHeightMm: hMm,
      boundingAspectRatio: ratio,
      furnitureTemplatePassed: fit.pass,
      connectedWalkableAreaSqM: 0,
      shapeComplexityScore: shape.complexityScore,
      polygonVertexCount: shape.vertexCount,
      reflexCornerCount: shape.reflexCornerCount,
      notes: [fit.note, `rectangularity ${(fillRatio * 100).toFixed(1)}%`]
    });
  }

  return {
    passed: fatalErrors.length === 0,
    ...(fatalErrors.length === 0 ? { value: metrics } : {}),
    fatalErrors,
    repairableErrors: [],
    warnings,
    metrics: { outsideAssigned, unassignedInside, roomCount: spaces.length, carpetAreaSqM: brief.carpetAreaSqM }
  };
}
