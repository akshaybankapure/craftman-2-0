/**
 * Expanded Room Taxonomy with Architectural Metadata.
 *
 * Every room type carries practical knowledge that an architect relies on:
 * default areas, minimum dimensions, ventilation requirements, plumbing
 * needs, adjacency affinities, and aspect ratio bounds. This data drives
 * constraint generation, norm validation, and the common-mistake checker.
 *
 * Source: NBC 2016 (India), IS 1893, common Indian residential practice.
 * Extensible — add a new RoomType + metadata entry to support new programs.
 */

/** Extended room type taxonomy — covers Indian residential + mixed-use. */
export type ExtendedRoomType =
  // Living
  | 'living'
  | 'dining'
  | 'drawingRoom'
  // Kitchen & service
  | 'kitchen'
  | 'utility'
  | 'wash'
  | 'dryBalcony'
  // Bedrooms
  | 'masterBedroom'
  | 'bedroom'
  | 'childBedroom'
  | 'guestBedroom'
  // Bathrooms
  | 'masterBathroom'     // attached to master bedroom
  | 'attachedBathroom'   // attached to any bedroom
  | 'commonBathroom'     // shared / accessible from corridor
  | 'guestToilet'        // half-bath near entry
  // Circulation
  | 'corridor'
  | 'passage'
  | 'foyer'
  | 'entry'
  | 'lobby'              // common lobby (building-level)
  // Special
  | 'pooja'
  | 'study'
  | 'storage'
  | 'servantRoom'
  | 'servantBathroom'
  | 'dressing'
  | 'loft'
  // Outdoor
  | 'balcony'
  | 'wetBalcony'
  | 'terrace'
  // Building services
  | 'staircase'
  | 'lift'
  | 'duct'               // MEP shaft
  | 'electricalRoom'
  // Other
  | 'office'
  | 'shop'
  | 'parking';

/** Area range in square meters. */
export interface AreaRange {
  min: number;
  typical: number;
  max: number;
}

/** Metadata for a single room type — the domain knowledge an architect uses. */
export interface RoomTypeMetadata {
  label: string;
  category: 'living' | 'bedroom' | 'wetArea' | 'circulation' | 'service' | 'outdoor' | 'building' | 'other';
  /** Default area range (m²). */
  area: AreaRange;
  /** Hard minimum on shortest dimension (m). NBC 2016. */
  minDimension: number;
  /** Minimum ceiling height (m). */
  minCeilingHeight: number;
  /** Must this room have a wall on the building exterior (for windows)? */
  requiresExteriorWall: boolean;
  /** Does this room need natural light (window opening ≥ 1/10 floor area)? */
  naturalLightRequired: boolean;
  /** Does this room need plumbing (must be near a wet stack/shaft)? */
  requiresPlumbing: boolean;
  /** Can a loft be built above this room? */
  canBeLoft: boolean;
  /** Comfortable aspect ratio bounds (width:depth). */
  aspectRatio: { min: number; max: number };
  /** Room types this room "wants" to be adjacent to. */
  adjacencyAffinities: ExtendedRoomType[];
  /** Room types this room must NOT be adjacent to. */
  adjacencyRepulsions: ExtendedRoomType[];
  /** CSS color for plan rendering. */
  color: string;
  /** Short code for compact display. */
  code: string;
}

/**
 * Master registry of all room type metadata.
 * Lookup: ROOM_METADATA.get('masterBedroom')
 */
