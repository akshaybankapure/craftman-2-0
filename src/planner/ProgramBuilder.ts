/**
 * ProgramBuilder: Squarified Treemap Partitioner
 *
 * Takes a ProgramSpec (room list + adjacencies) and an outline rectangle,
 * and produces a valid FloorGraph where rooms are axis-aligned quads that
 * tile the outline without overlap or gaps.
 *
 * The genome controls WHERE each split lands (ratio 0..1), so NSGA-II
 * can evolve fundamentally different layouts.
 *
 * Algorithm:
 *   1. Sort rooms by target area (largest first — squarified treemap heuristic)
 *   2. Recursively split the remaining rectangle:
 *      - Choose axis: split along the LONGER dimension (more square sub-rects)
 *      - Split position: genome gene * available length (clamped 25%–75%)
 *      - Left sub-rect gets the next room(s), right sub-rect recurses
 *   3. Convert the tree of rectangles into a planar graph:
 *      - Merge coincident vertices (shared wall junctions)
 *      - Mark outline vertices as pinned
 *      - Auto-generate constraints from the program
 */

import type {
  Constraint,
  Edge,
  EdgeId,
  Face,
  FaceId,
  FloorGraph,
  ProgramSpec,
  RoomType,
  SolveProblem,
  Vec2,
  Vertex,
  VertexId,
} from '../types/index.ts';

export interface RoomRect {
  x: number;
  y: number;
  w: number;
  h: number;
  roomIndex: number; // index into the flattened room list
  type: RoomType;
  targetArea: number;
  minDimension: number;
}

/**
 * Given a ProgramSpec and a genome, produce a fully-constructed SolveProblem.
 */
export function buildFromSpec(
  spec: ProgramSpec,
  outlineW: number,
  outlineH: number,
  genome: number[]
): SolveProblem {
  // 1. Flatten the room list (expand counts)
  const rooms: { type: RoomType; targetArea: number; minDimension: number }[] = [];
  for (const r of spec.rooms) {
    for (let i = 0; i < r.count; i++) {
      rooms.push({ type: r.type, targetArea: r.targetArea, minDimension: r.minDimension });
    }
  }

  // 2. Sort by target area descending (squarified heuristic)
  const indices = rooms.map((_, i) => i);
  indices.sort((a, b) => rooms[b].targetArea - rooms[a].targetArea);

  // 3. Recursively partition the bounding rect
  const rects = partitionRect(
    { x: 0, y: 0, w: outlineW, h: outlineH },
    indices,
    rooms,
    genome,
    0
  );

  // 4. Convert rectangles to a planar graph
  return rectsToGraph(rects, outlineW, outlineH, spec);
}

interface PartitionResult {
  geneIdx: number;
  rects: RoomRect[];
}

function partitionRect(
  rect: { x: number; y: number; w: number; h: number },
  roomIndices: number[],
  rooms: { type: RoomType; targetArea: number; minDimension: number }[],
  genome: number[],
  geneOffset: number
): RoomRect[] {
  if (roomIndices.length === 0) return [];

  if (roomIndices.length === 1) {
    const idx = roomIndices[0];
    return [{
      ...rect,
      roomIndex: idx,
      type: rooms[idx].type,
      targetArea: rooms[idx].targetArea,
      minDimension: rooms[idx].minDimension,
    }];
  }

  // Split along the longer axis
  const vertical = rect.w >= rect.h;
  const gene = genome[geneOffset % genome.length] ?? 0.5;
  // Clamp split to 25%–75% to avoid degenerate slivers
  const ratio = 0.25 + gene * 0.5;

  // Distribute rooms to left/right proportional to their area
  const totalArea = roomIndices.reduce((s, i) => s + rooms[i].targetArea, 0);
  const leftTarget = totalArea * ratio;
  let leftSum = 0;
  let splitAt = 1; // at least 1 room on each side
  for (let i = 0; i < roomIndices.length - 1; i++) {
    leftSum += rooms[roomIndices[i]].targetArea;
    splitAt = i + 1;
    if (leftSum >= leftTarget) break;
  }

  const leftRooms = roomIndices.slice(0, splitAt);
  const rightRooms = roomIndices.slice(splitAt);

  // Compute actual area ratio based on rooms assigned
  const leftAreaSum = leftRooms.reduce((s, i) => s + rooms[i].targetArea, 0);
  const areaRatio = totalArea > 0 ? leftAreaSum / totalArea : 0.5;
  // Clamp to prevent slivers
  const clampedRatio = Math.max(0.2, Math.min(0.8, areaRatio));

  let leftRect: { x: number; y: number; w: number; h: number };
  let rightRect: { x: number; y: number; w: number; h: number };

  if (vertical) {
    const splitX = rect.x + rect.w * clampedRatio;
    leftRect = { x: rect.x, y: rect.y, w: rect.w * clampedRatio, h: rect.h };
    rightRect = { x: splitX, y: rect.y, w: rect.w * (1 - clampedRatio), h: rect.h };
  } else {
    const splitY = rect.y + rect.h * clampedRatio;
    leftRect = { x: rect.x, y: rect.y, w: rect.w, h: rect.h * clampedRatio };
    rightRect = { x: rect.x, y: splitY, w: rect.w, h: rect.h * (1 - clampedRatio) };
  }

  const leftResult = partitionRect(leftRect, leftRooms, rooms, genome, geneOffset + 1);
  const rightResult = partitionRect(rightRect, rightRooms, rooms, genome, geneOffset + 1 + leftRooms.length);

  return [...leftResult, ...rightResult];
}

