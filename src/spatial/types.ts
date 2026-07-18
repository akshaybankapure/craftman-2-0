export type Direction = "NORTH" | "SOUTH" | "EAST" | "WEST";
export type BuildingType = "APARTMENT" | "HOUSE";
export type MarketTier = "COMPACT" | "STANDARD" | "PREMIUM";
export type ClearanceProfile = "ULTRA_COMPACT" | "COMPACT" | "STANDARD" | "PREMIUM" | "ACCESSIBLE";
export type BedType = "SINGLE" | "DOUBLE" | "QUEEN" | "KING";
export type WardrobeType = "HINGED" | "SLIDING";
export type KitchenLayout = "AUTO" | "SINGLE_WALL" | "GALLEY" | "L_SHAPED" | "U_SHAPED";
export type FurnitureKind =
  | "BED"
  | "WARDROBE"
  | "SOFA"
  | "TV_UNIT"
  | "DINING_TABLE"
  | "DESK"
  | "COUNTER_RUN"
  | "REFRIGERATOR"
  | "DISHWASHER"
  | "BREAKFAST_COUNTER"
  | "WC"
  | "BASIN"
  | "SHOWER"
  | "BATHTUB"
  | "JACUZZI"
  | "WASHING_MACHINE";

export interface BedroomFurnishingSettings {
  bedType?: BedType;
  wardrobeLengthMm?: number;
  wardrobeType?: WardrobeType;
  requireDesk?: boolean;
  requireDressing?: boolean;
  requireSeating?: boolean;
}

export interface LivingFurnishingSettings {
  seatingCapacity?: number;
  requireTvUnit?: boolean;
  requireDining?: boolean;
  diningSeats?: number;
}

export interface KitchenFurnishingSettings {
  layout?: KitchenLayout;
  minimumCounterLengthMm?: number;
  requireDishwasher?: boolean;
  requireBreakfastCounter?: boolean;
}

export interface BathroomFurnishingSettings {
  requireShower?: boolean;
  requireBathtub?: boolean;
  requireJacuzzi?: boolean;
  requireDoubleBasin?: boolean;
  accessible?: boolean;
}

export interface RoomFurnishingOverride extends BedroomFurnishingSettings, LivingFurnishingSettings, KitchenFurnishingSettings, BathroomFurnishingSettings {}

export interface FurnishingSettings {
  clearanceProfile?: ClearanceProfile;
  bedroom?: BedroomFurnishingSettings;
  living?: LivingFurnishingSettings;
  kitchen?: KitchenFurnishingSettings;
  bathroom?: BathroomFurnishingSettings;
  roomOverrides?: Record<string, RoomFurnishingOverride>;
}

export interface ResolvedFurnishingSettings {
  clearanceProfile: ClearanceProfile;
  minimumWalkwayMm: number;
  bedroom: Required<BedroomFurnishingSettings>;
  living: Required<LivingFurnishingSettings>;
  kitchen: Required<KitchenFurnishingSettings>;
  bathroom: Required<BathroomFurnishingSettings>;
  roomOverrides: Record<string, RoomFurnishingOverride>;
}

export type RoomType =
  | "LIVING"
  | "BEDROOM"
  | "KITCHEN"
  | "BATHROOM"
  | "ENSUITE"
  | "FOYER"
  | "PRIVATE_LOBBY"
  | "CORRIDOR"
  | "DINING"
  | "STUDY"
  | "UTILITY"
  | "STORAGE"
  | "FAMILY_LOUNGE";

export interface Point {
  x: number;
  y: number;
}

export interface Polygon {
  outer: Point[];
}

export interface EnvelopeDimensions {
  widthMm: number;
  heightMm: number;
}

export interface OptionalSpaceRequirement {
  type: Exclude<RoomType, "BEDROOM" | "BATHROOM" | "ENSUITE" | "CORRIDOR" | "PRIVATE_LOBBY" | "FOYER">;
  count?: number;
}

