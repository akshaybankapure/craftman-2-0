/**
 * BHK Templates — Indian residential unit typologies.
 *
 * Each template defines the exact room composition, area ranges, mandatory
 * adjacencies, and attached-bathroom pairings for a BHK variant. Three
 * variants per BHK count: Compact, Standard, Premium — covering the
 * full market spectrum from affordable housing to luxury.
 *
 * These templates are used by:
 *   - ProgramEditor UI (quick-fill from template)
 *   - UnitMix planning (auto-generate floor programs)
 *   - Norm validation (check that a "2BHK" actually meets 2BHK standards)
 *   - NSGA-II (seed initial populations with template-based specs)
 *
 * Sources: NBC 2016, RERA carpet area guidelines, market practice.
 */

import type { ExtendedRoomType } from './roomTypes';

/** A single room requirement within a BHK template. */
export interface RoomRequirement {
  type: ExtendedRoomType;
  count: number;
  /** Target area range (m²). The solver will aim for the typical value. */
  area: { min: number; typical: number; max: number };
  /** Minimum dimension (m). */
  minDimension: number;
}

/** Paired attached bathroom — which bedroom gets which bathroom. */
export interface AttachedBathroomPairing {
  bedroom: ExtendedRoomType;
  bathroom: ExtendedRoomType;
  /** If multiple bedrooms of this type, which index (0-based)? */
  bedroomIndex: number;
}

