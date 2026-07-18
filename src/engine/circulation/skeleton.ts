// Circulation skeleton: centreline network via A-star / Steiner approximation.
// Corridor polygons are only emitted when demand requires them.

import type { CirculationDemand } from './demandModel.ts';
import type { ContextProfile } from '../context/contextProfile.ts';
import {
  cellIndex,
  indexToCell,
  type CellCoord,
} from '../kernel/grid.ts';
import {
  defaultPathCost,
  dilateCorridor,
  pathToCentreline,
  steinerTreeApprox,
  type PathCostFn,
} from '../kernel/pathfinding.ts';
import { RNG } from '../kernel/rngStreams.ts';
import type { MissionGraph } from '../topology/missionTypes.ts';
import type { InfluenceMap } from '../zoning/influenceMap.ts';
import { bestCellsFor, cellAt } from '../zoning/influenceMap.ts';

export interface CirculationSkeleton {
  demand: CirculationDemand;
  centrelineCells: Set<number>;
  walkableCells: Set<number>;
  centreline: { x: number; y: number }[];
  widthM: number;
  /** False when living-integrated — no corridor room materialised. */
  materialiseCorridorRoom: boolean;
  junctions: CellCoord[];
}

export function generateCirculationSkeleton(
  ctx: ContextProfile,
  mission: MissionGraph,
  influence: InfluenceMap,
  demand: CirculationDemand,
  seed: number,
): CirculationSkeleton {
  const rng = new RNG(seed);
  const g = influence.grid;
  const widthM = ctx.strategy.geometry.corridorWidthRange.preferred;

  const costFn = buildCostFn(influence);

  const terminals: CellCoord[] = [{ ...influence.entranceCell }];

  const livingSeed = bestCellsFor(influence, 'LIVING', 1)[0];
  if (livingSeed) terminals.push({ cx: livingSeed.cx, cy: livingSeed.cy });

  const bedSeeds = bestCellsFor(influence, 'BEDROOM', Math.min(3, ctx.bhk), new Set());
  for (const b of bedSeeds) {
    if (rng.bool(0.85)) terminals.push({ cx: b.cx, cy: b.cy });
  }

  const bathSeed = bestCellsFor(influence, 'COMMON_BATHROOM', 1)[0];
  if (bathSeed) terminals.push({ cx: bathSeed.cx, cy: bathSeed.cy });

  const uniq = new Map<string, CellCoord>();
  for (const t of terminals) uniq.set(`${t.cx},${t.cy}`, t);
  const terms = [...uniq.values()];

  const tree = steinerTreeApprox(g, terms, costFn);
  const centrelineCells =
    tree?.treeCells ??
    new Set([cellIndex(g, influence.entranceCell.cx, influence.entranceCell.cy)]);

  const materialise =
    demand.kind === 'corridor' ||
    (demand.kind === 'private_threshold' && mission.hasDedicatedCirculation);

  const dilateW = materialise ? widthM : Math.min(widthM, 0.9);
  const walkableCells = dilateCorridor(g, centrelineCells, dilateW);

  if (materialise) {
    for (const i of [...walkableCells]) {
      const { cx, cy } = indexToCell(g, i);
      const cell = cellAt(influence, cx, cy);
      if (cell && cell.exteriorExposure > 0.5 && cell.daylightPotential > 0.7) {
        if (!centrelineCells.has(i)) walkableCells.delete(i);
      }
    }
  }

  const centreline = pathToCentreline(
    g,
    [...centrelineCells].map(i => indexToCell(g, i)),
  );

  const junctions: CellCoord[] = [];
  for (const i of centrelineCells) {
    const { cx, cy } = indexToCell(g, i);
    let n = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      if (centrelineCells.has(cellIndex(g, cx + dx, cy + dy))) n++;
    }
    if (n >= 3) junctions.push({ cx, cy });
  }

  return {
    demand,
    centrelineCells,
    walkableCells,
    centreline: simplifyPolyline(centreline),
    widthM: dilateW,
    materialiseCorridorRoom: materialise,
    junctions,
  };
}

function buildCostFn(influence: InfluenceMap): PathCostFn {
  const base = defaultPathCost(0.4);
  return (from, to, prevDir) => {
    let c = base(from, to, prevDir);
    const cell = cellAt(influence, to.cx, to.cy);
    if (!cell) return c + 5;
    c += cell.exteriorExposure * 1.2;
    c += cell.daylightPotential * 0.5;
    c -= cell.circulationAccessibility * 0.3;
    c += cell.privacyDepth < 0.15 ? 0.2 : 0;
    return Math.max(0.05, c);
  };
}

function simplifyPolyline(
  pts: { x: number; y: number }[],
): { x: number; y: number }[] {
  if (pts.length <= 2) return pts;
  const out = [pts[0]!];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1]!;
    const b = pts[i]!;
    const c = pts[i + 1]!;
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (Math.abs(cross) > 1e-6) out.push(b);
  }
  out.push(pts[pts.length - 1]!);
  return out;
}
