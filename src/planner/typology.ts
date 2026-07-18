/**
 * Building typology → programme + design prefs.
 * Maps Indian BHK templates into the topology-first planner's RoomType model.
 */

import {
  getTemplateById,
  getTemplatesByBHK,
  getTypicalCarpetArea,
  type BHKTemplate,
} from '../domain/bhkTemplates.ts';
import type { ProgramSpec, RoomType } from '../types/index.ts';
import type { EntranceDirection } from './types.ts';
import {
  cloneDesignPrefs,
  DEFAULT_DESIGN_PREFS,
  type DesignPrefs,
} from './optimize/designPrefs.ts';

export type BuildingTypology = 'apartment' | 'house' | 'multi_unit';
export type TemplateVariant = 'compact' | 'standard' | 'premium';

export const TYPOLOGY_OPTIONS: {
  id: BuildingTypology;
  label: string;
  hint: string;
  available: boolean;
}[] = [
  {
    id: 'apartment',
    label: 'Apartment',
    hint: 'Single dwelling unit on a floor',
    available: true,
  },
  {
    id: 'house',
    label: 'House / bungalow',
    hint: 'Independent home — wider rooms, lower corridor share',
    available: true,
  },
  {
    id: 'multi_unit',
    label: 'Multi-unit floor',
    hint: 'Several units + common core on one plate',
    available: false,
  },
];

export const BHK_OPTIONS = [1, 2, 3, 4] as const;

/** Pick best template for BHK + variant (falls back if variant missing). */
export function resolveTemplate(bhk: number, variant: TemplateVariant): BHKTemplate {
  const list = getTemplatesByBHK(bhk);
  if (list.length === 0) {
    const fallback = getTemplateById('2bhk-standard');
    if (!fallback) throw new Error('No BHK templates loaded');
    return fallback;
  }
  return (
    list.find(t => t.variant === variant) ??
    list.find(t => t.variant === 'standard') ??
    list[0]
  );
}

export function availableVariants(bhk: number): TemplateVariant[] {
  const set = new Set(getTemplatesByBHK(bhk).map(t => t.variant));
  return (['compact', 'standard', 'premium'] as TemplateVariant[]).filter(v => set.has(v));
}

/** Default carpet (m²) for typology + template. */
export function defaultCarpetM2(typology: BuildingTypology, template: BHKTemplate): number {
  const { min, max } = template.carpetAreaRange;
  const typical = getTypicalCarpetArea(template);
  // Practical floor for topology-first hard mins (NBC ranges alone can be too tight)
  const practical =
    template.bhk <= 1 ? 60 :
    template.bhk <= 2 ? 78 :
    template.bhk <= 3 ? 110 : 150;
  if (typology === 'house') {
    return clampRound(Math.max(max * 1.12, typical * 1.1, practical * 1.05), min, Math.max(max * 1.4, practical * 1.2));
  }
  return clampRound(Math.max(max * 1.05, typical, practical), min, Math.max(max * 1.35, practical));
}

/**
 * Build a planner ProgramSpec from an Indian BHK template.
 * Domain room types are collapsed into planner RoomTypes.
 */
export function programSpecFromTemplate(
  template: BHKTemplate,
  carpetM2: number,
  typology: BuildingTypology,
): ProgramSpec {
  // Balcony/utility optionals are in domain templates but not yet placed by embedRooms —
  // omit until the embedder supports them (avoids MISSING_ROOM validation failures).
  const raw = [...template.rooms];

  const merged = new Map<RoomType, { count: number; areaSum: number; minDim: number }>();
  for (const r of raw) {
    const type = mapDomainRoomType(r.type);
    if (!type) continue;
    const minDim = Math.max(r.minDimension, plannerMinDim(type));
    const typical = Math.max(r.area.typical, plannerMinArea(type));
    const prev = merged.get(type);
    const area = typical * r.count;
    if (prev) {
      prev.count += r.count;
      prev.areaSum += area;
      prev.minDim = Math.max(prev.minDim, minDim);
    } else {
      merged.set(type, { count: r.count, areaSum: area, minDim });
    }
  }

  // Planner always needs a corridor spine
  if (!merged.has('corridor')) {
    const corr = Math.max(3.5, carpetM2 * (typology === 'house' ? 0.05 : 0.07));
    merged.set('corridor', { count: 1, areaSum: corr, minDim: typology === 'house' ? 1.1 : 1.05 });
  }

  // House: nudge living/bedroom targets slightly larger relative to baths
  if (typology === 'house') {
    for (const key of ['living', 'bedroom', 'kitchen'] as RoomType[]) {
      const row = merged.get(key);
      if (row) row.areaSum *= 1.08;
    }
  }

  const rooms: ProgramSpec['rooms'] = [...merged.entries()].map(([type, v]) => ({
    type,
    count: v.count,
    targetArea: Math.round((v.areaSum / v.count) * 10) / 10,
    minDimension: v.minDim,
  }));

  const adjacencies: ProgramSpec['adjacencies'] = [];
  const seen = new Set<string>();
  for (const [a, b] of template.mandatoryAdjacencies) {
    const ta = mapDomainRoomType(a);
    const tb = mapDomainRoomType(b);
    if (!ta || !tb || ta === tb) continue;
    const key = [ta, tb].sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    adjacencies.push([ta, tb]);
  }
  // Ensure living↔corridor for planner topology
  if (!seen.has(['corridor', 'living'].sort().join('|'))) {
    adjacencies.push(['living', 'corridor']);
  }

  return {
    totalAreaTarget: carpetM2,
    rooms,
    adjacencies,
  };
}