export const ROOM_METADATA: Map<ExtendedRoomType, RoomTypeMetadata> = new Map([

  // ─── Living Spaces ─────────────────────────────────────────────────────
  ['living', {
    label: 'Living Room',
    category: 'living',
    area: { min: 12, typical: 18, max: 35 },
    minDimension: 3.0,
    minCeilingHeight: 2.75,
    requiresExteriorWall: true,
    naturalLightRequired: true,
    requiresPlumbing: false,
    canBeLoft: true,
    aspectRatio: { min: 0.5, max: 2.0 },
    adjacencyAffinities: ['dining', 'kitchen', 'balcony', 'foyer', 'corridor'],
    adjacencyRepulsions: ['servantRoom', 'servantBathroom', 'duct'],
    color: '#f59e0b',
    code: 'LR',
  }],

  ['dining', {
    label: 'Dining Room',
    category: 'living',
    area: { min: 7, typical: 10, max: 18 },
    minDimension: 2.4,
    minCeilingHeight: 2.75,
    requiresExteriorWall: false,
    naturalLightRequired: true,
    requiresPlumbing: false,
    canBeLoft: false,
    aspectRatio: { min: 0.6, max: 1.8 },
    adjacencyAffinities: ['living', 'kitchen'],
    adjacencyRepulsions: ['commonBathroom', 'guestToilet'],
    color: '#fb923c',
    code: 'DR',
  }],

  ['drawingRoom', {
    label: 'Drawing Room',
    category: 'living',
    area: { min: 12, typical: 16, max: 25 },
    minDimension: 3.0,
    minCeilingHeight: 2.75,
    requiresExteriorWall: true,
    naturalLightRequired: true,
    requiresPlumbing: false,
    canBeLoft: true,
    aspectRatio: { min: 0.5, max: 2.0 },
    adjacencyAffinities: ['foyer', 'entry'],
    adjacencyRepulsions: ['kitchen', 'servantRoom'],
    color: '#fbbf24',
    code: 'DW',
  }],

  // ─── Kitchen & Service ─────────────────────────────────────────────────
  ['kitchen', {
    label: 'Kitchen',
    category: 'wetArea',
    area: { min: 5.5, typical: 9, max: 16 },
    minDimension: 2.1,
    minCeilingHeight: 2.75,
    requiresExteriorWall: true,    // ventilation is critical
    naturalLightRequired: true,
    requiresPlumbing: true,
    canBeLoft: false,
    aspectRatio: { min: 0.5, max: 2.0 },
    adjacencyAffinities: ['dining', 'utility', 'dryBalcony', 'wash'],
    adjacencyRepulsions: ['masterBedroom', 'commonBathroom'],
    color: '#84cc16',
    code: 'KT',
  }],

  ['utility', {
    label: 'Utility / Washing',
    category: 'service',
    area: { min: 2, typical: 3.5, max: 6 },
    minDimension: 1.2,
    minCeilingHeight: 2.4,
    requiresExteriorWall: false,
    naturalLightRequired: false,
    requiresPlumbing: true,
    canBeLoft: false,
    aspectRatio: { min: 0.4, max: 2.5 },
    adjacencyAffinities: ['kitchen', 'dryBalcony'],
    adjacencyRepulsions: ['living', 'masterBedroom'],
    color: '#a3e635',
    code: 'UT',
  }],

  ['wash', {
    label: 'Wash Area',
    category: 'service',
    area: { min: 1.5, typical: 2.5, max: 4 },
    minDimension: 1.0,
    minCeilingHeight: 2.4,
    requiresExteriorWall: false,
    naturalLightRequired: false,
    requiresPlumbing: true,
    canBeLoft: false,
    aspectRatio: { min: 0.5, max: 2.0 },
    adjacencyAffinities: ['kitchen', 'utility'],
    adjacencyRepulsions: ['living'],
    color: '#bef264',
    code: 'WS',
  }],

  ['dryBalcony', {
    label: 'Dry Balcony',
    category: 'outdoor',
    area: { min: 1.5, typical: 3, max: 6 },
    minDimension: 1.2,
    minCeilingHeight: 2.4,
    requiresExteriorWall: true,
    naturalLightRequired: true,
    requiresPlumbing: false,
    canBeLoft: false,
    aspectRatio: { min: 0.3, max: 3.0 },
    adjacencyAffinities: ['kitchen', 'utility'],
    adjacencyRepulsions: [],
    color: '#4ade80',
    code: 'DB',
  }],

  // ─── Bedrooms ──────────────────────────────────────────────────────────
  ['masterBedroom', {
    label: 'Master Bedroom',
    category: 'bedroom',
    area: { min: 12, typical: 16, max: 25 },
    minDimension: 3.0,
    minCeilingHeight: 2.75,
    requiresExteriorWall: true,
    naturalLightRequired: true,
    requiresPlumbing: false,
    canBeLoft: true,
    aspectRatio: { min: 0.5, max: 2.0 },
    adjacencyAffinities: ['masterBathroom', 'dressing', 'balcony'],
    adjacencyRepulsions: ['kitchen', 'servantRoom', 'entry'],
    color: '#818cf8',
    code: 'MB',
  }],

  ['bedroom', {
    label: 'Bedroom',
    category: 'bedroom',
    area: { min: 9.5, typical: 12, max: 18 },
    minDimension: 2.7,
    minCeilingHeight: 2.75,
    requiresExteriorWall: true,
    naturalLightRequired: true,
    requiresPlumbing: false,
    canBeLoft: true,
    aspectRatio: { min: 0.5, max: 2.0 },
    adjacencyAffinities: ['attachedBathroom', 'corridor', 'balcony'],
    adjacencyRepulsions: ['kitchen', 'entry'],
    color: '#a78bfa',
    code: 'BR',
  }],

  ['childBedroom', {
    label: 'Child\'s Bedroom',
    category: 'bedroom',
    area: { min: 7.5, typical: 10, max: 14 },
    minDimension: 2.4,
    minCeilingHeight: 2.75,
    requiresExteriorWall: true,
    naturalLightRequired: true,
    requiresPlumbing: false,
    canBeLoft: true,
    aspectRatio: { min: 0.5, max: 2.0 },
    adjacencyAffinities: ['attachedBathroom', 'corridor'],
    adjacencyRepulsions: ['kitchen', 'entry'],
    color: '#c4b5fd',
    code: 'CB',
  }],

  ['guestBedroom', {
    label: 'Guest Bedroom',
    category: 'bedroom',
    area: { min: 9, typical: 11, max: 16 },
    minDimension: 2.7,
    minCeilingHeight: 2.75,
    requiresExteriorWall: true,
    naturalLightRequired: true,
    requiresPlumbing: false,
    canBeLoft: false,
    aspectRatio: { min: 0.5, max: 2.0 },
    adjacencyAffinities: ['attachedBathroom', 'corridor'],
    adjacencyRepulsions: ['kitchen'],
    color: '#ddd6fe',
    code: 'GB',
  }],

  // ─── Bathrooms ─────────────────────────────────────────────────────────
  ['masterBathroom', {
    label: 'Master Bathroom',
    category: 'wetArea',
    area: { min: 3.5, typical: 5, max: 8 },
    minDimension: 1.5,
    minCeilingHeight: 2.4,
    requiresExteriorWall: false,
    naturalLightRequired: false,    // can have exhaust fan
    requiresPlumbing: true,
    canBeLoft: false,
    aspectRatio: { min: 0.5, max: 2.0 },
    adjacencyAffinities: ['masterBedroom'],
    adjacencyRepulsions: ['kitchen', 'living', 'dining'],
    color: '#38bdf8',
    code: 'MBT',
  }],

  ['attachedBathroom', {
    label: 'Attached Bathroom',
    category: 'wetArea',
    area: { min: 2.5, typical: 3.5, max: 5 },
    minDimension: 1.2,
    minCeilingHeight: 2.4,
    requiresExteriorWall: false,
    naturalLightRequired: false,
    requiresPlumbing: true,
    canBeLoft: false,
    aspectRatio: { min: 0.5, max: 2.0 },
    adjacencyAffinities: ['bedroom', 'childBedroom', 'guestBedroom'],
    adjacencyRepulsions: ['kitchen', 'living', 'dining'],
    color: '#7dd3fc',
    code: 'ABT',
  }],

  ['commonBathroom', {
    label: 'Common Bathroom',
    category: 'wetArea',
    area: { min: 2.5, typical: 3.5, max: 5 },
    minDimension: 1.2,
    minCeilingHeight: 2.4,
    requiresExteriorWall: false,
    naturalLightRequired: false,
    requiresPlumbing: true,
    canBeLoft: false,
    aspectRatio: { min: 0.5, max: 2.0 },
    adjacencyAffinities: ['corridor', 'passage'],
    adjacencyRepulsions: ['kitchen', 'dining'],
    color: '#bae6fd',
    code: 'CBT',
  }],

  ['guestToilet', {
    label: 'Guest Toilet',
    category: 'wetArea',
    area: { min: 1.5, typical: 2.0, max: 3 },
    minDimension: 0.9,
    minCeilingHeight: 2.4,
    requiresExteriorWall: false,
    naturalLightRequired: false,
    requiresPlumbing: true,
    canBeLoft: false,
    aspectRatio: { min: 0.5, max: 2.0 },
    adjacencyAffinities: ['foyer', 'entry', 'corridor'],
    adjacencyRepulsions: ['kitchen', 'dining', 'masterBedroom'],
    color: '#e0f2fe',
    code: 'GT',
  }],

  // ─── Circulation ───────────────────────────────────────────────────────
  ['corridor', {
    label: 'Corridor',
    category: 'circulation',
    area: { min: 2, typical: 5, max: 10 },
    minDimension: 1.05,     // NBC 2016 internal corridor
    minCeilingHeight: 2.4,
    requiresExteriorWall: false,
    naturalLightRequired: false,
    requiresPlumbing: false,
    canBeLoft: false,
    aspectRatio: { min: 0.15, max: 8.0 },  // corridors are long and thin
    adjacencyAffinities: ['bedroom', 'commonBathroom', 'living'],
    adjacencyRepulsions: [],
    color: '#94a3b8',
    code: 'CR',
  }],

  ['passage', {
    label: 'Passage',
    category: 'circulation',
    area: { min: 1.5, typical: 3, max: 6 },
    minDimension: 1.05,
    minCeilingHeight: 2.4,
    requiresExteriorWall: false,
    naturalLightRequired: false,
    requiresPlumbing: false,
    canBeLoft: false,
    aspectRatio: { min: 0.15, max: 8.0 },
    adjacencyAffinities: ['corridor', 'bedroom'],
    adjacencyRepulsions: [],
    color: '#cbd5e1',
    code: 'PS',
  }],

  ['foyer', {
    label: 'Foyer',
    category: 'circulation',
    area: { min: 2, typical: 4, max: 8 },
    minDimension: 1.2,
    minCeilingHeight: 2.75,
    requiresExteriorWall: false,
    naturalLightRequired: false,
    requiresPlumbing: false,
    canBeLoft: false,
    aspectRatio: { min: 0.5, max: 2.0 },
    adjacencyAffinities: ['entry', 'living', 'drawingRoom'],
    adjacencyRepulsions: ['masterBedroom'],
    color: '#e2e8f0',
    code: 'FY',
  }],

  ['entry', {
    label: 'Entry',
    category: 'circulation',
    area: { min: 1.5, typical: 3, max: 5 },
    minDimension: 1.2,
    minCeilingHeight: 2.75,
    requiresExteriorWall: true,    // needs a door to outside
    naturalLightRequired: false,
    requiresPlumbing: false,
    canBeLoft: false,
    aspectRatio: { min: 0.5, max: 2.5 },
    adjacencyAffinities: ['foyer', 'living', 'corridor'],
    adjacencyRepulsions: ['masterBedroom', 'bedroom'],
    color: '#f1f5f9',
    code: 'EN',
  }],

  ['lobby', {
    label: 'Common Lobby',
    category: 'building',
    area: { min: 6, typical: 12, max: 30 },
    minDimension: 2.4,
    minCeilingHeight: 2.75,
    requiresExteriorWall: false,
    naturalLightRequired: true,
    requiresPlumbing: false,
    canBeLoft: false,
    aspectRatio: { min: 0.4, max: 2.5 },
    adjacencyAffinities: ['lift', 'staircase', 'entry'],
    adjacencyRepulsions: [],
    color: '#64748b',
    code: 'LB',
  }],

  // ─── Special Rooms ─────────────────────────────────────────────────────
  ['pooja', {
    label: 'Pooja Room',
    category: 'other',
    area: { min: 2, typical: 3, max: 6 },
    minDimension: 1.2,
    minCeilingHeight: 2.4,
    requiresExteriorWall: false,
    naturalLightRequired: false,
    requiresPlumbing: false,
    canBeLoft: false,
    aspectRatio: { min: 0.5, max: 2.0 },
    adjacencyAffinities: ['kitchen', 'living'],
    adjacencyRepulsions: ['commonBathroom', 'guestToilet'],
    color: '#fcd34d',
    code: 'PJ',
  }],

  ['study', {
    label: 'Study / Home Office',
    category: 'other',
    area: { min: 5, typical: 8, max: 12 },
    minDimension: 2.1,
    minCeilingHeight: 2.75,
    requiresExteriorWall: true,
    naturalLightRequired: true,
    requiresPlumbing: false,
    canBeLoft: false,
    aspectRatio: { min: 0.5, max: 2.0 },
    adjacencyAffinities: ['corridor', 'living'],
    adjacencyRepulsions: ['kitchen'],
    color: '#fde68a',
    code: 'ST',
  }],

  ['storage', {
    label: 'Store Room',
    category: 'service',
    area: { min: 1.5, typical: 3, max: 6 },
    minDimension: 1.0,
    minCeilingHeight: 2.4,
    requiresExteriorWall: false,
    naturalLightRequired: false,
    requiresPlumbing: false,
    canBeLoft: false,
    aspectRatio: { min: 0.4, max: 2.5 },
    adjacencyAffinities: ['corridor', 'kitchen'],
    adjacencyRepulsions: [],
    color: '#d6d3d1',
    code: 'SR',
  }],

  ['servantRoom', {
    label: 'Servant Room',
    category: 'bedroom',
    area: { min: 5, typical: 7, max: 10 },
    minDimension: 2.1,
    minCeilingHeight: 2.4,
    requiresExteriorWall: true,
    naturalLightRequired: true,
    requiresPlumbing: false,
    canBeLoft: false,
    aspectRatio: { min: 0.5, max: 2.0 },
    adjacencyAffinities: ['servantBathroom', 'kitchen', 'utility'],
    adjacencyRepulsions: ['masterBedroom', 'living'],
    color: '#78716c',
    code: 'SV',
  }],

  ['servantBathroom', {
    label: 'Servant Bathroom',
    category: 'wetArea',
    area: { min: 1.5, typical: 2, max: 3 },
    minDimension: 0.9,
    minCeilingHeight: 2.4,
    requiresExteriorWall: false,
    naturalLightRequired: false,
    requiresPlumbing: true,
    canBeLoft: false,
    aspectRatio: { min: 0.5, max: 2.0 },
    adjacencyAffinities: ['servantRoom'],
    adjacencyRepulsions: ['kitchen', 'living'],
    color: '#a8a29e',
    code: 'SBT',
  }],

  ['dressing', {
    label: 'Dressing Room',
    category: 'other',
    area: { min: 3, typical: 5, max: 8 },
    minDimension: 1.5,
    minCeilingHeight: 2.4,
    requiresExteriorWall: false,
    naturalLightRequired: false,
    requiresPlumbing: false,
    canBeLoft: false,
    aspectRatio: { min: 0.5, max: 2.0 },
    adjacencyAffinities: ['masterBedroom', 'masterBathroom'],
    adjacencyRepulsions: [],
    color: '#c084fc',
    code: 'DS',
  }],

  ['loft', {
    label: 'Loft',
    category: 'other',
    area: { min: 3, typical: 6, max: 12 },
    minDimension: 2.0,
    minCeilingHeight: 1.5,   // headroom ON the loft
    requiresExteriorWall: false,
    naturalLightRequired: false,
    requiresPlumbing: false,
    canBeLoft: false,
    aspectRatio: { min: 0.5, max: 2.0 },
    adjacencyAffinities: [],
    adjacencyRepulsions: [],
    color: '#e9d5ff',
    code: 'LF',
  }],

  // ─── Outdoor ───────────────────────────────────────────────────────────
  ['balcony', {
    label: 'Balcony',
    category: 'outdoor',
    area: { min: 2, typical: 4, max: 10 },
    minDimension: 1.2,
    minCeilingHeight: 2.4,
    requiresExteriorWall: true,
    naturalLightRequired: true,
    requiresPlumbing: false,
    canBeLoft: false,
    aspectRatio: { min: 0.2, max: 5.0 },
    adjacencyAffinities: ['living', 'masterBedroom', 'bedroom', 'dining'],
    adjacencyRepulsions: [],
    color: '#34d399',
    code: 'BL',
  }],

  ['wetBalcony', {
    label: 'Wet Balcony',
    category: 'outdoor',
    area: { min: 1.5, typical: 3, max: 5 },
    minDimension: 1.0,
    minCeilingHeight: 2.4,
    requiresExteriorWall: true,
    naturalLightRequired: true,
    requiresPlumbing: true,
    canBeLoft: false,
    aspectRatio: { min: 0.3, max: 3.0 },
    adjacencyAffinities: ['kitchen', 'utility'],
    adjacencyRepulsions: ['living', 'masterBedroom'],
    color: '#6ee7b7',
    code: 'WB',
  }],

  ['terrace', {
    label: 'Terrace',
    category: 'outdoor',
    area: { min: 10, typical: 25, max: 100 },
    minDimension: 2.0,
    minCeilingHeight: 0,   // open to sky
    requiresExteriorWall: true,
    naturalLightRequired: true,
    requiresPlumbing: false,
    canBeLoft: false,
    aspectRatio: { min: 0.3, max: 3.0 },
    adjacencyAffinities: ['living'],
    adjacencyRepulsions: [],
    color: '#a7f3d0',
    code: 'TR',
  }],

  // ─── Building Services ─────────────────────────────────────────────────
  ['staircase', {
    label: 'Staircase',
    category: 'building',
    area: { min: 6, typical: 10, max: 18 },
    minDimension: 2.0,
    minCeilingHeight: 2.2,
    requiresExteriorWall: false,
    naturalLightRequired: true,   // NBC requires natural vent
    requiresPlumbing: false,
    canBeLoft: false,
    aspectRatio: { min: 0.4, max: 2.5 },
    adjacencyAffinities: ['lobby', 'corridor'],
    adjacencyRepulsions: [],
    color: '#475569',
    code: 'SC',
  }],

  ['lift', {
    label: 'Lift',
    category: 'building',
    area: { min: 3, typical: 5, max: 8 },
    minDimension: 1.5,
    minCeilingHeight: 2.4,
    requiresExteriorWall: false,
    naturalLightRequired: false,
    requiresPlumbing: false,
    canBeLoft: false,
    aspectRatio: { min: 0.6, max: 1.6 },
    adjacencyAffinities: ['lobby', 'staircase'],
    adjacencyRepulsions: [],
    color: '#334155',
    code: 'LT',
  }],

  ['duct', {
    label: 'MEP Shaft / Duct',
    category: 'building',
    area: { min: 0.5, typical: 1.5, max: 4 },
    minDimension: 0.6,
    minCeilingHeight: 0,
    requiresExteriorWall: false,
    naturalLightRequired: false,
    requiresPlumbing: true,    // this IS the plumbing shaft
    canBeLoft: false,
    aspectRatio: { min: 0.5, max: 2.0 },
    adjacencyAffinities: ['commonBathroom', 'attachedBathroom', 'masterBathroom', 'kitchen'],
    adjacencyRepulsions: ['living', 'masterBedroom'],
    color: '#1e293b',
    code: 'DT',
  }],

  ['electricalRoom', {
    label: 'Electrical Room',
    category: 'building',
    area: { min: 2, typical: 4, max: 8 },
    minDimension: 1.2,
    minCeilingHeight: 2.4,
    requiresExteriorWall: false,
    naturalLightRequired: false,
    requiresPlumbing: false,
    canBeLoft: false,
    aspectRatio: { min: 0.5, max: 2.0 },
    adjacencyAffinities: ['lobby', 'staircase'],
    adjacencyRepulsions: ['kitchen'],
    color: '#0f172a',
    code: 'ER',
  }],

  // ─── Other ─────────────────────────────────────────────────────────────
  ['office', {
    label: 'Office',
    category: 'other',
    area: { min: 8, typical: 15, max: 40 },
    minDimension: 2.7,
    minCeilingHeight: 2.75,
    requiresExteriorWall: true,
    naturalLightRequired: true,
    requiresPlumbing: false,
    canBeLoft: false,
    aspectRatio: { min: 0.5, max: 2.0 },
    adjacencyAffinities: ['corridor', 'entry'],
    adjacencyRepulsions: [],
    color: '#fca5a5',
    code: 'OF',
  }],

  ['shop', {
    label: 'Shop / Commercial',
    category: 'other',
    area: { min: 12, typical: 25, max: 100 },
    minDimension: 3.0,
    minCeilingHeight: 3.0,
    requiresExteriorWall: true,
    naturalLightRequired: true,
    requiresPlumbing: false,
    canBeLoft: false,
    aspectRatio: { min: 0.3, max: 3.0 },
    adjacencyAffinities: ['entry'],
    adjacencyRepulsions: [],
    color: '#f87171',
    code: 'SH',
  }],

  ['parking', {
    label: 'Parking',
    category: 'other',
    area: { min: 12.5, typical: 15, max: 30 },  // per stall including aisle
    minDimension: 2.5,
    minCeilingHeight: 2.4,
    requiresExteriorWall: false,
    naturalLightRequired: false,
    requiresPlumbing: false,
    canBeLoft: false,
    aspectRatio: { min: 0.3, max: 3.0 },
    adjacencyAffinities: [],
    adjacencyRepulsions: ['living', 'bedroom'],
    color: '#6b7280',
    code: 'PK',
  }],
]);

