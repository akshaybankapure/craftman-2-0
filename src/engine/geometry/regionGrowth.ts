/**
 * Competitive seeded region growth on the planning grid.
 */

import type { AreaBudget } from '../../planner/types.ts';
import { budgetFor } from '../../planner/budget/areaBudget.ts';
import type { AccessNodeCategory, AccessTree, RoomRect } from '../../planner/types.ts';
import { categoryToLiveType } from '../../planner/types.ts';
import type { CirculationSkeleton } from '../circulation/skeleton.ts';
import type { ContextProfile } from '../context/contextProfile.ts';
import {
  cellCount,
  cellIndex,
  cellsBoundingRect,
  indexToCell,
  neighbors4,
  type PlanningGrid,
} from '../kernel/grid.ts';
import {
  cellsToOrthoRects,
  preferRectangle,
  type Rect,
} from '../kernel/orthoPolygon.ts';
import { RNG } from '../kernel/rngStreams.ts';
import type { MissionGraph } from '../topology/missionTypes.ts';
import type { InfluenceMap } from '../zoning/influenceMap.ts';
import { bestCellsFor, type SuitabilityKey } from '../zoning/influenceMap.ts';
import { evaluateRoomShape } from './shapeRules.ts';

function suitKey(cat: AccessNodeCategory): SuitabilityKey | null {
  switch (cat) {
    case 'LIVING': return 'LIVING';
    case 'BEDROOM': return 'BEDROOM';
    case 'KITCHEN': return 'KITCHEN';
    case 'COMMON_BATHROOM': return 'COMMON_BATHROOM';
    case 'ENSUITE_BATHROOM': return 'ENSUITE';
    case 'CORRIDOR': return 'CORRIDOR';
    case 'ENTRY':
    case 'FOYER': return 'ENTRY';
    case 'UTILITY': return 'UTILITY';
    default: return null;
  }
}

export interface GrowthResult {
  rooms: RoomRect[];
  owner: Int32Array; // cell → room index (-1 empty, -2 circulation reserve)
  ok: boolean;
  reason?: string;
}

interface Seed {
  nodeId: string;
  category: AccessNodeCategory;
  cx: number;
  cy: number;
  targetCells: number;
  minCells: number;
  maxCells: number;
}

