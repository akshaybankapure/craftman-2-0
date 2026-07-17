/**
 * ProgramBuilder — thin compatibility wrapper over the topology-first generator.
 * Legacy treemap / MST path removed.
 */

import type { ProgramSpec, SolveProblem } from '../types/index.ts';
import {
  buildFromSpecTopologyFirst,
  generateFloorPlanOptions,
  generateOne,
} from './generateFloorPlan.ts';
import type { EntranceDirection, FloorPlan } from './types.ts';
import { floorPlanToSolveProblem } from './toFloorGraph.ts';

export type { EntranceDirection } from './types.ts';
export type { RoomRect } from './types.ts';
export { generateFloorPlanOptions, generateOne, floorPlanToSolveProblem };

/**
 * Build a SolveProblem from a ProgramSpec using topology-first generation.
 * `genome` is treated as a deterministic seed source (first gene).
 */
export function buildFromSpec(
  spec: ProgramSpec,
  outlineW: number,
  outlineH: number,
  genome: number[],
  entranceDirection: EntranceDirection = 'S',
): SolveProblem {
  const seed = genomeToSeed(genome);
  const { problem } = buildFromSpecTopologyFirst(
    spec,
    outlineW,
    outlineH,
    entranceDirection,
    seed,
  );
  return problem;
}

/** Build and return the FloorPlan artifact (for doors / routes / validation UI). */
export function buildFloorPlanFromSpec(
  spec: ProgramSpec,
  outlineW: number,
  outlineH: number,
  genome: number[],
  entranceDirection: EntranceDirection = 'S',
): FloorPlan | null {
  const seed = genomeToSeed(genome);
  const { plan } = buildFromSpecTopologyFirst(
    spec,
    outlineW,
    outlineH,
    entranceDirection,
    seed,
  );
  return plan;
}

export function geneCount(roomCount: number): number {
  return Math.max(4, roomCount * 2);
}

function genomeToSeed(genome: number[]): number {
  if (!genome.length) return 42;
  let h = 2166136261;
  for (const g of genome) {
    h ^= Math.floor(g * 1e6);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0 || 42;
}