/**
 * Get metadata for a room type. Returns undefined for unknown types.
 * Use this for safe lookups; use ROOM_METADATA.get() for direct access.
 */
export function getRoomMetadata(type: ExtendedRoomType): RoomTypeMetadata | undefined {
  return ROOM_METADATA.get(type);
}

/**
 * Get the CSS color for a room type — used by plan viewers.
 * Falls back to a neutral gray for unknown types.
 */
export function getRoomColor(type: string): string {
  const meta = ROOM_METADATA.get(type as ExtendedRoomType);
  return meta?.color ?? '#6b7280';
}

/**
 * Check if a room type requires plumbing (must be near a wet stack).
 */
export function isWetRoom(type: ExtendedRoomType): boolean {
  const meta = ROOM_METADATA.get(type);
  return meta?.requiresPlumbing ?? false;
}

/**
 * Check if a room type needs natural light (exterior wall access).
 */
export function needsNaturalLight(type: ExtendedRoomType): boolean {
  const meta = ROOM_METADATA.get(type);
  return meta?.naturalLightRequired ?? false;
}

/**
 * Get all room types in a category.
 */
export function getRoomsByCategory(category: RoomTypeMetadata['category']): ExtendedRoomType[] {
  const result: ExtendedRoomType[] = [];
  for (const [type, meta] of ROOM_METADATA) {
    if (meta.category === category) result.push(type);
  }
  return result;
}
