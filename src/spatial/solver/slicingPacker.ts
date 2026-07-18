import type { AccessGraph, NormalizedBrief, ProgrammeBudget, RoomRequirement, SpaceRegion, TopologyFamily } from "../types.ts";
import { OccupancyGrid } from "../grid/OccupancyGrid.ts";
import { SeededRandom } from "./random.ts";

interface Rect { x: number; y: number; w: number; h: number }
type Axis = "H" | "V";
interface Leaf { kind: "LEAF"; roomId: string }
interface Split { kind: "SPLIT"; axis: Axis; a: Node; b: Node; ratio?: number }
type Node = Leaf | Split;

function leaf(roomId: string): Leaf { return { kind: "LEAF", roomId }; }
function split(axis: Axis, a: Node, b: Node, ratio?: number): Split { return ratio === undefined ? { kind: "SPLIT", axis, a, b } : { kind: "SPLIT", axis, a, b, ratio }; }

function sumTarget(node: Node, targets: Record<string, number>): number {
  return node.kind === "LEAF" ? targets[node.roomId]! : sumTarget(node.a, targets) + sumTarget(node.b, targets);
}

function stack(nodes: Node[], axis: Axis, rng: SeededRandom): Node {
  if (nodes.length === 1) return nodes[0]!;
  const total = nodes.reduce((s, n) => s + 1, 0);
  const pivot = Math.max(1, Math.min(nodes.length - 1, Math.round(total * (0.42 + rng.next() * 0.16))));
  const left = stack(nodes.slice(0, pivot), axis, rng);
  const right = stack(nodes.slice(pivot), axis, rng);
  return split(axis, left, right);
}

function insideBounds(grid: OccupancyGrid): Rect | undefined {
  let minX = grid.width;
  let minY = grid.height;
  let maxX = -1;
  let maxY = -1;
  let count = 0;
  for (let i = 0; i < grid.envelopeMask.length; i++) {
    if (!grid.isInside(i)) continue;
    const { x, y } = grid.coords(i);
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    count++;
  }
  if (maxX < minX || maxY < minY) return undefined;
  const rect = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  if (rect.w * rect.h !== count) return undefined;
  return rect;
}

function minSideCells(req: RoomRequirement, cellSizeMm: number): number {
  const mm = req.type === "LIVING" ? 3000
    : req.type === "BEDROOM" ? req.minWidthMm
    : req.type === "KITCHEN" ? 1800
    : req.type === "BATHROOM" || req.type === "ENSUITE" ? 1500
    : req.type === "DINING" ? 2400
    : req.type === "STUDY" ? 2100
    : req.type === "UTILITY" || req.type === "FOYER" ? 1200
    : req.type === "PRIVATE_LOBBY" || req.type === "CORRIDOR" ? req.minWidthMm
    : 1000;
  return Math.ceil(mm / cellSizeMm);
}

function minSpan(node: Node, axis: Axis, reqById: Map<string, RoomRequirement>, cellSizeMm: number): number {
  if (node.kind === "LEAF") return minSideCells(reqById.get(node.roomId)!, cellSizeMm);
  if (node.axis === axis) return minSpan(node.a, axis, reqById, cellSizeMm) + minSpan(node.b, axis, reqById, cellSizeMm);
  return Math.max(minSpan(node.a, axis, reqById, cellSizeMm), minSpan(node.b, axis, reqById, cellSizeMm));
}

function pack(node: Node, rect: Rect, targets: Record<string, number>, output: Map<string, Rect>, reqById: Map<string, RoomRequirement>, cellSizeMm: number): boolean {
  if (node.kind === "LEAF") {
    const req = reqById.get(node.roomId)!;
    const minSide = minSideCells(req, cellSizeMm);
    if (rect.w < minSide || rect.h < minSide) return false;
    output.set(node.roomId, rect);
    return true;
  }
  const aTarget = sumTarget(node.a, targets);
  const bTarget = sumTarget(node.b, targets);
  const ratio = node.ratio ?? (aTarget / Math.max(1, aTarget + bTarget));
  if (node.axis === "V") {
    if (rect.w < 2) return false;
    const minA = minSpan(node.a, "V", reqById, cellSizeMm);
    const minB = minSpan(node.b, "V", reqById, cellSizeMm);
    if (minA + minB > rect.w) return false;
    const aw = Math.max(minA, Math.min(rect.w - minB, Math.round(rect.w * ratio)));
    return pack(node.a, { x: rect.x, y: rect.y, w: aw, h: rect.h }, targets, output, reqById, cellSizeMm)
      && pack(node.b, { x: rect.x + aw, y: rect.y, w: rect.w - aw, h: rect.h }, targets, output, reqById, cellSizeMm);
  }
  if (rect.h < 2) return false;
  const minA = minSpan(node.a, "H", reqById, cellSizeMm);
  const minB = minSpan(node.b, "H", reqById, cellSizeMm);
  if (minA + minB > rect.h) return false;
  const ah = Math.max(minA, Math.min(rect.h - minB, Math.round(rect.h * ratio)));
  return pack(node.a, { x: rect.x, y: rect.y, w: rect.w, h: ah }, targets, output, reqById, cellSizeMm)
    && pack(node.b, { x: rect.x, y: rect.y + ah, w: rect.w, h: rect.h - ah }, targets, output, reqById, cellSizeMm);
}