export interface FloorPlanBrief {
  carpetAreaSqM?: number;
  envelope?: Polygon;
  dimensions?: EnvelopeDimensions;
  entranceEdge: Direction;
  buildingType: BuildingType;
  bhk: 1 | 2 | 3 | 4;
  bathroomCount: number;
  marketTier: MarketTier;
  optionalSpaces?: OptionalSpaceRequirement[];
  seed?: number;
  cellSizeMm?: number;
  maxCandidates?: number;
  furnishing?: FurnishingSettings;
  /**
   * Optional external programme. When provided, the engine uses these
   * requirements instead of deriving rooms from bhk/bathroomCount alone.
   */
  requirements?: RoomRequirement[];
  /** Optional per-type standard overrides applied when deriving the programme. */
  standardOverrides?: StandardOverrides;
}

export interface NormalizedBrief {
  carpetAreaSqM: number;
  envelope: Polygon;
  dimensions: EnvelopeDimensions;
  entranceEdge: Direction;
  buildingType: BuildingType;
  bhk: 1 | 2 | 3 | 4;
  bathroomCount: number;
  marketTier: MarketTier;
  optionalSpaces: OptionalSpaceRequirement[];
  seed: number;
  cellSizeMm: number;
  maxCandidates: number;
  furnishing: ResolvedFurnishingSettings;
  requirements?: RoomRequirement[];
  standardOverrides?: StandardOverrides;
}

export interface RoomRequirement {
  id: string;
  type: RoomType;
  minAreaSqM: number;
  targetAreaSqM: number;
  maxAreaSqM: number;
  minWidthMm: number;
  /** Absolute long-side cap in mm (bowling-alley guard). */
  maxSideMm: number;
  preferredAspectRatio: number;
  hardMaxAspectRatio: number;
  exteriorAccess: "REQUIRED" | "PREFERRED" | "OPTIONAL" | "NOT_REQUIRED";
  circulationAllowed: boolean;
  expansionWeight: number;
}

/** Partial per-type overrides for programme area/width standards. */
export type StandardOverrides = Partial<
  Record<
    RoomType,
    Partial<
      Pick<
        RoomRequirement,
        | 'minAreaSqM'
        | 'targetAreaSqM'
        | 'maxAreaSqM'
        | 'minWidthMm'
        | 'maxSideMm'
        | 'preferredAspectRatio'
        | 'hardMaxAspectRatio'
        | 'exteriorAccess'
        | 'circulationAllowed'
        | 'expansionWeight'
      >
    >
  >
>;

export interface ProgrammeBudget {
  requirements: RoomRequirement[];
  targetCellsByRoomId: Record<string, number>;
  minCellsByRoomId: Record<string, number>;
  maxCellsByRoomId: Record<string, number>;
  envelopeCellCount: number;
  wallAllowanceRatio: number;
  diagnostics: string[];
}

export type TopologyFamily = "HALL_CENTRIC" | "PRIVATE_LOBBY" | "SPLIT_WING";

export interface AccessNode {
  id: string;
  roomId?: string;
  type: "EXTERIOR" | "ROOM";
}

export interface AccessEdge {
  id: string;
  from: string;
  to: string;
  required: boolean;
  kind: "PRIMARY_ACCESS" | "ENSUITE_ACCESS" | "OPEN_TRANSITION";
}

export interface AccessGraph {
  family: TopologyFamily;
  nodes: AccessNode[];
  edges: AccessEdge[];
  entryNodeId: string;
}

export interface OccupancyGridData {
  width: number;
  height: number;
  cellSizeMm: number;
  envelopeMask: Uint8Array;
  labels: Int16Array;
}

export interface SpaceRegion {
  id: string;
  type: RoomType;
  label: number;
  requirement: RoomRequirement;
  seedCell: number;
  cellCount: number;
  polygon?: Polygon;
}

export interface BoundarySegment {
  orientation: "H" | "V";
  fixed: number;
  start: number;
  end: number;
}

export interface SharedBoundary {
  roomAId: string;
  roomBId: string;
  segments: BoundarySegment[];
  totalLengthMm: number;
}

export interface DoorPortal {
  id: string;
  roomAId: string;
  roomBId?: string;
  boundary: BoundarySegment;
  centerMm: Point;
  widthMm: number;
  cellA: number;
  cellB?: number;
  exterior: boolean;
}

export type FurnitureRotation = 0 | 90 | 180 | 270;
export type WallSide = "NORTH" | "SOUTH" | "EAST" | "WEST";

export interface FurniturePlacement {
  id: string;
  roomId: string;
  kind: FurnitureKind;
  xCell: number;
  yCell: number;
  widthCells: number;
  heightCells: number;
  rotation: FurnitureRotation;
  wallSide?: WallSide;
  footprintCells: number[];
  interactionCells: number[];
  mandatory: boolean;
}

