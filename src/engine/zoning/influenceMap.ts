/**
 * RTS-style influence map over the planning grid.
 */

import type { ContextProfile } from '../context/contextProfile.ts';
import {
  cellCenter,
  createGrid,
  facadeOfCell,
  isExteriorCell,
  type FacadeSide,
  type PlanningGrid,
} from '../kernel/grid.ts';
import type { MissionGraph, MissionNodeType } from '../topology/missionTypes.ts';

export type SuitabilityKey =
  | 'LIVING'
  | 'BEDROOM'
  | 'KITCHEN'
  | 'COMMON_BATHROOM'
  | 'ENSUITE'
  | 'CORRIDOR'
  | 'ENTRY'
  | 'UTILITY';

export interface InfluenceCell {
  cx: number;
  cy: number;
  exteriorExposure: number;
  entranceProximity: number;
  privacyDepth: number;
  daylightPotential: number;
  wetCorePotential: number;
  circulationAccessibility: number;
  noiseExposure: number;
  suitability: Partial<Record<SuitabilityKey, number>>;
}

export interface InfluenceMap {
  grid: PlanningGrid;
  cells: InfluenceCell[];
  entranceCell: { cx: number; cy: number };
  wetCoreCell: { cx: number; cy: number };
}

export function buildInfluenceMap(
  ctx: ContextProfile,
  _mission: MissionGraph,
  cellSize = 0.3,
): InfluenceMap {
  const grid = createGrid(ctx.outlineW, ctx.outlineH, cellSize);
  const entranceCell = entranceCellFor(grid, ctx.entranceDir);
  const wetCoreCell = {
    cx: Math.floor(grid.cols * (ctx.entranceDir === 'E' ? 0.35 : 0.65)),
    cy: Math.floor(grid.rows * (ctx.entranceDir === 'S' ? 0.35 : 0.55)),
  };

  const preferredFacades = new Set(
    ctx.strategy.daylight.preferredFacades as FacadeSide[],
  );

  const cells: InfluenceCell[] = [];
  for (let cy = 0; cy < grid.rows; cy++) {
    for (let cx = 0; cx < grid.cols; cx++) {
      const center = cellCenter(grid, cx, cy);
      const exterior = isExteriorCell(grid, cx, cy) ? 1 : 0;
      const facades = facadeOfCell(grid, cx, cy);
      const daylight =
        exterior *
        (facades.some(f => preferredFacades.has(f)) ? 1 : facades.length ? 0.55 : 0);

      const distEntrance =
        Math.abs(cx - entranceCell.cx) + Math.abs(cy - entranceCell.cy);
      const maxD = grid.cols + grid.rows;
      const entranceProximity = 1 - distEntrance / maxD;

      // Privacy increases away from entrance
      const privacyDepth = distEntrance / maxD;

      const distWet =
        Math.abs(cx - wetCoreCell.cx) + Math.abs(cy - wetCoreCell.cy);
      const wetCorePotential = 1 - distWet / maxD;

      // Circulation accessibility: prefer central band, not exterior frontage
      const edgePenalty = exterior * 0.7;
      const circulationAccessibility = Math.max(0, 0.85 - edgePenalty) *
        (0.4 + 0.6 * (1 - Math.abs(cx / grid.cols - 0.5)));

      const noiseExposure = entranceProximity * 0.6 + (facades.includes(ctx.entranceDir) ? 0.4 : 0);

      const suitability: InfluenceCell['suitability'] = {
        LIVING:
          daylight * 0.45 +
          entranceProximity * 0.25 +
          (1 - privacyDepth) * 0.2 +
          exterior * 0.1,
        BEDROOM:
          daylight * 0.35 +
          privacyDepth * 0.4 +
          (1 - noiseExposure) * 0.2 +
          exterior * 0.05,
        KITCHEN:
          wetCorePotential * 0.35 +
          daylight * 0.2 +
          (1 - privacyDepth) * 0.2 +
          exterior * 0.15,
        COMMON_BATHROOM:
          wetCorePotential * 0.5 +
          privacyDepth * 0.25 +
          (1 - daylight) * 0.15 +
          (1 - exterior) * 0.1,
        ENSUITE:
          wetCorePotential * 0.4 +
          privacyDepth * 0.4 +
          (1 - daylight) * 0.2,
        CORRIDOR:
          circulationAccessibility * 0.7 +
          (1 - exterior) * 0.3 -
          daylight * 0.2,
        ENTRY:
          entranceProximity * 0.8 +
          (facades.includes(ctx.entranceDir) ? 0.2 : 0),
        UTILITY:
          wetCorePotential * 0.5 + (1 - daylight) * 0.3 + (1 - exterior) * 0.2,
      };

      cells.push({
        cx,
        cy,
        exteriorExposure: exterior,
        entranceProximity,
        privacyDepth,
        daylightPotential: daylight,
        wetCorePotential,
        circulationAccessibility,
        noiseExposure,
        suitability,
      });
    }
  }

  return { grid, cells, entranceCell, wetCoreCell };
}

function entranceCellFor(
  grid: PlanningGrid,
  dir: FacadeSide,
): { cx: number; cy: number } {
  const mx = Math.floor(grid.cols / 2);
  const my = Math.floor(grid.rows / 2);
  switch (dir) {
    case 'S':
      return { cx: mx, cy: grid.rows - 1 };
    case 'N':
      return { cx: mx, cy: 0 };
    case 'E':
      return { cx: grid.cols - 1, cy: my };
    case 'W':
      return { cx: 0, cy: my };
  }
}

export function cellAt(map: InfluenceMap, cx: number, cy: number): InfluenceCell | undefined {
  if (cx < 0 || cy < 0 || cx >= map.grid.cols || cy >= map.grid.rows) return undefined;
  return map.cells[cy * map.grid.cols + cx];
}

export function bestCellsFor(
  map: InfluenceMap,
  key: SuitabilityKey,
  count: number,
  exclude: Set<number> = new Set(),
): InfluenceCell[] {
  const ranked = [...map.cells]
    .filter(c => !exclude.has(c.cy * map.grid.cols + c.cx))
    .sort((a, b) => (b.suitability[key] ?? 0) - (a.suitability[key] ?? 0));
  return ranked.slice(0, count);
}

export function suitabilityKeyFor(type: MissionNodeType): SuitabilityKey | null {
  switch (type) {
    case 'LIVING':
      return 'LIVING';
    case 'BEDROOM':
      return 'BEDROOM';
    case 'KITCHEN':
      return 'KITCHEN';
    case 'COMMON_BATHROOM':
      return 'COMMON_BATHROOM';
    case 'ENSUITE':
      return 'ENSUITE';
    case 'CORRIDOR':
    case 'PRIVATE_THRESHOLD':
      return 'CORRIDOR';
    case 'ENTRY':
    case 'FOYER':
      return 'ENTRY';
    case 'UTILITY':
      return 'UTILITY';
    default:
      return null;
  }
}
