/**
 * Unit Mix Planning.
 *
 * Architects and developers don't design single units in isolation — they
 * plan FLOORS with a MIX of unit types. "40% 2BHK, 30% 3BHK, 30% 1BHK"
 * is a typical brief. This module:
 *
 *   1. Validates that a unit-mix specification is internally consistent
 *   2. Computes per-floor area budgets
 *   3. Generates a combined ProgramSpec for a floor from the mix
 *   4. Tracks carpet-area to super-built-up ratios
 *   5. Estimates per-unit and per-floor costs
 *
 * Used by: UnitMixDashboard UI, FloorStacker, NSGA-II floor-level optimizer.
 */

import type { BHKTemplate } from './bhkTemplates';
import { getTemplateById, getTypicalCarpetArea, templateToProgramSpec } from './bhkTemplates';
import type { ExtendedRoomType } from './roomTypes';

// ─── Types ───────────────────────────────────────────────────────────────

/** A single entry in the unit mix — "how many of which template". */
export interface UnitMixEntry {
  /** Template ID, e.g. "2bhk-standard" */
  templateId: string;
  /** Number of units of this type per floor */
  count: number;
  /** Which optional rooms are included (by room type) */
  selectedOptionals: string[];
}

/** Complete unit mix for a floor. */
export interface UnitMixSpec {
  /** Human-readable name for this mix, e.g. "Tower A Typical Floor" */
  name: string;
  /** All unit types in the mix */
  entries: UnitMixEntry[];
  /** Common area per floor (lobby, staircase, lift, corridors) in m² */
  commonAreaPerFloor: number;
  /** Wall thickness (m) for built-up area calculation */
  wallThickness: number;
}

/** Resolved mix — after computing areas and validating. */
export interface ResolvedUnitMix {
  spec: UnitMixSpec;
  entries: ResolvedEntry[];
  totals: UnitMixTotals;
  errors: string[];
}

export interface ResolvedEntry {
  templateId: string;
  template: BHKTemplate;
  count: number;
  selectedOptionals: string[];
  /** Carpet area per unit (m²) */
  carpetAreaPerUnit: number;
  /** Built-up area per unit (carpet + walls) */
  builtUpAreaPerUnit: number;
  /** Super built-up area per unit (built-up + common area share) */
  superBuiltUpAreaPerUnit: number;
  /** Percentage this entry takes of total floor carpet area */
  floorPercentage: number;
}

export interface UnitMixTotals {
  totalUnitsPerFloor: number;
  totalCarpetArea: number;       // m²
  totalBuiltUpArea: number;      // m²
  totalSuperBuiltUpArea: number; // m²
  commonArea: number;            // m²
  /** carpet / super-built-up ratio (efficiency indicator) */
  carpetEfficiency: number;
  /** Distribution by BHK count */
  bhkDistribution: Map<number, { count: number; percentage: number }>;
}

// ─── Resolution & Computation ────────────────────────────────────────────

/**
 * Resolve a unit mix specification — validate, compute areas, and
 * produce a fully computed result.
 */
export function resolveUnitMix(spec: UnitMixSpec): ResolvedUnitMix {
  const errors: string[] = [];
  const entries: ResolvedEntry[] = [];

  // Validate and resolve each entry
  for (const entry of spec.entries) {
    const template = getTemplateById(entry.templateId);
    if (!template) {
      errors.push(`Unknown template ID: ${entry.templateId}`);
      continue;
    }

    if (entry.count <= 0) {
      errors.push(`Invalid count for ${template.name}: ${entry.count}`);
      continue;
    }

    const carpetArea = computeCarpetArea(template, entry.selectedOptionals);
    // Built-up = carpet + wall area (approx 10-15% for walls)
    const wallFactor = 1 + (spec.wallThickness * 4 / Math.sqrt(carpetArea)); // rough perimeter estimate
    const builtUpArea = carpetArea * Math.max(1.1, wallFactor);

    entries.push({
      templateId: entry.templateId,
      template,
      count: entry.count,
      selectedOptionals: entry.selectedOptionals,
      carpetAreaPerUnit: carpetArea,
      builtUpAreaPerUnit: builtUpArea,
      superBuiltUpAreaPerUnit: 0, // computed after totals
      floorPercentage: 0,         // computed after totals
    });
  }

  // Compute totals
  const totalUnitsPerFloor = entries.reduce((s, e) => s + e.count, 0);
  const totalCarpetArea = entries.reduce((s, e) => s + e.carpetAreaPerUnit * e.count, 0);
  const totalBuiltUpArea = entries.reduce((s, e) => s + e.builtUpAreaPerUnit * e.count, 0);
  const commonArea = spec.commonAreaPerFloor;
  const totalSuperBuiltUpArea = totalBuiltUpArea + commonArea;

  // Distribute common area proportionally
  for (const entry of entries) {
    const share = totalCarpetArea > 0
      ? (entry.carpetAreaPerUnit * entry.count) / totalCarpetArea
      : 0;
    const commonShare = (commonArea * share) / entry.count;
    entry.superBuiltUpAreaPerUnit = entry.builtUpAreaPerUnit + commonShare;
    entry.floorPercentage = totalCarpetArea > 0
      ? ((entry.carpetAreaPerUnit * entry.count) / totalCarpetArea) * 100
      : 0;
  }

  // BHK distribution
  const bhkDist = new Map<number, { count: number; percentage: number }>();
  for (const entry of entries) {
    const bhk = entry.template.bhk;
    const existing = bhkDist.get(bhk) ?? { count: 0, percentage: 0 };
    existing.count += entry.count;
    existing.percentage = totalUnitsPerFloor > 0
      ? (existing.count / totalUnitsPerFloor) * 100
      : 0;
    bhkDist.set(bhk, existing);
  }

  const carpetEfficiency = totalSuperBuiltUpArea > 0
    ? totalCarpetArea / totalSuperBuiltUpArea
    : 0;

  return {
    spec,
    entries,
    totals: {
      totalUnitsPerFloor,
      totalCarpetArea,
      totalBuiltUpArea,
      totalSuperBuiltUpArea,
      commonArea,
      carpetEfficiency,
      bhkDistribution: bhkDist,
    },
    errors,
  };
}

