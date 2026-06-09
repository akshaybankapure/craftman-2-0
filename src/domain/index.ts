/**
 * Domain Knowledge Layer — re-exports.
 *
 * This is the "brain" of the architectural tool. Import from here
 * rather than individual modules.
 */

// Room taxonomy & metadata
export {
  type ExtendedRoomType,
  type RoomTypeMetadata,
  type AreaRange,
  ROOM_METADATA,
  getRoomMetadata,
  getRoomColor,
  isWetRoom,
  needsNaturalLight,
  getRoomsByCategory,
} from './roomTypes';

// BHK templates
export {
  type BHKTemplate,
  type RoomRequirement,
  type AttachedBathroomPairing,
  getAllTemplates,
  getTemplateById,
  getTemplatesByBHK,
  getTemplatesByVariant,
  getTypicalCarpetArea,
  templateToProgramSpec,
} from './bhkTemplates';

// Building norms (NBC 2016)
export {
  type NormViolation,
  type ViolationSeverity,
  type ViolationCategory,
  type RoomData,
  type FloorData,
  type BuildingData,
  type FSIResult,
  validateRoom,
  validateFloor,
  validateBuilding,
  calculateFSI,
  validateFSI,
  getNormSummary,
} from './buildingNorms';

// Unit mix
export {
  type UnitMixSpec,
  type UnitMixEntry,
  type ResolvedUnitMix,
  type ResolvedEntry,
  type UnitMixTotals,
  resolveUnitMix,
  unitMixToProgramSpec,
  createDefaultUnitMix,
  getUnitCountSummary,
} from './unitMix';

// MEP rules
export {
  type ShaftPosition,
  type RoomPosition,
  type MEPAnalysis,
  analyzeMEP,
  getRecommendedShaftSize,
  suggestShaftPositions,
} from './mepRules';

// Loft rules
export {
  type LoftEligibility,
  type LoftDesign,
  checkLoftEligibility,
  designLoft,
  validateLoft,
  getLoftRulesSummary,
} from './loftRules';

// Ventilation analysis
export {
  type RoomVentilationData,
  type VentilationScore,
  type FloorVentilationAnalysis,
  analyzeRoomVentilation,
  analyzeFloorVentilation,
  hasAdequateExposure,
} from './ventilationAnalysis';

// Common mistakes
export {
  type LayoutRoom,
  type LayoutAnalysis,
  type MistakeCategory,
  checkCommonMistakes,
  getMistakeCategories,
} from './commonMistakes';