export function growRoomRegions(params: {
  ctx: ContextProfile;
  mission: MissionGraph;
  topology: AccessTree;
  budgets: AreaBudget[];
  influence: InfluenceMap;
  circulation: CirculationSkeleton;
  seed: number;
}): GrowthResult {
  const { ctx, topology, budgets, influence, circulation, seed } = params;
  const rng = new RNG(seed);
  const g = influence.grid;
  const n = cellCount(g);
  const owner = new Int32Array(n).fill(-1);

  // Reserve circulation cells
  for (const i of circulation.walkableCells) {
    owner[i] = -2;
  }

  const seeds = placeSeeds(topology, budgets, influence, circulation, g, owner, rng);
  if (seeds.length === 0) {
    return { rooms: [], owner, ok: false, reason: 'No seeds placed' };
  }

  // Claim seed cells
  const regions: number[][] = seeds.map(() => []);
  for (let si = 0; si < seeds.length; si++) {
    const s = seeds[si]!;
    const i = cellIndex(g, s.cx, s.cy);
    if (owner[i] === -1 || owner[i] === -2) {
      // Entry may sit on circulation reserve — allow claim
      owner[i] = si;
      regions[si]!.push(i);
    } else {
      // Find nearby free cell
      const alt = findNearFree(g, owner, s.cx, s.cy, 4);
      if (!alt) return { rooms: [], owner, ok: false, reason: `Seed blocked for ${s.nodeId}` };
      seeds[si] = { ...s, cx: alt.cx, cy: alt.cy };
      const ni = cellIndex(g, alt.cx, alt.cy);
      owner[ni] = si;
      regions[si]!.push(ni);
    }
  }

  // Competitive growth rounds
  const maxRounds = Math.ceil(n * 1.5);
  for (let round = 0; round < maxRounds; round++) {
    let grew = false;
    const order = rng.shuffle(seeds.map((_, i) => i));
    for (const si of order) {
      const s = seeds[si]!;
      if (regions[si]!.length >= s.targetCells) continue;

      const candidate = bestGrowthCell(g, owner, regions[si]!, s, influence, budgets, circulation);
      if (candidate == null) continue;

      // Don't steal from rooms below their min unless we're under min too
      const curOwner = owner[candidate];
      if (curOwner >= 0) {
        const victim = seeds[curOwner]!;
        if (regions[curOwner]!.length <= victim.minCells) continue;
        // Remove from victim
        regions[curOwner] = regions[curOwner]!.filter(c => c !== candidate);
      } else if (curOwner === -2) {
        // Only ENTRY / CORRIDOR categories may absorb reserved circulation
        if (s.category !== 'ENTRY' && s.category !== 'FOYER' && s.category !== 'CORRIDOR') {
          continue;
        }
        if (!circulation.materialiseCorridorRoom && s.category === 'CORRIDOR') {
          continue;
        }
      }

      owner[candidate] = si;
      regions[si]!.push(candidate);
      grew = true;
    }
    if (!grew) break;

    // Stop when all at target or no free cells
    if (seeds.every((s, i) => regions[i]!.length >= s.targetCells)) break;
  }

  // Assign leftover free cells to neediest neighbour room
  for (let i = 0; i < n; i++) {
    if (owner[i] !== -1) continue;
    if (owner[i] === -2) continue;
    const { cx, cy } = indexToCell(g, i);
    let bestSi = -1;
    let bestNeed = -Infinity;
    for (const nb of neighbors4(g, cx, cy)) {
      const oi = owner[cellIndex(g, nb.cx, nb.cy)];
      if (oi < 0) continue;
      const s = seeds[oi]!;
      const need = s.targetCells - regions[oi]!.length;
      if (need > bestNeed) {
        bestNeed = need;
        bestSi = oi;
      }
    }
    if (bestSi >= 0 && bestNeed > -slo(seeds[bestSi]!)) {
      owner[i] = bestSi;
      regions[bestSi]!.push(i);
    }
  }

  // Materialise corridor from remaining -2 cells if demanded
  let corridorSeedIdx = seeds.findIndex(s => s.category === 'CORRIDOR');
  if (circulation.materialiseCorridorRoom) {
    if (corridorSeedIdx < 0) {
      // Create synthetic corridor seed from topology
      const corrNode = topology.nodes.find(n => n.category === 'CORRIDOR');
      if (corrNode) {
        const b = budgetFor(budgets, corrNode.id);
        seeds.push({
          nodeId: corrNode.id,
          category: 'CORRIDOR',
          cx: influence.entranceCell.cx,
          cy: influence.entranceCell.cy,
          targetCells: Math.max(2, Math.round(b.targetArea / (g.cellSize * g.cellSize))),
          minCells: Math.max(1, Math.round(b.minArea / (g.cellSize * g.cellSize))),
          maxCells: Math.round(b.maxArea / (g.cellSize * g.cellSize)),
        });
        corridorSeedIdx = seeds.length - 1;
        regions.push([]);
      }
    }
    if (corridorSeedIdx >= 0) {
      for (const i of circulation.walkableCells) {
        if (owner[i] === -2 || owner[i] === -1) {
          owner[i] = corridorSeedIdx;
          regions[corridorSeedIdx]!.push(i);
        }
      }
    }
  } else {
    // Absorb reserved circulation into adjacent living
    const livingIdx = seeds.findIndex(s => s.category === 'LIVING');
    if (livingIdx >= 0) {
      for (let i = 0; i < n; i++) {
        if (owner[i] === -2) {
          owner[i] = livingIdx;
          regions[livingIdx]!.push(i);
        }
      }
    }
  }

  // Convert regions → RoomRect
  const rooms: RoomRect[] = [];
  for (let si = 0; si < seeds.length; si++) {
    const s = seeds[si]!;
    const cells = regions[si]!;
    if (cells.length === 0) {
      return { rooms: [], owner, ok: false, reason: `Empty region ${s.nodeId}` };
    }
    let parts = cellsToOrthoRects(g.cols, g.rows, g.cellSize, cells);
    parts = preferRectangle(parts);
    const bb = cellsBoundingRect(g, cells);
    if (!bb) {
      return { rooms: [], owner, ok: false, reason: `No bounds ${s.nodeId}` };
    }
    const primary: Rect = parts.length === 1 ? parts[0]! : bb;
    const area = parts.reduce((sum, p) => sum + p.w * p.h, 0);
    const shape = evaluateRoomShape(s.category, primary, area);
    // Soft: do not abort the whole seed for one room — validateFloorPlan hard-gates aspect/max-side.
    void shape;

    const b = budgetFor(budgets, s.nodeId);
    const room: RoomRect = {
      id: s.nodeId,
      category: s.category,
      type: categoryToLiveType(s.category),
      x: primary.x,
      y: primary.y,
      w: primary.w,
      h: primary.h,
      targetArea: b.targetArea,
      minDimension: Math.min(b.minWidth, b.minHeight),
    };
    if (parts.length > 1) room.parts = parts;
    rooms.push(room);
  }

  // Clip to outline
  for (const r of rooms) {
    r.x = Math.max(0, r.x);
    r.y = Math.max(0, r.y);
    r.w = Math.min(r.w, ctx.outlineW - r.x);
    r.h = Math.min(r.h, ctx.outlineH - r.y);
  }

  return { rooms, owner, ok: true };
}

function slo(s: Seed): number {
  return s.maxCells - s.targetCells;
}