/** Default bathroom count from a template (common + attached). */
export function defaultBathroomCount(template: BHKTemplate): number {
  const n = template.rooms
    .filter(r => r.type.toLowerCase().includes('bathroom'))
    .reduce((s, r) => s + r.count, 0);
  return Math.max(1, n);
}

/**
 * Adjust the bathroom count of a programme spec. The topology generator
 * decides common vs ensuite assignment itself, so all bathrooms are merged
 * into a single planner row.
 */
export function withBathroomCount(spec: ProgramSpec, count: number): ProgramSpec {
  const existing = spec.rooms.find(r => r.type === 'bathroom' || r.type === 'ensuite');
  const rooms = spec.rooms.filter(r => r.type !== 'bathroom' && r.type !== 'ensuite');
  rooms.push({
    type: 'bathroom',
    count: Math.max(1, count),
    targetArea: existing?.targetArea ?? 4,
    minDimension: existing?.minDimension ?? 1.5,
  });
  return { ...spec, rooms };
}

export function resetDesignPrefsFromTypology(
  typology: BuildingTypology,
  entrance: EntranceDirection,
  variant: TemplateVariant,
): DesignPrefs {
  return cloneDesignPrefs(designPrefsForTypology(typology, entrance, variant));
}

/** Prefer open façades away from the entrance for apartments. */
function apartmentDaylightFacades(entrance: EntranceDirection): EntranceDirection[] {
  const opposite: Record<EntranceDirection, EntranceDirection> = {
    N: 'S', S: 'N', E: 'W', W: 'E',
  };
  // Prefer opposite + one side (common Indian dual-aspect)
  const side: Record<EntranceDirection, EntranceDirection> = {
    N: 'E', S: 'E', E: 'N', W: 'N',
  };
  return [opposite[entrance], side[entrance]];
}

function houseDaylightFacades(entrance: EntranceDirection): EntranceDirection[] {
  // Houses: prefer three open sides (everything except entrance wall)
  return (['N', 'S', 'E', 'W'] as EntranceDirection[]).filter(d => d !== entrance);
}

function mapDomainRoomType(type: string): RoomType | null {
  switch (type) {
    case 'living':
    case 'kitchen':
    case 'bedroom':
    case 'bathroom':
    case 'ensuite':
    case 'corridor':
    case 'entry':
    case 'foyer':
    case 'utility':
    case 'storage':
    case 'office':
      return type;
    case 'masterBedroom':
      return 'bedroom';
    case 'commonBathroom':
      return 'bathroom';
    case 'attachedBathroom':
    case 'masterBathroom':
      return 'ensuite';
    case 'passage':
      return 'corridor';
    // Not embedded yet — skip
    case 'balcony':
    case 'dryBalcony':
    case 'pooja':
    case 'servantRoom':
    case 'store':
      return null;
    default:
      return null;
  }
}

/** Align domain template mins with topology-first hard gates. */
function plannerMinDim(type: RoomType): number {
  switch (type) {
    case 'living': return 3.0;
    case 'bedroom': return 2.7;
    case 'kitchen': return 2.1;
    case 'bathroom':
    case 'ensuite': return 1.5;
    case 'corridor': return 1.05;
    case 'entry':
    case 'foyer': return 1.2;
    default: return 1.2;
  }
}

function plannerMinArea(type: RoomType): number {
  switch (type) {
    case 'living': return 12;
    case 'bedroom': return 9.5;
    case 'kitchen': return 5.5;
    case 'bathroom':
    case 'ensuite': return 3.5;
    case 'corridor': return 3.5;
    case 'entry': return 2.5;
    default: return 2;
  }
}

function clampRound(v: number, lo: number, hi: number): number {
  return Math.round(Math.max(lo, Math.min(hi, v)));
}

export { DEFAULT_DESIGN_PREFS };
