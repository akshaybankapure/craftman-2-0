export type MissionNodeType =
  | 'EXTERIOR'
  | 'ENTRY'
  | 'FOYER'
  | 'PUBLIC_HUB'
  | 'PRIVATE_THRESHOLD'
  | 'CORRIDOR'
  | 'LIVING'
  | 'DINING'
  | 'KITCHEN'
  | 'UTILITY'
  | 'BEDROOM'
  | 'COMMON_BATHROOM'
  | 'ENSUITE'
  | 'BALCONY';

export type MissionEdgeRelationship =
  | 'primary_access'
  | 'secondary_access'
  | 'open_transition'
  | 'service_adjacency';

export type MissionGraphFamily =
  | 'central_living_hub'
  | 'living_integrated_circulation'
  | 'short_private_corridor'
  | 'split_public_private_spine'
  | 'corner_entry_distribution'
  | 'compact_wet_core';

export interface MissionNode {
  id: string;
  type: MissionNodeType;
  required: boolean;
  privacyDepth: number;
  targetArea?: number;
  /** Bedroom id that owns this ensuite. */
  attachedTo?: string;
  label: string;
}

export interface MissionEdge {
  from: string;
  to: string;
  relationship: MissionEdgeRelationship;
  required: boolean;
}

export interface MissionGraph {
  family: MissionGraphFamily;
  nodes: MissionNode[];
  edges: MissionEdge[];
  /** True when a dedicated CORRIDOR / PRIVATE_THRESHOLD node is present. */
  hasDedicatedCirculation: boolean;
}

export const ALL_MISSION_FAMILIES: MissionGraphFamily[] = [
  'central_living_hub',
  'living_integrated_circulation',
  'short_private_corridor',
  'split_public_private_spine',
  'corner_entry_distribution',
  'compact_wet_core',
];

/** Families that prefer no full corridor slab. */
export const CORRIDOR_LESS_FAMILIES: ReadonlySet<MissionGraphFamily> = new Set([
  'central_living_hub',
  'living_integrated_circulation',
  'compact_wet_core',
]);