/** A complete BHK template definition. */
export interface BHKTemplate {
  /** Unique identifier, e.g. "2bhk-standard" */
  id: string;
  /** Human-readable name, e.g. "2 BHK Standard" */
  name: string;
  /** BHK count (1, 1.5, 2, 2.5, 3, 3.5, 4, 5) */
  bhk: number;
  /** Variant tier */
  variant: 'compact' | 'standard' | 'premium';
  /** Total carpet area range (m²) */
  carpetAreaRange: { min: number; max: number };
  /** Mandatory rooms */
  rooms: RoomRequirement[];
  /** Optional rooms (can be toggled by user) */
  optionalRooms: RoomRequirement[];
  /** Mandatory adjacencies — these will become solver constraints. */
  mandatoryAdjacencies: [ExtendedRoomType, ExtendedRoomType][];
  /** Which bedrooms get attached bathrooms. */
  attachedBathrooms: AttachedBathroomPairing[];
  /** Description for UI display. */
  description: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Template definitions
// ═══════════════════════════════════════════════════════════════════════════

const TEMPLATES: BHKTemplate[] = [

  // ─── 1 BHK ─────────────────────────────────────────────────────────────
  {
    id: '1bhk-compact',
    name: '1 BHK Compact',
    bhk: 1,
    variant: 'compact',
    carpetAreaRange: { min: 28, max: 38 },
    rooms: [
      { type: 'living', count: 1, area: { min: 10, typical: 12, max: 14 }, minDimension: 2.7 },
      { type: 'bedroom', count: 1, area: { min: 9.5, typical: 10, max: 12 }, minDimension: 2.7 },
      { type: 'kitchen', count: 1, area: { min: 4.5, typical: 5.5, max: 7 }, minDimension: 1.8 },
      { type: 'commonBathroom', count: 1, area: { min: 2.0, typical: 2.5, max: 3 }, minDimension: 1.2 },
      { type: 'entry', count: 1, area: { min: 1.5, typical: 2, max: 3 }, minDimension: 1.0 },
    ],
    optionalRooms: [
      { type: 'balcony', count: 1, area: { min: 2, typical: 3, max: 4 }, minDimension: 1.2 },
    ],
    mandatoryAdjacencies: [
      ['living', 'kitchen'],
      ['living', 'entry'],
      ['bedroom', 'commonBathroom'],
    ],
    attachedBathrooms: [],
    description: 'Affordable 1BHK for urban markets. Open kitchen-living, single bathroom.',
  },

  {
    id: '1bhk-standard',
    name: '1 BHK Standard',
    bhk: 1,
    variant: 'standard',
    carpetAreaRange: { min: 35, max: 45 },
    rooms: [
      { type: 'living', count: 1, area: { min: 12, typical: 14, max: 16 }, minDimension: 3.0 },
      { type: 'bedroom', count: 1, area: { min: 10, typical: 12, max: 14 }, minDimension: 2.7 },
      { type: 'kitchen', count: 1, area: { min: 5.5, typical: 7, max: 9 }, minDimension: 2.1 },
      { type: 'attachedBathroom', count: 1, area: { min: 2.5, typical: 3, max: 4 }, minDimension: 1.2 },
      { type: 'entry', count: 1, area: { min: 2, typical: 2.5, max: 3.5 }, minDimension: 1.2 },
    ],
    optionalRooms: [
      { type: 'balcony', count: 1, area: { min: 2.5, typical: 3.5, max: 5 }, minDimension: 1.2 },
      { type: 'dryBalcony', count: 1, area: { min: 1.5, typical: 2, max: 3 }, minDimension: 1.0 },
    ],
    mandatoryAdjacencies: [
      ['living', 'kitchen'],
      ['living', 'entry'],
      ['bedroom', 'attachedBathroom'],
    ],
    attachedBathrooms: [
      { bedroom: 'bedroom', bathroom: 'attachedBathroom', bedroomIndex: 0 },
    ],
    description: 'Standard 1BHK with attached bathroom and separate kitchen.',
  },

  // ─── 2 BHK ─────────────────────────────────────────────────────────────
  {
    id: '2bhk-compact',
    name: '2 BHK Compact',
    bhk: 2,
    variant: 'compact',
    carpetAreaRange: { min: 45, max: 58 },
    rooms: [
      { type: 'living', count: 1, area: { min: 12, typical: 14, max: 16 }, minDimension: 3.0 },
      { type: 'masterBedroom', count: 1, area: { min: 10, typical: 12, max: 14 }, minDimension: 2.7 },
      { type: 'bedroom', count: 1, area: { min: 9, typical: 10, max: 12 }, minDimension: 2.7 },
      { type: 'kitchen', count: 1, area: { min: 5.5, typical: 7, max: 9 }, minDimension: 2.1 },
      { type: 'masterBathroom', count: 1, area: { min: 2.5, typical: 3, max: 4 }, minDimension: 1.2 },
      { type: 'commonBathroom', count: 1, area: { min: 2, typical: 2.5, max: 3.5 }, minDimension: 1.2 },
      { type: 'passage', count: 1, area: { min: 2, typical: 3, max: 5 }, minDimension: 1.05 },
      { type: 'entry', count: 1, area: { min: 1.5, typical: 2, max: 3 }, minDimension: 1.0 },
    ],
    optionalRooms: [
      { type: 'balcony', count: 1, area: { min: 2, typical: 3, max: 5 }, minDimension: 1.2 },
    ],
    mandatoryAdjacencies: [
      ['living', 'kitchen'],
      ['living', 'entry'],
      ['masterBedroom', 'masterBathroom'],
      ['bedroom', 'commonBathroom'],
      ['passage', 'bedroom'],
      ['passage', 'masterBedroom'],
    ],
    attachedBathrooms: [
      { bedroom: 'masterBedroom', bathroom: 'masterBathroom', bedroomIndex: 0 },
    ],
    description: 'Compact 2BHK for affordable segment. Master attached, common bath for 2nd bedroom.',
  },

  {
    id: '2bhk-standard',
    name: '2 BHK Standard',
    bhk: 2,
    variant: 'standard',
    carpetAreaRange: { min: 58, max: 75 },
    rooms: [
      { type: 'living', count: 1, area: { min: 14, typical: 18, max: 22 }, minDimension: 3.0 },
      { type: 'dining', count: 1, area: { min: 6, typical: 8, max: 10 }, minDimension: 2.4 },
      { type: 'masterBedroom', count: 1, area: { min: 12, typical: 14, max: 16 }, minDimension: 3.0 },
      { type: 'bedroom', count: 1, area: { min: 10, typical: 12, max: 14 }, minDimension: 2.7 },
      { type: 'kitchen', count: 1, area: { min: 7, typical: 9, max: 11 }, minDimension: 2.1 },
      { type: 'masterBathroom', count: 1, area: { min: 3, typical: 4, max: 5 }, minDimension: 1.5 },
      { type: 'commonBathroom', count: 1, area: { min: 2.5, typical: 3, max: 4 }, minDimension: 1.2 },
      { type: 'corridor', count: 1, area: { min: 3, typical: 4, max: 6 }, minDimension: 1.05 },
      { type: 'entry', count: 1, area: { min: 2, typical: 3, max: 4 }, minDimension: 1.2 },
    ],
    optionalRooms: [
      { type: 'balcony', count: 1, area: { min: 3, typical: 4, max: 6 }, minDimension: 1.2 },
      { type: 'dryBalcony', count: 1, area: { min: 1.5, typical: 2, max: 3 }, minDimension: 1.0 },
      { type: 'utility', count: 1, area: { min: 2, typical: 3, max: 4 }, minDimension: 1.2 },
    ],
    mandatoryAdjacencies: [
      ['living', 'dining'],
      ['dining', 'kitchen'],
      ['living', 'entry'],
      ['masterBedroom', 'masterBathroom'],
      ['bedroom', 'commonBathroom'],
      ['corridor', 'bedroom'],
      ['corridor', 'masterBedroom'],
    ],
    attachedBathrooms: [
      { bedroom: 'masterBedroom', bathroom: 'masterBathroom', bedroomIndex: 0 },
    ],
    description: 'Standard 2BHK with separate dining, master attached, and common bath.',
  },

  {
    id: '2bhk-premium',
    name: '2 BHK Premium',
    bhk: 2,
    variant: 'premium',
    carpetAreaRange: { min: 75, max: 95 },
    rooms: [
      { type: 'living', count: 1, area: { min: 18, typical: 22, max: 28 }, minDimension: 3.6 },
      { type: 'dining', count: 1, area: { min: 8, typical: 10, max: 14 }, minDimension: 2.7 },
      { type: 'masterBedroom', count: 1, area: { min: 14, typical: 18, max: 22 }, minDimension: 3.6 },
      { type: 'bedroom', count: 1, area: { min: 12, typical: 14, max: 16 }, minDimension: 3.0 },
      { type: 'kitchen', count: 1, area: { min: 9, typical: 11, max: 14 }, minDimension: 2.4 },
      { type: 'masterBathroom', count: 1, area: { min: 4, typical: 5.5, max: 7 }, minDimension: 1.8 },
      { type: 'attachedBathroom', count: 1, area: { min: 3, typical: 3.5, max: 4.5 }, minDimension: 1.5 },
      { type: 'corridor', count: 1, area: { min: 4, typical: 5, max: 7 }, minDimension: 1.2 },
      { type: 'foyer', count: 1, area: { min: 3, typical: 4, max: 6 }, minDimension: 1.5 },
    ],
    optionalRooms: [
      { type: 'balcony', count: 2, area: { min: 3, typical: 5, max: 8 }, minDimension: 1.5 },
      { type: 'dryBalcony', count: 1, area: { min: 2, typical: 3, max: 4 }, minDimension: 1.2 },
      { type: 'utility', count: 1, area: { min: 2.5, typical: 3.5, max: 5 }, minDimension: 1.2 },
      { type: 'study', count: 1, area: { min: 5, typical: 7, max: 9 }, minDimension: 2.1 },
      { type: 'dressing', count: 1, area: { min: 3, typical: 4, max: 6 }, minDimension: 1.5 },
    ],
    mandatoryAdjacencies: [
      ['living', 'dining'],
      ['dining', 'kitchen'],
      ['living', 'foyer'],
      ['foyer', 'entry'],
      ['masterBedroom', 'masterBathroom'],
      ['bedroom', 'attachedBathroom'],
      ['corridor', 'bedroom'],
      ['corridor', 'masterBedroom'],
    ],
    attachedBathrooms: [
      { bedroom: 'masterBedroom', bathroom: 'masterBathroom', bedroomIndex: 0 },
      { bedroom: 'bedroom', bathroom: 'attachedBathroom', bedroomIndex: 0 },
    ],
    description: 'Premium 2BHK — both bedrooms with attached baths, foyer, optional study/dressing.',
  },

  // ─── 3 BHK ─────────────────────────────────────────────────────────────
  {
    id: '3bhk-compact',
    name: '3 BHK Compact',
    bhk: 3,
    variant: 'compact',
    carpetAreaRange: { min: 70, max: 90 },
    rooms: [
      { type: 'living', count: 1, area: { min: 14, typical: 16, max: 20 }, minDimension: 3.0 },
      { type: 'dining', count: 1, area: { min: 6, typical: 8, max: 10 }, minDimension: 2.4 },
      { type: 'masterBedroom', count: 1, area: { min: 12, typical: 14, max: 16 }, minDimension: 3.0 },
      { type: 'bedroom', count: 2, area: { min: 9.5, typical: 11, max: 13 }, minDimension: 2.7 },
      { type: 'kitchen', count: 1, area: { min: 7, typical: 8, max: 10 }, minDimension: 2.1 },
      { type: 'masterBathroom', count: 1, area: { min: 3, typical: 3.5, max: 4.5 }, minDimension: 1.5 },
      { type: 'commonBathroom', count: 1, area: { min: 2.5, typical: 3, max: 4 }, minDimension: 1.2 },
      { type: 'corridor', count: 1, area: { min: 4, typical: 5, max: 7 }, minDimension: 1.05 },
      { type: 'entry', count: 1, area: { min: 2, typical: 2.5, max: 3.5 }, minDimension: 1.0 },
    ],
    optionalRooms: [
      { type: 'balcony', count: 1, area: { min: 3, typical: 4, max: 6 }, minDimension: 1.2 },
      { type: 'dryBalcony', count: 1, area: { min: 1.5, typical: 2, max: 3 }, minDimension: 1.0 },
    ],
    mandatoryAdjacencies: [
      ['living', 'dining'],
      ['dining', 'kitchen'],
      ['living', 'entry'],
      ['masterBedroom', 'masterBathroom'],
      ['corridor', 'bedroom'],
      ['corridor', 'masterBedroom'],
      ['corridor', 'commonBathroom'],
    ],
    attachedBathrooms: [
      { bedroom: 'masterBedroom', bathroom: 'masterBathroom', bedroomIndex: 0 },
    ],
    description: 'Compact 3BHK — master attached, common bath shared by 2 bedrooms.',
  },

  {
    id: '3bhk-standard',
    name: '3 BHK Standard',
    bhk: 3,
    variant: 'standard',
    carpetAreaRange: { min: 90, max: 115 },
    rooms: [
      { type: 'living', count: 1, area: { min: 18, typical: 22, max: 28 }, minDimension: 3.6 },
      { type: 'dining', count: 1, area: { min: 8, typical: 10, max: 14 }, minDimension: 2.7 },
      { type: 'masterBedroom', count: 1, area: { min: 14, typical: 16, max: 20 }, minDimension: 3.0 },
      { type: 'bedroom', count: 2, area: { min: 11, typical: 13, max: 15 }, minDimension: 2.7 },
      { type: 'kitchen', count: 1, area: { min: 8, typical: 10, max: 13 }, minDimension: 2.4 },
      { type: 'masterBathroom', count: 1, area: { min: 4, typical: 5, max: 6 }, minDimension: 1.5 },
      { type: 'attachedBathroom', count: 1, area: { min: 2.5, typical: 3.5, max: 4.5 }, minDimension: 1.2 },
      { type: 'commonBathroom', count: 1, area: { min: 2.5, typical: 3, max: 4 }, minDimension: 1.2 },
      { type: 'corridor', count: 1, area: { min: 5, typical: 6, max: 8 }, minDimension: 1.05 },
      { type: 'foyer', count: 1, area: { min: 3, typical: 4, max: 6 }, minDimension: 1.2 },
    ],
    optionalRooms: [
      { type: 'balcony', count: 2, area: { min: 3, typical: 4, max: 7 }, minDimension: 1.2 },
      { type: 'dryBalcony', count: 1, area: { min: 1.5, typical: 2.5, max: 3.5 }, minDimension: 1.0 },
      { type: 'utility', count: 1, area: { min: 2, typical: 3, max: 4 }, minDimension: 1.2 },
      { type: 'pooja', count: 1, area: { min: 2, typical: 3, max: 4 }, minDimension: 1.2 },
    ],
    mandatoryAdjacencies: [
      ['living', 'dining'],
      ['dining', 'kitchen'],
      ['living', 'foyer'],
      ['masterBedroom', 'masterBathroom'],
      ['bedroom', 'attachedBathroom'],
      ['corridor', 'bedroom'],
      ['corridor', 'masterBedroom'],
      ['corridor', 'commonBathroom'],
    ],
    attachedBathrooms: [
      { bedroom: 'masterBedroom', bathroom: 'masterBathroom', bedroomIndex: 0 },
      { bedroom: 'bedroom', bathroom: 'attachedBathroom', bedroomIndex: 0 },
    ],
    description: 'Standard 3BHK — master + 1 attached, common bath for 3rd bedroom, foyer.',
  },

  {
    id: '3bhk-premium',
    name: '3 BHK Premium',
    bhk: 3,
    variant: 'premium',
    carpetAreaRange: { min: 115, max: 150 },
    rooms: [
      { type: 'living', count: 1, area: { min: 22, typical: 28, max: 35 }, minDimension: 3.6 },
      { type: 'dining', count: 1, area: { min: 10, typical: 14, max: 18 }, minDimension: 3.0 },
      { type: 'masterBedroom', count: 1, area: { min: 16, typical: 20, max: 25 }, minDimension: 3.6 },
      { type: 'bedroom', count: 2, area: { min: 12, typical: 15, max: 18 }, minDimension: 3.0 },
      { type: 'kitchen', count: 1, area: { min: 10, typical: 13, max: 16 }, minDimension: 2.7 },
      { type: 'masterBathroom', count: 1, area: { min: 5, typical: 6.5, max: 8 }, minDimension: 1.8 },
      { type: 'attachedBathroom', count: 2, area: { min: 3, typical: 4, max: 5 }, minDimension: 1.5 },
      { type: 'guestToilet', count: 1, area: { min: 1.5, typical: 2, max: 3 }, minDimension: 0.9 },
      { type: 'corridor', count: 1, area: { min: 5, typical: 7, max: 10 }, minDimension: 1.2 },
      { type: 'foyer', count: 1, area: { min: 4, typical: 5, max: 7 }, minDimension: 1.5 },
    ],
    optionalRooms: [
      { type: 'balcony', count: 2, area: { min: 4, typical: 6, max: 10 }, minDimension: 1.5 },
      { type: 'dryBalcony', count: 1, area: { min: 2, typical: 3, max: 4 }, minDimension: 1.2 },
      { type: 'utility', count: 1, area: { min: 3, typical: 4, max: 5.5 }, minDimension: 1.2 },
      { type: 'study', count: 1, area: { min: 6, typical: 8, max: 10 }, minDimension: 2.4 },
      { type: 'pooja', count: 1, area: { min: 2.5, typical: 3, max: 5 }, minDimension: 1.2 },
      { type: 'dressing', count: 1, area: { min: 4, typical: 5, max: 7 }, minDimension: 1.5 },
      { type: 'servantRoom', count: 1, area: { min: 5, typical: 7, max: 9 }, minDimension: 2.1 },
      { type: 'servantBathroom', count: 1, area: { min: 1.5, typical: 2, max: 3 }, minDimension: 0.9 },
    ],
    mandatoryAdjacencies: [
      ['living', 'dining'],
      ['dining', 'kitchen'],
      ['living', 'foyer'],
      ['masterBedroom', 'masterBathroom'],
      ['bedroom', 'attachedBathroom'],
      ['corridor', 'bedroom'],
      ['corridor', 'masterBedroom'],
      ['foyer', 'guestToilet'],
      ['masterBedroom', 'dressing'],
    ],
    attachedBathrooms: [
      { bedroom: 'masterBedroom', bathroom: 'masterBathroom', bedroomIndex: 0 },
      { bedroom: 'bedroom', bathroom: 'attachedBathroom', bedroomIndex: 0 },
      { bedroom: 'bedroom', bathroom: 'attachedBathroom', bedroomIndex: 1 },
    ],
    description: 'Premium 3BHK — all bedrooms attached, guest toilet, dressing, optional servant quarters.',
  },

  // ─── 4 BHK ─────────────────────────────────────────────────────────────
  {
    id: '4bhk-standard',
    name: '4 BHK Standard',
    bhk: 4,
    variant: 'standard',
    carpetAreaRange: { min: 130, max: 170 },
    rooms: [
      { type: 'living', count: 1, area: { min: 22, typical: 28, max: 35 }, minDimension: 3.6 },
      { type: 'dining', count: 1, area: { min: 10, typical: 14, max: 18 }, minDimension: 3.0 },
      { type: 'masterBedroom', count: 1, area: { min: 16, typical: 20, max: 25 }, minDimension: 3.6 },
      { type: 'bedroom', count: 3, area: { min: 12, typical: 14, max: 18 }, minDimension: 3.0 },
      { type: 'kitchen', count: 1, area: { min: 10, typical: 12, max: 16 }, minDimension: 2.4 },
      { type: 'masterBathroom', count: 1, area: { min: 5, typical: 6, max: 8 }, minDimension: 1.8 },
      { type: 'attachedBathroom', count: 2, area: { min: 3, typical: 4, max: 5 }, minDimension: 1.5 },
      { type: 'commonBathroom', count: 1, area: { min: 3, typical: 3.5, max: 4.5 }, minDimension: 1.2 },
      { type: 'guestToilet', count: 1, area: { min: 1.5, typical: 2, max: 3 }, minDimension: 0.9 },
      { type: 'corridor', count: 1, area: { min: 6, typical: 8, max: 12 }, minDimension: 1.2 },
      { type: 'foyer', count: 1, area: { min: 4, typical: 6, max: 8 }, minDimension: 1.5 },
    ],
    optionalRooms: [
      { type: 'balcony', count: 2, area: { min: 4, typical: 6, max: 10 }, minDimension: 1.5 },
      { type: 'dryBalcony', count: 1, area: { min: 2, typical: 3, max: 4 }, minDimension: 1.2 },
      { type: 'utility', count: 1, area: { min: 3, typical: 4, max: 6 }, minDimension: 1.2 },
      { type: 'study', count: 1, area: { min: 7, typical: 9, max: 12 }, minDimension: 2.4 },
      { type: 'pooja', count: 1, area: { min: 3, typical: 4, max: 6 }, minDimension: 1.2 },
      { type: 'dressing', count: 1, area: { min: 4, typical: 6, max: 8 }, minDimension: 1.5 },
      { type: 'servantRoom', count: 1, area: { min: 6, typical: 7, max: 9 }, minDimension: 2.1 },
      { type: 'servantBathroom', count: 1, area: { min: 1.5, typical: 2, max: 3 }, minDimension: 0.9 },
    ],
    mandatoryAdjacencies: [
      ['living', 'dining'],
      ['dining', 'kitchen'],
      ['living', 'foyer'],
      ['masterBedroom', 'masterBathroom'],
      ['bedroom', 'attachedBathroom'],
      ['corridor', 'bedroom'],
      ['corridor', 'masterBedroom'],
      ['corridor', 'commonBathroom'],
      ['foyer', 'guestToilet'],
    ],
    attachedBathrooms: [
      { bedroom: 'masterBedroom', bathroom: 'masterBathroom', bedroomIndex: 0 },
      { bedroom: 'bedroom', bathroom: 'attachedBathroom', bedroomIndex: 0 },
      { bedroom: 'bedroom', bathroom: 'attachedBathroom', bedroomIndex: 1 },
    ],
    description: '4BHK — master + 2 bedrooms attached, 1 common bath, guest toilet, foyer.',
  },

  // ─── 5 BHK ─────────────────────────────────────────────────────────────
  {
    id: '5bhk-premium',
    name: '5 BHK Premium',
    bhk: 5,
    variant: 'premium',
    carpetAreaRange: { min: 200, max: 300 },
    rooms: [
      { type: 'living', count: 1, area: { min: 30, typical: 40, max: 55 }, minDimension: 4.2 },
      { type: 'dining', count: 1, area: { min: 14, typical: 18, max: 25 }, minDimension: 3.0 },
      { type: 'drawingRoom', count: 1, area: { min: 14, typical: 18, max: 25 }, minDimension: 3.6 },
      { type: 'masterBedroom', count: 1, area: { min: 20, typical: 25, max: 30 }, minDimension: 4.2 },
      { type: 'bedroom', count: 4, area: { min: 14, typical: 16, max: 20 }, minDimension: 3.0 },
      { type: 'kitchen', count: 1, area: { min: 12, typical: 16, max: 20 }, minDimension: 3.0 },
      { type: 'masterBathroom', count: 1, area: { min: 6, typical: 8, max: 10 }, minDimension: 2.1 },
      { type: 'attachedBathroom', count: 4, area: { min: 3.5, typical: 4.5, max: 6 }, minDimension: 1.5 },
      { type: 'guestToilet', count: 1, area: { min: 2, typical: 2.5, max: 3.5 }, minDimension: 1.2 },
      { type: 'corridor', count: 1, area: { min: 8, typical: 12, max: 16 }, minDimension: 1.2 },
      { type: 'foyer', count: 1, area: { min: 5, typical: 7, max: 10 }, minDimension: 1.8 },
      { type: 'dressing', count: 1, area: { min: 5, typical: 7, max: 10 }, minDimension: 1.8 },
    ],
    optionalRooms: [
      { type: 'balcony', count: 3, area: { min: 5, typical: 8, max: 12 }, minDimension: 1.5 },
      { type: 'utility', count: 1, area: { min: 4, typical: 5, max: 7 }, minDimension: 1.5 },
      { type: 'study', count: 1, area: { min: 8, typical: 10, max: 14 }, minDimension: 2.7 },
      { type: 'pooja', count: 1, area: { min: 3, typical: 5, max: 7 }, minDimension: 1.5 },
      { type: 'servantRoom', count: 1, area: { min: 7, typical: 9, max: 12 }, minDimension: 2.4 },
      { type: 'servantBathroom', count: 1, area: { min: 2, typical: 2.5, max: 3.5 }, minDimension: 1.2 },
      { type: 'terrace', count: 1, area: { min: 15, typical: 25, max: 50 }, minDimension: 3.0 },
    ],
    mandatoryAdjacencies: [
      ['living', 'dining'],
      ['dining', 'kitchen'],
      ['living', 'foyer'],
      ['drawingRoom', 'foyer'],
      ['masterBedroom', 'masterBathroom'],
      ['masterBedroom', 'dressing'],
      ['bedroom', 'attachedBathroom'],
      ['corridor', 'bedroom'],
      ['corridor', 'masterBedroom'],
      ['foyer', 'guestToilet'],
    ],
    attachedBathrooms: [
      { bedroom: 'masterBedroom', bathroom: 'masterBathroom', bedroomIndex: 0 },
      { bedroom: 'bedroom', bathroom: 'attachedBathroom', bedroomIndex: 0 },
      { bedroom: 'bedroom', bathroom: 'attachedBathroom', bedroomIndex: 1 },
      { bedroom: 'bedroom', bathroom: 'attachedBathroom', bedroomIndex: 2 },
      { bedroom: 'bedroom', bathroom: 'attachedBathroom', bedroomIndex: 3 },
    ],
    description: 'Luxury 5BHK — all bedrooms attached, drawing room, dressing, optional terrace.',
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════════

/** Get all available BHK templates. */
export function getAllTemplates(): readonly BHKTemplate[] {
  return TEMPLATES;
}

/** Get a template by ID. */
export function getTemplateById(id: string): BHKTemplate | undefined {
  return TEMPLATES.find(t => t.id === id);
}

/** Get all templates for a given BHK count. */
export function getTemplatesByBHK(bhk: number): BHKTemplate[] {
  return TEMPLATES.filter(t => t.bhk === bhk);
}

/** Get all templates for a given variant. */
export function getTemplatesByVariant(variant: BHKTemplate['variant']): BHKTemplate[] {
  return TEMPLATES.filter(t => t.variant === variant);
}

/** Get the typical total carpet area for a template (sum of typical room areas). */
export function getTypicalCarpetArea(template: BHKTemplate): number {
  return template.rooms.reduce((sum, r) => sum + r.area.typical * r.count, 0);
}

/**
 * Convert a BHK template + selected optional rooms into a ProgramSpec
 * compatible with the existing solver pipeline.
 */
export function templateToProgramSpec(
  template: BHKTemplate,
  selectedOptionals: string[] = []
): {
  totalAreaTarget: number;
  rooms: Array<{ type: string; count: number; targetArea: number; minDimension: number }>;
  adjacencies: Array<[string, string]>;
} {
  const rooms = template.rooms.map(r => ({
    type: r.type,
    count: r.count,
    targetArea: r.area.typical,
    minDimension: r.minDimension,
  }));

  // Add selected optional rooms
  for (const optType of selectedOptionals) {
    const opt = template.optionalRooms.find(r => r.type === optType);
    if (opt) {
      rooms.push({
        type: opt.type,
        count: opt.count,
        targetArea: opt.area.typical,
        minDimension: opt.minDimension,
      });
    }
  }

  const totalAreaTarget = rooms.reduce((s, r) => s + r.targetArea * r.count, 0);

  return {
    totalAreaTarget,
    rooms,
    adjacencies: template.mandatoryAdjacencies as Array<[string, string]>,
  };
}