/**
 * Generate a combined ProgramSpec from a unit mix.
 * This merges all unit programs into a single floor-level spec
 * for the constraint solver.
 */
export function unitMixToProgramSpec(
  resolved: ResolvedUnitMix,
  floorWidth: number,
  floorDepth: number
): {
  totalAreaTarget: number;
  rooms: Array<{ type: string; count: number; targetArea: number; minDimension: number }>;
  adjacencies: Array<[string, string]>;
} {
  const rooms: Array<{ type: string; count: number; targetArea: number; minDimension: number }> = [];
  const adjacencies: Array<[string, string]> = [];

  let unitIndex = 0;
  for (const entry of resolved.entries) {
    for (let u = 0; u < entry.count; u++) {
      const unitSpec = templateToProgramSpec(entry.template, entry.selectedOptionals);
      
      // Prefix room types with unit index to avoid merging across units
      // (each unit is its own constraint island)
      for (const room of unitSpec.rooms) {
        rooms.push({
          type: room.type,
          count: room.count,
          targetArea: room.targetArea,
          minDimension: room.minDimension,
        });
      }
      
      // Adjacencies within each unit
      for (const adj of unitSpec.adjacencies) {
        adjacencies.push(adj);
      }
      
      unitIndex++;
    }
  }

  // Add common areas
  rooms.push(
    { type: 'lobby', count: 1, targetArea: 12, minDimension: 2.4 },
    { type: 'staircase', count: 1, targetArea: 10, minDimension: 2.0 },
    { type: 'lift', count: 1, targetArea: 5, minDimension: 1.5 },
  );

  const totalAreaTarget = rooms.reduce((s, r) => s + r.targetArea * r.count, 0);

  return { totalAreaTarget, rooms, adjacencies };
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function computeCarpetArea(template: BHKTemplate, selectedOptionals: string[]): number {
  let area = template.rooms.reduce((s, r) => s + r.area.typical * r.count, 0);
  
  for (const optType of selectedOptionals) {
    const opt = template.optionalRooms.find(r => r.type === optType);
    if (opt) {
      area += opt.area.typical * opt.count;
    }
  }
  
  return area;
}

/**
 * Create a default unit mix for quick prototyping.
 */
export function createDefaultUnitMix(): UnitMixSpec {
  return {
    name: 'Default Residential Mix',
    entries: [
      { templateId: '2bhk-standard', count: 2, selectedOptionals: ['balcony'] },
      { templateId: '3bhk-compact', count: 2, selectedOptionals: ['balcony'] },
    ],
    commonAreaPerFloor: 30,
    wallThickness: 0.2,
  };
}

/**
 * Compute a quick unit-count summary (for dashboard display).
 */
export function getUnitCountSummary(spec: UnitMixSpec): Map<string, number> {
  const summary = new Map<string, number>();
  for (const entry of spec.entries) {
    const template = getTemplateById(entry.templateId);
    const key = template ? template.name : entry.templateId;
    summary.set(key, (summary.get(key) ?? 0) + entry.count);
  }
  return summary;
}