function buildTree(
  brief: NormalizedBrief,
  budget: ProgrammeBudget,
  family: TopologyFamily,
  rng: SeededRandom
): Node {
  const reqs = budget.requirements;
  const one = (type: RoomRequirement["type"]): RoomRequirement | undefined => reqs.find((r) => r.type === type);
  const all = (type: RoomRequirement["type"]): RoomRequirement[] => reqs.filter((r) => r.type === type);
  const living = one("LIVING")!;
  const kitchen = one("KITCHEN")!;
  const foyer = one("FOYER");
  const lobby = one("PRIVATE_LOBBY");
  const bedrooms = all("BEDROOM");
  const ensuites = all("ENSUITE");
  const baths = all("BATHROOM");
  const optional = reqs.filter((r) => !["LIVING", "KITCHEN", "FOYER", "PRIVATE_LOBBY", "BEDROOM", "ENSUITE", "BATHROOM"].includes(r.type));

  // Public|private as side-by-side wings along X whenever the plot is wider than
  // tall. The old E/W branch used H (top/bottom), which crushed living to ~2.5 m.
  const wide = brief.dimensions.widthMm >= brief.dimensions.heightMm;
  const primaryAxis: Axis =
    brief.entranceEdge === "NORTH" || brief.entranceEdge === "SOUTH" || wide ? "V" : "H";
  const depthAxis: Axis = primaryAxis === "V" ? "H" : "V";
  const entranceAtSecond = brief.entranceEdge === "SOUTH" || brief.entranceEdge === "EAST";
  // When public sits on the east, the private wing's living-facing edge is east
  // (second on V) — flip bed/ensuite and lobby/bath order so doors face living.
  const publicOnEast = brief.entranceEdge === "EAST";

  let publicNear: Node = leaf(living.id);
  if (foyer) publicNear = entranceAtSecond ? split(depthAxis, publicNear, leaf(foyer.id)) : split(depthAxis, leaf(foyer.id), publicNear);
  const publicFarNodes = [leaf(kitchen.id), ...optional.map((r) => leaf(r.id))];
  const publicFar = stack(publicFarNodes, primaryAxis, rng);
  // Occasionally flip kitchen/living depth order for seed diversity.
  const flipPublicDepth = rng.next() < 0.45;
  const publicNode =
    (entranceAtSecond !== flipPublicDepth)
      ? split(depthAxis, publicFar, publicNear)
      : split(depthAxis, publicNear, publicFar);

  const bedroomBands: Node[] = bedrooms.map((bed, i) => {
    const ensuite = ensuites[i];
    if (!ensuite) return leaf(bed.id);
    // Bedroom on the living-facing side of the private wing; ensuite toward exterior.
    if (brief.bhk === 1) return split(depthAxis, leaf(bed.id), leaf(ensuite.id));
    return publicOnEast
      ? split(primaryAxis, leaf(ensuite.id), leaf(bed.id))
      : split(primaryAxis, leaf(bed.id), leaf(ensuite.id));
  });
  if (lobby && baths.length > 0) {
    const bathNodes = baths.map((b) => leaf(b.id));
    const bathStack = stack(bathNodes, depthAxis, rng);
    bedroomBands.push(
      publicOnEast
        ? split(primaryAxis, bathStack, leaf(lobby.id))
        : split(primaryAxis, leaf(lobby.id), bathStack),
    );
  } else {
    bedroomBands.push(...baths.map((b) => leaf(b.id)));
    if (lobby) bedroomBands.push(leaf(lobby.id));
  }
  const privateNode = stack(bedroomBands, depthAxis, rng);

  if (family === "SPLIT_WING") {
    return entranceAtSecond ? split(depthAxis, privateNode, publicNode) : split(depthAxis, publicNode, privateNode);
  }
  // Keep public adjacent to living-side bedrooms. For E/W entrances the public
  // wing must sit on the door side (east = second on V, west = first).
  // Jitter the public share so seeds explore different living depths — without
  // this, a given envelope (e.g. 850 sq.ft / 10.1×7.8) converges to one layout.
  const publicRatio =
    (brief.bhk === 1 ? 0.42 : 0.46) + rng.next() * 0.12;
  if (brief.entranceEdge === "EAST") {
    return split(primaryAxis, privateNode, publicNode, 1 - publicRatio);
  }
  if (brief.entranceEdge === "WEST") {
    return split(primaryAxis, publicNode, privateNode, publicRatio);
  }
  return split(primaryAxis, publicNode, privateNode, publicRatio);
}

