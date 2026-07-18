import type { DoorPortal, QualityScore, SpaceRegion, UsabilityMetric } from "../types.ts";
import { OccupancyGrid } from "../grid/OccupancyGrid.ts";
import { touchesExterior } from "../verify/gridAnalysis.ts";

export function evaluateQuality(grid: OccupancyGrid, spaces: SpaceRegion[], doors: DoorPortal[], usability: UsabilityMetric[]): QualityScore {
  let areaFit = 0;
  let compactness = 0;
  let exteriorAccess = 0;
  let privacy = 0;
  const cellAreaSqM = grid.cellSizeMm * grid.cellSizeMm / 1_000_000;

  for (const space of spaces) {
    const area = space.cellCount * cellAreaSqM;
    const err = Math.abs(area - space.requirement.targetAreaSqM) / Math.max(space.requirement.targetAreaSqM, 0.1);
    areaFit += Math.max(0, 1 - err);
    const metric = usability.find((m) => m.roomId === space.id)!;
    const aspectQuality = Math.max(0, 1 - Math.max(0, metric.boundingAspectRatio - 1) / Math.max(space.requirement.hardMaxAspectRatio - 1, 0.1));
    const shapeQuality = Math.max(0, 1 - metric.shapeComplexityScore / 40);
    const roomArea = Math.max(0.01, area);
    const walkableRatio = Math.min(1, metric.connectedWalkableAreaSqM / roomArea / 0.35);
    compactness += 0.5 * aspectQuality + 0.3 * shapeQuality + 0.2 * walkableRatio;
    if (space.requirement.exteriorAccess === "REQUIRED" || space.requirement.exteriorAccess === "PREFERRED") exteriorAccess += touchesExterior(grid, space.label) ? 1 : 0;
  }
  const n = Math.max(1, spaces.length);
  const circulationSpaces = spaces.filter((s) => s.type === "CORRIDOR" || s.type === "PRIVATE_LOBBY" || s.type === "FOYER");
  const circulationCells = circulationSpaces.reduce((sum, s) => sum + s.cellCount, 0);
  const circulation = Math.max(0, 1 - circulationCells / Math.max(1, grid.insideCellCount()) / 0.15);
  const exteriorEligible = spaces.filter((s) => s.requirement.exteriorAccess === "REQUIRED" || s.requirement.exteriorAccess === "PREFERRED").length || 1;

  const entryDoor = doors.find((d) => d.exterior);
  if (entryDoor) {
    const bedroomDoorCount = doors.filter((d) => !d.exterior && [d.roomAId, d.roomBId].some((id) => spaces.find((s) => s.id === id)?.type === "BEDROOM")).length;
    privacy = bedroomDoorCount > 0 ? 0.8 : 0.5;
  }

  areaFit /= n;
  compactness /= n;
  exteriorAccess /= exteriorEligible;
  const total = 100 * (0.35 * areaFit + 0.2 * compactness + 0.2 * exteriorAccess + 0.15 * circulation + 0.1 * privacy);
  return { total, areaFit, compactness, exteriorAccess, circulation, privacy };
}