/**
 * Convert a set of non-overlapping axis-aligned rectangles into a planar graph.
 * Vertices at the same position are merged (shared wall junctions).
 */
function rectsToGraph(
  rects: RoomRect[],
  outlineW: number,
  outlineH: number,
  spec: ProgramSpec
): SolveProblem {
  const graph: FloorGraph = {
    vertices: new Map(),
    edges: new Map(),
    faces: new Map(),
  };

  // Vertex deduplication: round to 1mm to merge coincident points
  const vertexMap = new Map<string, VertexId>();
  let vertexCount = 0;
  let edgeCount = 0;

  const getOrCreateVertex = (x: number, y: number): VertexId => {
    const key = `${Math.round(x * 1000)},${Math.round(y * 1000)}`;
    if (vertexMap.has(key)) return vertexMap.get(key)!;
    const id = `v${vertexCount++}`;
    const eps = 0.001;
    const onBoundary =
      x < eps || x > outlineW - eps || y < eps || y > outlineH - eps;
    graph.vertices.set(id, { id, pos: { x, y }, pinned: onBoundary });
    vertexMap.set(key, id);
    return id;
  };

  const edgeSet = new Set<string>();
  const addEdge = (a: VertexId, b: VertexId): EdgeId => {
    const sorted = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (edgeSet.has(sorted)) return sorted;
    edgeSet.add(sorted);
    const id = `e${edgeCount++}`;
    const posA = graph.vertices.get(a)!.pos;
    const posB = graph.vertices.get(b)!.pos;
    const eps = 0.001;
    const isExterior =
      (Math.abs(posA.x - posB.x) < eps && (posA.x < eps || posA.x > outlineW - eps)) ||
      (Math.abs(posA.y - posB.y) < eps && (posA.y < eps || posA.y > outlineH - eps));
    graph.edges.set(id, { id, a, b, isExterior });
    return id;
  };

  // Create faces (rooms)
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const v0 = getOrCreateVertex(r.x, r.y);
    const v1 = getOrCreateVertex(r.x + r.w, r.y);
    const v2 = getOrCreateVertex(r.x + r.w, r.y + r.h);
    const v3 = getOrCreateVertex(r.x, r.y + r.h);

    addEdge(v0, v1);
    addEdge(v1, v2);
    addEdge(v2, v3);
    addEdge(v3, v0);

    const faceId = `r${i}`;
    graph.faces.set(faceId, {
      id: faceId,
      type: r.type,
      loop: [v0, v1, v2, v3],
      targetArea: r.targetArea,
      minDimension: r.minDimension,
    });
  }

  // Build constraints
  const constraints: Constraint[] = [];

  // Area constraint per room (hard — this is the primary objective)
  for (const face of graph.faces.values()) {
    constraints.push({
      kind: 'area',
      hard: true,
      stiffness: 1.0,
      targets: { faces: [face.id] },
      params: { target: face.targetArea },
    });
  }

  // Min dimension per room (hard)
  for (const face of graph.faces.values()) {
    constraints.push({
      kind: 'minDimension',
      hard: true,
      stiffness: 1.0,
      targets: { faces: [face.id] },
      params: { min: face.minDimension },
    });
  }

  // Orthogonality on ALL interior edges (soft — allows angled walls with low stiffness)
  for (const edge of graph.edges.values()) {
    if (!edge.isExterior) {
      constraints.push({
        kind: 'orthogonality',
        hard: false,
        stiffness: 0.5,
        targets: { edges: [edge.id] },
        params: {},
      });
    }
  }

  // Adjacency constraints from the spec
  if (spec.adjacencies) {
    const facesByType = new Map<RoomType, FaceId[]>();
    for (const face of graph.faces.values()) {
      const list = facesByType.get(face.type) ?? [];
      list.push(face.id);
      facesByType.set(face.type, list);
    }

    for (const [typeA, typeB] of spec.adjacencies) {
      const facesA = facesByType.get(typeA) ?? [];
      const facesB = facesByType.get(typeB) ?? [];
      // Connect first matching pair
      if (facesA.length > 0 && facesB.length > 0) {
        constraints.push({
          kind: 'adjacency',
          hard: false,
          stiffness: 0.7,
          targets: { faces: [facesA[0], facesB[0]] },
          params: { tolerance: 0.1 },
        });
      }
    }
  }

  const outline: Vec2[] = [
    { x: 0, y: 0 },
    { x: outlineW, y: 0 },
    { x: outlineW, y: outlineH },
    { x: 0, y: outlineH },
  ];

  return { graph, constraints, outline };
}

/**
 * Compute the number of genes needed for a given room count.
 * One gene per partition split, approximately log2(n) splits.
 */
export function geneCount(roomCount: number): number {
  // One gene per split level + some extra for stiffness tuning
  return Math.max(4, roomCount * 2);
}
