/**
 * Topology-first floor-plan generation types.
 * Geometry is derived from an abstract access tree + circulation spine.
 */

export type Vec2 = { x: number; y: number };

export type EntranceDirection = 'N' | 'S' | 'E' | 'W';

export type AccessNodeCategory =
  | 'ENTRY'
  | 'FOYER'
  | 'CORRIDOR'
  | 'LIVING'
  | 'KITCHEN'
  | 'BEDROOM'
  | 'COMMON_BATHROOM'
  | 'ENSUITE_BATHROOM'
  | 'UTILITY'
  | 'BALCONY';

/** Maps abstract category → live RoomType used by FloorGraph / UI. */
export type LiveRoomType =
  | 'living'
  | 'kitchen'
  | 'bedroom'
  | 'bathroom'
  | 'ensuite'
  | 'corridor'
  | 'entry'
  | 'foyer'
  | 'utility'
  | 'balcony'
  | 'storage'
  | 'office';

export interface AccessNode {
  id: string;
  category: AccessNodeCategory;
  label: string;
  /** Assigned bedroom id for ensuites. */
  attachedTo?: string;
}

export interface AccessEdge {
  parentId: string;
  childId: string;
  kind: 'required' | 'optional';
}

export interface AccessTree {
  rootId: string;
  nodes: AccessNode[];
  edges: AccessEdge[];
}

export interface AreaBudget {
  roomId: string;
  category: AccessNodeCategory;
  minArea: number;
  targetArea: number;
  maxArea: number;
  minWidth: number;
  minHeight: number;
  preferredAspectRatio: number;
  areaPriority: number;
}

export interface Interval {
  start: number;
  end: number;
}

export interface SharedWall {
  roomAId: string;
  roomBId: string;
  axis: 'horizontal' | 'vertical';
  start: Vec2;
  end: Vec2;
  length: number;
  validDoorIntervals: Interval[];
}

export interface Door {
  id: string;
  roomAId: string;
  roomBId: string;
  wallStart: Vec2;
  wallEnd: Vec2;
  position: Vec2;
  width: number;
  orientation: 'horizontal' | 'vertical';
  hingeSide: 'left' | 'right';
  swingIntoRoomId: string;
  /** True for the primary exterior entrance door. */
  isEntrance?: boolean;
}

export interface RoomRect {
  id: string;
  category: AccessNodeCategory;
  type: LiveRoomType;
  x: number;
  y: number;
  w: number;
  h: number;
  targetArea: number;
  minDimension: number;
  /** Corridor may be a union of rects; primary rect is still required. */
  parts?: Array<{ x: number; y: number; w: number; h: number }>;
  /** Legacy treemap index (unused by topology-first generator). */
  roomIndex?: number;
}

export interface CorridorSpine {
  shape: 'straight' | 'L' | 'T' | 'branched' | 'living-integrated';
  width: number;
  centreline: Vec2[];
  polygons: Array<{ x: number; y: number; w: number; h: number }>;
  entryPoint: Vec2;
}

export interface PortalNode {
  id: string;
  kind: 'door' | 'centroid' | 'centreline';
  position: Vec2;
  roomIds: string[];
}

export interface PortalEdge {
  a: string;
  b: string;
  length: number;
  roomId: string;
}

export interface PortalGraph {
  nodes: PortalNode[];
  edges: PortalEdge[];
}

export interface RoutePolyline {
  roomAId: string;
  roomBId: string;
  points: Vec2[];
}

export interface ValidationIssue {
  code: string;
  message: string;
  roomIds?: string[];
}

export interface ValidationMetrics {
  totalArea: number;
  corridorAreaRatio: number;
  entryAreaRatio: number;
  reachableCount: number;
  doorCount: number;
  missingTopologyEdges: number;
  bathroomLeafViolations: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  metrics: ValidationMetrics;
}

export interface FloorPlanEntrance {
  direction: EntranceDirection;
  exteriorEdge: { start: Vec2; end: Vec2 };
  door: Door;
}

export interface FloorPlan {
  rooms: RoomRect[];
  topology: AccessTree;
  budgets: AreaBudget[];
  spine: CorridorSpine;
  sharedWalls: SharedWall[];
  doors: Door[];
  portalGraph: PortalGraph;
  routes: RoutePolyline[];
  entrance: FloorPlanEntrance;
  validation: ValidationResult;
  seed: number;
  outlineW: number;
  outlineH: number;
  /** Soft scores only meaningful when validation.valid. */
  scores?: {
    areaError: number;
    daylight: number;
    privacy: number;
    corridorEfficiency: number;
    wetClustering: number;
    shapeQuality: number;
    lexico: number[];
  };
}

export interface DoorConfig {
  doorWidth: number;
  sideClearance: number;
  cornerClearance: number;
}

export const DEFAULT_DOOR_CONFIG: DoorConfig = {
  doorWidth: 0.8,
  sideClearance: 0.1,
  cornerClearance: 0.05,
};

export function categoryToLiveType(cat: AccessNodeCategory): LiveRoomType {
  switch (cat) {
    case 'ENTRY': return 'entry';
    case 'FOYER': return 'foyer';
    case 'CORRIDOR': return 'corridor';
    case 'LIVING': return 'living';
    case 'KITCHEN': return 'kitchen';
    case 'BEDROOM': return 'bedroom';
    case 'COMMON_BATHROOM': return 'bathroom';
    case 'ENSUITE_BATHROOM': return 'ensuite';
    case 'UTILITY': return 'utility';
    case 'BALCONY': return 'balcony';
  }
}

export function isBathroomCategory(cat: AccessNodeCategory): boolean {
  return cat === 'COMMON_BATHROOM' || cat === 'ENSUITE_BATHROOM';
}

export function roomCentroid(r: RoomRect): Vec2 {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

export function roomArea(r: RoomRect): number {
  if (r.parts && r.parts.length > 0) {
    return r.parts.reduce((s, p) => s + p.w * p.h, 0);
  }
  return r.w * r.h;
}
