import type {
  Constraint,
  Face,
  FaceId,
  FloorGraph,
  RoomType,
  SolveProblem,
  Vec2,
  VertexId,
} from '../types/index.ts';
import type { FloorPlan, LiveRoomType, RoomRect } from './types.ts';

/** Convert a validated FloorPlan into the legacy FloorGraph for 3D / UI. */
export function floorPlanToSolveProblem(plan: FloorPlan): SolveProblem {
  const graph: FloorGraph = {
    vertices: new Map(),
    edges: new Map(),
    faces: new Map(),
  };

  const vertexMap = new Map<string, VertexId>();
  let vertexCount = 0;
  let edgeCount = 0;

  const getOrCreateVertex = (x: number, y: number): VertexId => {
    const key = `${Math.round(x * 1000)},${Math.round(y * 1000)}`;
    if (vertexMap.has(key)) return vertexMap.get(key)!;
    const id = `v${vertexCount++}`;
    const eps = 0.001;
    const onBoundary =
      x < eps || x > plan.outlineW - eps || y < eps || y > plan.outlineH - eps;
    graph.vertices.set(id, { id, pos: { x, y }, pinned: onBoundary });
    vertexMap.set(key, id);
    return id;
  };

  const edgeSet = new Set<string>();
  const addEdge = (a: VertexId, b: VertexId) => {
    const sorted = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (edgeSet.has(sorted)) return;
    edgeSet.add(sorted);
    const id = `e${edgeCount++}`;
    const posA = graph.vertices.get(a)!.pos;
    const posB = graph.vertices.get(b)!.pos;
    const eps = 0.001;
    const isExterior =
      (Math.abs(posA.x - posB.x) < eps && (posA.x < eps || posA.x > plan.outlineW - eps)) ||
      (Math.abs(posA.y - posB.y) < eps && (posA.y < eps || posA.y > plan.outlineH - eps));
    graph.edges.set(id, { id, a, b, isExterior });
  };

  for (const r of plan.rooms) {
    const parts = r.parts && r.parts.length > 0 ? r.parts : [{ x: r.x, y: r.y, w: r.w, h: r.h }];
    // Primary face from main rect (or first part)
    const main = { x: r.x, y: r.y, w: r.w, h: r.h };
    addRectFace(graph, r, main, getOrCreateVertex, addEdge, r.id);
    // Extra corridor parts as additional faces with same type if distinct
    if (parts.length > 1) {
      parts.slice(1).forEach((p, i) => {
        addRectFace(
          graph,
          { ...r, id: `${r.id}_p${i}` },
          p,
          getOrCreateVertex,
          addEdge,
          `${r.id}_p${i}`,
        );
      });
    }
  }

  const constraints: Constraint[] = [];
  for (const face of graph.faces.values()) {
    constraints.push({
      kind: 'area',
      hard: false,
      stiffness: 0.5,
      targets: { faces: [face.id] },
      params: { target: face.targetArea },
    });
    constraints.push({
      kind: 'minDimension',
      hard: true,
      stiffness: 1.0,
      targets: { faces: [face.id] },
      params: { min: face.minDimension },
    });
  }

  const outline: Vec2[] = [
    { x: 0, y: 0 },
    { x: plan.outlineW, y: 0 },
    { x: plan.outlineW, y: plan.outlineH },
    { x: 0, y: plan.outlineH },
  ];

  return { graph, constraints, outline };
}

function addRectFace(
  graph: FloorGraph,
  r: RoomRect,
  rect: { x: number; y: number; w: number; h: number },
  getOrCreateVertex: (x: number, y: number) => VertexId,
  addEdge: (a: VertexId, b: VertexId) => void,
  faceId: FaceId,
): void {
  const v0 = getOrCreateVertex(rect.x, rect.y);
  const v1 = getOrCreateVertex(rect.x + rect.w, rect.y);
  const v2 = getOrCreateVertex(rect.x + rect.w, rect.y + rect.h);
  const v3 = getOrCreateVertex(rect.x, rect.y + rect.h);
  addEdge(v0, v1);
  addEdge(v1, v2);
  addEdge(v2, v3);
  addEdge(v3, v0);

  const face: Face = {
    id: faceId,
    type: liveToRoomType(r.type),
    loop: [v0, v1, v2, v3],
    targetArea: r.targetArea,
    minDimension: r.minDimension,
  };
  graph.faces.set(faceId, face);
}

function liveToRoomType(t: LiveRoomType): RoomType {
  // Map extended types onto RoomType
  if (t === 'ensuite') return 'ensuite';
  if (t === 'foyer') return 'foyer';
  if (t === 'utility') return 'utility';
  if (t === 'balcony') return 'balcony';
  return t as RoomType;
}

/** Face id in FloorGraph matches FloorPlan room id for primary rooms. */
export function faceIdForRoom(roomId: string): string {
  return roomId;
}