function placeSeeds(
  topology: AccessTree,
  budgets: AreaBudget[],
  influence: InfluenceMap,
  circulation: CirculationSkeleton,
  g: PlanningGrid,
  owner: Int32Array,
  rng: RNG,
): Seed[] {
  const cellArea = g.cellSize * g.cellSize;
  const taken = new Set<number>();
  const seeds: Seed[] = [];

  const order: AccessNodeCategory[] = [
    'ENTRY',
    'FOYER',
    'LIVING',
    'KITCHEN',
    'BEDROOM',
    'COMMON_BATHROOM',
    'ENSUITE_BATHROOM',
    'UTILITY',
    'CORRIDOR',
    'BALCONY',
  ];

  for (const cat of order) {
    const nodes = topology.nodes.filter(n => n.category === cat);
    for (const node of nodes) {
      if (cat === 'CORRIDOR' && !circulation.materialiseCorridorRoom) continue;
      if (cat === 'BALCONY') continue; // optional later

      const b = budgetFor(budgets, node.id);
      const key = suitKey(cat);

      let cx: number;
      let cy: number;
      if (cat === 'ENTRY') {
        cx = influence.entranceCell.cx;
        cy = influence.entranceCell.cy;
      } else if (key) {
        const picks = bestCellsFor(influence, key, 12, taken);
        const pick = picks[rng.int(0, Math.min(6, picks.length))] ?? picks[0];
        if (!pick) continue;
        cx = pick.cx;
        cy = pick.cy;
      } else {
        cx = rng.int(1, g.cols - 1);
        cy = rng.int(1, g.rows - 1);
      }

      // Keep bedrooms away from entrance a bit
      if (cat === 'BEDROOM') {
        const picks = bestCellsFor(influence, 'BEDROOM', 20, taken).filter(
          c => c.privacyDepth > 0.25,
        );
        const pick = picks[rng.int(0, Math.min(8, picks.length))] ?? picks[0];
        if (pick) {
          cx = pick.cx;
          cy = pick.cy;
        }
      }

      taken.add(cy * g.cols + cx);
      seeds.push({
        nodeId: node.id,
        category: cat,
        cx,
        cy,
        targetCells: Math.max(2, Math.round(b.targetArea / cellArea)),
        minCells: Math.max(1, Math.round(b.minArea / cellArea)),
        maxCells: Math.max(2, Math.round(b.maxArea / cellArea)),
      });
    }
  }

  return seeds;
}

function findNearFree(
  g: PlanningGrid,
  owner: Int32Array,
  cx: number,
  cy: number,
  radius: number,
): { cx: number; cy: number } | null {
  for (let r = 0; r <= radius; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= g.cols || y >= g.rows) continue;
        const i = cellIndex(g, x, y);
        if (owner[i] === -1 || owner[i] === -2) return { cx: x, cy: y };
      }
    }
  }
  return null;
}

function bestGrowthCell(
  g: PlanningGrid,
  owner: Int32Array,
  region: number[],
  seed: Seed,
  influence: InfluenceMap,
  _budgets: AreaBudget[],
  circulation: CirculationSkeleton,
): number | null {
  let best: number | null = null;
  let bestU = -Infinity;
  const frontier = new Set<number>();
  for (const i of region) {
    const { cx, cy } = indexToCell(g, i);
    for (const nb of neighbors4(g, cx, cy)) {
      frontier.add(cellIndex(g, nb.cx, nb.cy));
    }
  }

  const key = suitKey(seed.category);

  for (const i of frontier) {
    if (region.includes(i)) continue;
    const cur = owner[i]!;
    if (cur === -2 && seed.category !== 'CORRIDOR' && seed.category !== 'ENTRY' && seed.category !== 'FOYER') {
      continue;
    }
    if (cur >= 0) {
      // Contested — only take if we're under min
      if (region.length >= seed.minCells) continue;
    }

    const { cx, cy } = indexToCell(g, i);
    const cell = influence.cells[i]!;
    let u = 0;
    u += (seed.targetCells - region.length) * 0.15;
    if (key) u += (cell.suitability[key] ?? 0) * 2;

    // Compactness: prefer cells that touch more of our region
    let touch = 0;
    for (const nb of neighbors4(g, cx, cy)) {
      if (owner[cellIndex(g, nb.cx, nb.cy)] === owner[region[0]!]) touch++;
      // fix: compare to seed index via region ownership
    }
    // recount properly
    touch = 0;
    for (const nb of neighbors4(g, cx, cy)) {
      const oi = owner[cellIndex(g, nb.cx, nb.cy)];
      if (oi >= 0 && region.includes(cellIndex(g, nb.cx, nb.cy)) === false) {
        // check if neighbour is in our region
      }
      if (region.includes(cellIndex(g, nb.cx, nb.cy))) touch++;
    }
    u += touch * 0.5;

    // Bathroom: prefer wet core, avoid façade
    if (seed.category === 'COMMON_BATHROOM' || seed.category === 'ENSUITE_BATHROOM') {
      u += cell.wetCorePotential;
      u -= cell.daylightPotential * 0.8;
    }

    // Corridor: stay on skeleton
    if (seed.category === 'CORRIDOR') {
      u += circulation.walkableCells.has(i) ? 2 : -3;
    }

    // Narrow neck penalty: if only 1 touch and region large
    if (touch <= 1 && region.length > 6) u -= 1.5;

    if (u > bestU) {
      bestU = u;
      best = i;
    }
  }
  return best;
}
