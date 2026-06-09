/**
 * Core domain model.
 *
 * A floor is a PLANAR GRAPH, not a list of rectangles. This is the single most
 * important modeling decision in the system and the reason the solver can handle
 * angled walls: every geometric relationship is expressed as a constraint over
 * vertices, never as an axis-aligned box.
 *
 *   - Vertex  -> a wall junction (a 2D point that the solver is allowed to move)
 *   - Edge    -> a wall segment connecting two vertices
 *   - Face    -> a room: the cycle of edges enclosing an area
 *
 * Geometry (wall thickness, openings, mesh) is derived FROM this graph by the
 * geometry layer. The graph is the source of truth; the solver operates only on
 * vertex positions.
 */

export type Vec2 = { x: number; y: number };

export type VertexId = string;
export type EdgeId = string;
export type FaceId = string;

/** A movable junction point. `pinned` vertices are held fixed by the solver
 *  (e.g. the building outline corners). */
export interface Vertex {
  id: VertexId;
  pos: Vec2;
  pinned: boolean;
}

/** A wall segment. Topology only — geometry (thickness/openings) lives elsewhere. */
export interface Edge {
  id: EdgeId;
  a: VertexId;
  b: VertexId;
  /** Walls on the building perimeter are structural and weighted differently. */
  isExterior: boolean;
}

export type RoomType =
  | 'living'
  | 'kitchen'
  | 'bedroom'
  | 'bathroom'
  | 'corridor'
  | 'entry'
  | 'storage'
  | 'office';

/** A room: an ordered loop of vertices (CCW). Carries the *program* requirements
 *  the solver must satisfy. */
export interface Face {
  id: FaceId;
  type: RoomType;
  loop: VertexId[];
  /** Target usable area in m^2 (a soft constraint — solver minimizes deviation). */
  targetArea: number;
  /** Hard minimum on the shortest room dimension (e.g. a bedroom can't be 1m wide). */
  minDimension: number;
}

export interface FloorGraph {
  vertices: Map<VertexId, Vertex>;
  edges: Map<EdgeId, Edge>;
  faces: Map<FaceId, Face>;
}

// ---------------------------------------------------------------------------
// Constraints. These are the language the solver speaks. Each constraint type
// knows how to compute (a) how much it is currently violated, and (b) the
// position correction to apply to the vertices it touches.
// ---------------------------------------------------------------------------

export type ConstraintKind =
  | 'area'          // a face should have a target area
  | 'minDimension'  // a face's narrowest span >= min
  | 'adjacency'     // two faces must share a wall
  | 'orthogonality' // an edge should be axis-aligned (SOFT — angled walls allowed)
  | 'edgeLength'    // a wall length should stay within [min, max]
  | 'angle'         // an interior angle should stay near target
  | 'corridorWidth' // a corridor face must keep a minimum clear width
  | 'boundary';     // a vertex must stay inside the building outline

export interface Constraint {
  kind: ConstraintKind;
  /** Hard constraints are satisfied before soft ones (priority in the solver). */
  hard: boolean;
  /** Relative strength 0..1 used to weight the correction. */
  stiffness: number;
  /** Faces/edges/vertices this constraint reads. */
  targets: {
    faces?: FaceId[];
    edges?: EdgeId[];
    vertices?: VertexId[];
  };
  /** Constraint-specific parameters. */
  params: Record<string, number>;
}

/** The full problem the solver is handed. */
export interface SolveProblem {
  graph: FloorGraph;
  constraints: Constraint[];
  /** Convex-ish polygon (CCW) the whole floor must stay inside. */
  outline: Vec2[];
}

/** Objective scores used by the optimizer. Lower is better for all of them
 *  so NSGA-II can treat them uniformly as a minimization problem. */
export interface ObjectiveScores {
  /** Sum of |area - targetArea| over rooms, normalized. */
  areaError: number;
  /** Total corridor length / total usable area. */
  circulation: number;
  /** 1 - (rooms with adequate exterior wall exposure / total). */
  daylight: number;
  /** Deviation of structural (exterior) walls from a regular column grid. */
  structuralIrregularity: number;
}

/** A constraint spec produced by the LLM layer (Gemini) from natural language.
 *  The LLM NEVER emits geometry — only this structured program. */
export interface ProgramSpec {
  totalAreaTarget: number;
  rooms: Array<{
    type: RoomType;
    count: number;
    targetArea: number;
    minDimension: number;
  }>;
  adjacencies: Array<[RoomType, RoomType]>;
}