export interface RoomShapeMetrics {
  vertexCount: number;
  reflexCornerCount: number;
  perimeterMm: number;
  perimeterEfficiency: number;
  boundingFillRatio: number;
  shortEdgeCount: number;
  complexityScore: number;
}

export interface RoomFurnishingSolution {
  roomId: string;
  placements: FurniturePlacement[];
  doorCells: number[];
  connectedWalkableCells: number;
  connectedWalkableAreaSqM: number;
  totalFreeCells: number;
  minimumWalkwayMm: number;
  mandatoryKinds: FurnitureKind[];
  arrangementScore: number;
  shape: RoomShapeMetrics;
  notes: string[];
}

export interface FurnishingCertificate {
  valid: true;
  settings: ResolvedFurnishingSettings;
  rooms: RoomFurnishingSolution[];
  blockedCells: number[];
  hash: string;
}

export interface NavigationPath {
  fromRoomId: string;
  toRoomId: string;
  cellPath: number[];
  lengthMm: number;
  crossedRoomIds: string[];
}

export interface UsabilityMetric {
  roomId: string;
  largestRectangleWidthMm: number;
  largestRectangleHeightMm: number;
  boundingAspectRatio: number;
  furnitureTemplatePassed: boolean;
  connectedWalkableAreaSqM: number;
  shapeComplexityScore: number;
  polygonVertexCount: number;
  reflexCornerCount: number;
  notes: string[];
}

export interface QualityScore {
  total: number;
  areaFit: number;
  compactness: number;
  exteriorAccess: number;
  circulation: number;
  privacy: number;
}

export type ReasoningStage =
  | "BRIEF"
  | "PROGRAMME"
  | "TOPOLOGY"
  | "GRID"
  | "GEOMETRY"
  | "WALLS"
  | "DOORS"
  | "NAVIGATION"
  | "USABILITY"
  | "CERTIFICATION";

export interface ReasoningIssue {
  code: string;
  stage: ReasoningStage;
  message: string;
  affectedIds: string[];
  evidence?: Record<string, unknown>;
  suggestedRepairs?: string[];
}

export interface ReasoningResult<T> {
  passed: boolean;
  value?: T;
  fatalErrors: ReasoningIssue[];
  repairableErrors: ReasoningIssue[];
  warnings: ReasoningIssue[];
  metrics: Record<string, number | string | boolean>;
}

export interface CandidateDiagnostics {
  attempts: number;
  topologyFamily: TopologyFamily;
  rejectedReasons: string[];
  notes: string[];
}

export interface FloorPlanCandidate {
  id: string;
  brief: NormalizedBrief;
  topology: AccessGraph;
  grid: OccupancyGridData;
  spaces: SpaceRegion[];
  sharedBoundaries: SharedBoundary[];
  doors: DoorPortal[];
  navigationPaths: NavigationPath[];
  usability: UsabilityMetric[];
  furnishing: FurnishingCertificate;
  quality: QualityScore;
  diagnostics: CandidateDiagnostics;
}

export interface MathematicalPlanCertificate {
  valid: true;
  candidateId: string;
  briefHash: string;
  gridHash: string;
  polygonHash: string;
  furnishingHash: string;
  cellSizeMm: number;
  envelopeCells: number;
  assignedCells: number;
  outsideAssignedCells: number;
  unassignedInsideCells: number;
  roomComponentCounts: Record<string, number>;
  roomAreasSqM: Record<string, number>;
  roomMinimumWidthsMm: Record<string, number>;
  sharedWallMatrix: number[][];
  doorConnectivityMatrix: number[][];
  navigationConnectivityMatrix: number[][];
  criticalJourneysPassed: boolean;
  furnishingRoomsPassed: number;
}

export interface CertifiedPlan {
  candidate: FloorPlanCandidate;
  certificate: MathematicalPlanCertificate;
}

export interface GenerationFailure {
  success: false;
  code: string;
  message: string;
  failedStage: ReasoningStage;
  reasons: string[];
  suggestedChanges: string[];
  attempts: number;
}

export interface GenerationSuccess {
  success: true;
  plans: CertifiedPlan[];
  attempts: number;
}

export type GenerationResult = GenerationSuccess | GenerationFailure;