export interface SlicingPackResult { grid: OccupancyGrid; spaces: SpaceRegion[] }

export function packWithSlicingTree(
  brief: NormalizedBrief,
  budget: ProgrammeBudget,
  topology: AccessGraph,
  baseGrid: OccupancyGrid,
  seed: number
): SlicingPackResult | undefined {
  const bounds = insideBounds(baseGrid);
  if (!bounds) return undefined;
  const rng = new SeededRandom(seed);
  const tree = buildTree(brief, budget, topology.family, rng);
  const rects = new Map<string, Rect>();
  const reqById = new Map(budget.requirements.map((r) => [r.id, r]));
  if (!pack(tree, bounds, budget.targetCellsByRoomId, rects, reqById, baseGrid.cellSizeMm)) return undefined;
  const grid = baseGrid.clone();
  const labelById = new Map<string, number>();
  budget.requirements.forEach((req, label) => {
    labelById.set(req.id, label);
    const rect = rects.get(req.id);
    if (!rect) return;
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        const idx = grid.index(x, y);
        if (!grid.isInside(idx) || grid.labels[idx]! >= 0) return;
        grid.labels[idx] = label;
      }
    }
  });
  if (grid.assignedInsideCount() !== grid.insideCellCount()) return undefined;

  // Controlled orthogonal refinement: keep a 1 m hall route along the public/private
  // boundary through the kitchen-depth zone. Living becomes an L-shaped hub and
  // can legally serve recessed bedroom/lobby doors without a separate corridor.
  if (topology.family !== "SPLIT_WING") {
    const livingReq = budget.requirements.find((r) => r.type === "LIVING");
    const kitchenReq = budget.requirements.find((r) => r.type === "KITCHEN");
    const kitchenRect = kitchenReq ? rects.get(kitchenReq.id) : undefined;
    const livingLabel = livingReq ? labelById.get(livingReq.id) : undefined;
    if (kitchenRect && livingLabel !== undefined) {
      const routeCells = Math.max(3, Math.ceil(1000 / grid.cellSizeMm));
      // Match buildTree wing axis (wide plots / N–S → V).
      const wide = brief.dimensions.widthMm >= brief.dimensions.heightMm;
      const primaryAxis: Axis =
        brief.entranceEdge === "NORTH" || brief.entranceEdge === "SOUTH" || wide ? "V" : "H";
      const routeOk =
        primaryAxis === "V"
          ? kitchenRect.w - routeCells >= Math.ceil(1800 / grid.cellSizeMm)
          : kitchenRect.h - routeCells >= Math.ceil(1800 / grid.cellSizeMm);
      if (!routeOk) {
        // skip
      } else if (brief.entranceEdge === "EAST" && primaryAxis === "V") {
        // Public is east: extend living along kitchen's west edge (private interface).
        for (let y = kitchenRect.y; y < kitchenRect.y + kitchenRect.h; y++) {
          for (let x = kitchenRect.x; x < kitchenRect.x + routeCells; x++) {
            grid.labels[grid.index(x, y)] = livingLabel;
          }
        }
      } else if (brief.entranceEdge === "WEST" && primaryAxis === "V") {
        // Public is west: extend living along kitchen's east edge (private interface).
        for (let y = kitchenRect.y; y < kitchenRect.y + kitchenRect.h; y++) {
          for (let x = kitchenRect.x + kitchenRect.w - routeCells; x < kitchenRect.x + kitchenRect.w; x++) {
            grid.labels[grid.index(x, y)] = livingLabel;
          }
        }
      } else if (primaryAxis === "V") {
        for (let y = kitchenRect.y; y < kitchenRect.y + kitchenRect.h; y++) {
          for (let x = kitchenRect.x + kitchenRect.w - routeCells; x < kitchenRect.x + kitchenRect.w; x++) {
            grid.labels[grid.index(x, y)] = livingLabel;
          }
        }
      } else if (primaryAxis === "H") {
        for (let y = kitchenRect.y + kitchenRect.h - routeCells; y < kitchenRect.y + kitchenRect.h; y++) {
          for (let x = kitchenRect.x; x < kitchenRect.x + kitchenRect.w; x++) {
            grid.labels[grid.index(x, y)] = livingLabel;
          }
        }
      }
    }
  }

  const spaces: SpaceRegion[] = budget.requirements.map((req, label) => {
    let count = 0;
    let seedCell = -1;
    for (let idx = 0; idx < grid.labels.length; idx++) {
      if (grid.labels[idx] !== label) continue;
      count++;
      if (seedCell < 0) seedCell = idx;
    }
    return { id: req.id, type: req.type, label, requirement: req, seedCell, cellCount: count };
  });
  if (spaces.some((s) => s.seedCell < 0)) return undefined;
  return { grid, spaces };
}
