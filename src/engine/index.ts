/**
 * Multi-layer floorplan engine public surface.
 * Kernel → sub-engines → orchestrator. Planner facade remains generateFloorPlan.ts.
 */

export * from './kernel/index.ts';
export { resolveContextProfile } from './context/contextProfile.ts';
export type { ContextProfile, CorridorPolicy, RegionId } from './context/contextProfile.ts';
export {
  generateMissionGraph,
  generateMissionGraphVariants,
  eligibleFamilies,
} from './topology/missionFamilies.ts';
export { validateMissionGraph } from './topology/missionValidate.ts';
export { missionGraphToAccessTree } from './topology/toAccessTree.ts';
export type { MissionGraph, MissionGraphFamily } from './topology/missionTypes.ts';
export { resolveCirculationDemand } from './circulation/demandModel.ts';
export { growPlanFromMission } from './geometry/growPlan.ts';
export { validateFurniture } from './furniture/templates.ts';
export { runVirtualOccupantPlaytests } from './simulation/journeys.ts';
export { FamilyBandit } from './orchestrator/bandit.ts';
export {
  calculateLayoutFingerprint,
  fingerprintSimilarity,
  isNearDuplicate,
} from './search/fingerprint.ts';
