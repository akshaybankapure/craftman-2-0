# Craftman — Production Architectural Floor-Plan Tool

Transform the finch-core constraint-solver scaffold into a **real, architect-usable** floor-plan / unit-plan / project-plan design tool with deep domain knowledge of practical architecture.

## Current State Assessment

The codebase has:
- ✅ A working PBD constraint solver (area, minDimension, adjacency, orthogonality, edgeLength, angle, corridor, boundary)
- ✅ NSGA-II multi-objective optimizer
- ✅ IFC2x3 STEP exporter
- ✅ A `ProgramBuilder` that converts specs → planar graphs via squarified treemap
- ✅ Basic React app shell with 2D SVG plan view and 3D Three.js massing view

Critical issues:
- ❌ `App.tsx` imports `TopologyGenerator` from `./optimizer/TopologyGenerator` — **file doesn't exist**, app won't compile
- ❌ `PlanViewer2D.tsx` has a **duplicate `const points =` declaration** on lines 42–50 and references `polygonArea` without importing it
- ❌ `tsconfig.json` doesn't include `.tsx` files (`"include": ["src/**/*.ts"]`)
- ❌ No domain knowledge — no BHK types, no building norms, no attached bathrooms, no ventilation rules, no MEP, no unit-mix
- ❌ No interactive editing (vertex drag)
- ❌ No project-level planning (building + parking + gardens)

---

## User Review Required

> [!IMPORTANT]
> **Target Market**: The plan assumes **Indian residential architecture** as the primary domain (NBC 2016 norms, BHK typology, Indian unit-mix practices) with extensibility for other markets. Should we target a different/additional market?

> [!IMPORTANT]
> **Gemini Integration**: The existing `ANTIGRAVITY_PROMPT.md` specifies using Gemini for NL→ProgramSpec. Should we wire this up in Phase 1, or defer LLM integration and focus on the manual program editor + domain algorithms first?

> [!WARNING]
> **Scope Management**: This plan is large (~40+ files). I recommend executing in phases, shipping each phase as a working checkpoint. The `/goal` command would be well-suited for executing individual phases.

## Open Questions

1. **Building norms jurisdiction**: Should we hardcode NBC 2016 (India) as the primary ruleset, with an extensible norm-provider pattern for other countries?
2. **BHK range**: Should we support 1BHK through 5BHK, or also include studio and penthouse typologies?
3. **Unit-mix format**: Do you want unit-mix to be specified as percentages (e.g., "40% 2BHK, 30% 3BHK") or as absolute counts?
4. **Parking**: Surface parking only, or also basement/stilt/multilevel parking layouts?
5. **MEP depth**: Full MEP routing (plumbing risers, electrical conduits) or just MEP zone reservations (shaft locations, service duct widths)?
6. **Multi-floor**: Should different floors support different unit plans (e.g., typical floor vs. penthouse floor)?

---

## Proposed Changes

### Phase 0 — Fix Critical Bugs (must do first, app currently broken)

#### [MODIFY] [App.tsx](file:///Users/akshaybankapure/craftman/src/App.tsx)
- Replace the missing `TopologyGenerator` import with the existing `buildFromSpec` from `ProgramBuilder.ts`
- Wire up the NSGA-II evaluator to use `buildFromSpec` correctly

#### [MODIFY] [PlanViewer2D.tsx](file:///Users/akshaybankapure/craftman/src/components/PlanViewer2D.tsx)
- Fix duplicate `const points` declaration (lines 42–50)
- Add missing `polygonArea` import from `geometry/vec2`

#### [MODIFY] [tsconfig.json](file:///Users/akshaybankapure/craftman/tsconfig.json)
- Change include to `["src/**/*.ts", "src/**/*.tsx"]`
- Add `"jsx": "react-jsx"` to compilerOptions

---

### Phase 1 — Domain Knowledge Layer (the "brain" that makes this real)

This is the **most important phase** — it's what transforms a generic constraint solver into an architectural tool.

#### [NEW] [src/domain/index.ts](file:///Users/akshaybankapure/craftman/src/domain/index.ts)
Re-export all domain modules.

#### [NEW] [src/domain/roomTypes.ts](file:///Users/akshaybankapure/craftman/src/domain/roomTypes.ts)
Expanded room taxonomy with architectural metadata:
```
RoomType (extended):
  living, dining, kitchen, masterBedroom, bedroom, bathroom, 
  attachedBathroom, commonBathroom, balcony, utility, wash,
  corridor, passage, foyer, entry, pooja, storage, study,
  servantRoom, servantBathroom, dryBalcony, wetBalcony,
  terrace, loft, dressing, staircase, lift, lobby, duct
```
Each room type carries:
- `defaultArea: { min, typical, max }` (m²)
- `minDimension` (m) — narrowest allowable span
- `requiresExteriorWall: boolean` — ventilation requirement
- `requiresPlumbing: boolean` — must be near a wet stack
- `naturalLightRequired: boolean`
- `canBeLoft: boolean` — allowed above this room if double-height
- `typicalAspectRatio: { min, max }` — prevents 1m×30m bedrooms
- `adjacencyAffinities: RoomType[]` — what this room "wants" to be near
- `adjacencyRepulsions: RoomType[]` — what it must NOT be near (e.g., bathroom next to kitchen)

#### [NEW] [src/domain/bhkTemplates.ts](file:///Users/akshaybankapure/craftman/src/domain/bhkTemplates.ts)
BHK typology definitions:
```typescript
interface BHKTemplate {
  name: string;                    // "2BHK-Compact", "3BHK-Premium"
  totalAreaRange: { min, max };    // 45–65m² for compact 2BHK
  rooms: RoomRequirement[];        // exact room list with area ranges
  mandatoryAdjacencies: [RoomType, RoomType][];
  attachedBathrooms: { bedroom: RoomType; bathroom: 'attachedBathroom' }[];
  optionalRooms: RoomRequirement[]; // balcony, study, pooja
}
```
Predefined templates: 1BHK, 1.5BHK, 2BHK, 2.5BHK, 3BHK, 3.5BHK, 4BHK, 5BHK — each with compact/standard/premium variants.

#### [NEW] [src/domain/buildingNorms.ts](file:///Users/akshaybankapure/craftman/src/domain/buildingNorms.ts)
Codified building norms (starting with NBC 2016 India):
- **Minimum room dimensions**: bedroom ≥ 9.5m², kitchen ≥ 5.5m², bathroom ≥ 1.8m², etc.
- **Corridor widths**: internal ≥ 1.05m, common ≥ 1.5m, fire escape ≥ 1.2m
- **Ventilation**: habitable rooms need ≥ 1/10th floor area as openable window area
- **Staircase**: width ≥ 1.0m (residential), riser ≤ 190mm, tread ≥ 250mm
- **Fire norms**: max travel distance to exit, fire door requirements
- **FSI/FAR calculations**: carpet area, built-up area, super-built-up area computation
- **Setbacks**: front, side, rear based on road width and plot area
- **Height restrictions**: based on road width
- **Light/ventilation**: habitable rooms need direct light opening ≥ 1/10th floor area

```typescript
interface BuildingNormSet {
  jurisdiction: string;
  validateUnit(unit: UnitPlan): NormViolation[];
  validateFloor(floor: FloorPlan): NormViolation[];
  validateBuilding(building: BuildingPlan): NormViolation[];
}
```

#### [NEW] [src/domain/unitMix.ts](file:///Users/akshaybankapure/craftman/src/domain/unitMix.ts)
Unit-mix planning:
```typescript
interface UnitMixSpec {
  totalUnitsPerFloor: number;
  mix: { bhkType: string; percentage: number; template: BHKTemplate }[];
}
```
- Validates that percentages sum to 100%
- Computes per-floor area budget
- Generates the combined `ProgramSpec` for a floor
- Tracks carpet-to-super-built-up ratios

#### [NEW] [src/domain/mepRules.ts](file:///Users/akshaybankapure/craftman/src/domain/mepRules.ts)
MEP zone rules:
- **Wet stack clustering**: bathrooms, kitchens, utilities must cluster around plumbing shafts
- **Duct shaft placement**: minimum shaft sizes per floor count
- **Electrical**: meter room, riser shaft, DB location rules
- Validation: "is this bathroom within 3m of a plumbing shaft?"

#### [NEW] [src/domain/loftRules.ts](file:///Users/akshaybankapure/craftman/src/domain/loftRules.ts)
Loft computation:
- Loft allowed when floor-to-ceiling ≥ 4.5m
- Loft area ≤ 25% of room carpet area (NBC norm)
- Minimum headroom under loft: 2.2m
- Minimum headroom on loft: 1.5m
- Only over specific room types (living, bedroom)

#### [NEW] [src/domain/ventilationAnalysis.ts](file:///Users/akshaybankapure/craftman/src/domain/ventilationAnalysis.ts)
Ventilation and natural light analysis:
- Cross-ventilation scoring: room has openings on 2+ walls
- Window-to-floor-area ratio per room
- Light penetration depth (rule of thumb: 2× window head height)
- Identifies "dark rooms" that violate norms

#### [NEW] [src/domain/commonMistakes.ts](file:///Users/akshaybankapure/craftman/src/domain/commonMistakes.ts)
Codified "common architectural mistakes" checker:
- Door opening clashes (doors in corners, doors blocking each other)
- Kitchen not near building entrance for service access
- Bathroom door visible from living/dining
- Bedroom directly opening to kitchen
- No privacy buffer between entrance and bedrooms
- Attached bathroom door placement (should not face bed)
- Servant room without separate entry
- Balcony depth < 1.2m (unusable)
- Corridor > 1.8m (wasted area) or dead-end corridor
- Room aspect ratio > 1:2.5 (uncomfortable proportions)

---

### Phase 2 — Enhanced Constraint System

#### [MODIFY] [src/types/index.ts](file:///Users/akshaybankapure/craftman/src/types/index.ts)
Extend the type system:
- Add new `RoomType` values (all from `roomTypes.ts`)
- Add `UnitPlan`, `FloorPlan`, `BuildingPlan`, `ProjectPlan` interfaces
- Add `NormViolation` type
- Add `ProjectSpec` (building + parking + garden + amenities)

#### [MODIFY] [src/solver/ConstraintSolver.ts](file:///Users/akshaybankapure/craftman/src/solver/ConstraintSolver.ts)
New constraint types:
- `plumbingProximity` — wet rooms must be near shaft positions
- `ventilationAccess` — rooms needing light must touch exterior wall
- `aspectRatio` — prevents degenerate room proportions
- `doorClearance` — ensures door swing doesn't clash
- `privacyBuffer` — minimum path distance between public/private zones

#### [MODIFY] [src/optimizer/objectives.ts](file:///Users/akshaybankapure/craftman/src/optimizer/objectives.ts)
New objective functions:
- `ventilationScore` — cross-ventilation quality
- `privacyScore` — public-to-private gradient quality
- `wetStackEfficiency` — plumbing clustering metric
- `carpetEfficiency` — carpet area / super-built-up ratio
- `normComplianceScore` — fraction of norms satisfied

---

### Phase 3 — Project-Level Planning

#### [NEW] [src/project/ProjectModel.ts](file:///Users/akshaybankapure/craftman/src/project/ProjectModel.ts)
Project-level data model:
```typescript
interface ProjectPlan {
  site: { boundary: Vec2[]; area: number; setbacks: Setbacks };
  buildings: BuildingPlan[];
  parking: ParkingPlan;
  openSpaces: OpenSpacePlan[];  // gardens, play areas, amenity zones
  fsi: { permissible: number; consumed: number };
}
```

#### [NEW] [src/project/SiteLayoutGenerator.ts](file:///Users/akshaybankapure/craftman/src/project/SiteLayoutGenerator.ts)
Site-level layout algorithms:
- Building footprint placement within setback lines
- Parking lot layout (perpendicular/angled/parallel stalls)
- Garden and amenity zone allocation
- Road/driveway access planning
- FSI/FAR computation and tracking

#### [NEW] [src/project/ParkingCalculator.ts](file:///Users/akshaybankapure/craftman/src/project/ParkingCalculator.ts)
- ECS-based parking requirements (1 per unit < 100m², 2 per unit > 100m²)
- Stall dimensions (2.5m × 5.0m standard)
- Aisle widths (6.0m two-way, 3.5m one-way)
- Ramp calculations for basement parking
- Visitor parking allocation

#### [NEW] [src/project/FloorStacker.ts](file:///Users/akshaybankapure/craftman/src/project/FloorStacker.ts)
Multi-floor stacking:
- Typical floor repetition
- Ground floor (different layout — lobby, parking, commercial)
- Terrace floor
- Structural grid alignment across floors
- Vertical circulation core placement (staircase + lift)

---

### Phase 4 — Professional Frontend

#### [NEW] [src/store/appStore.ts](file:///Users/akshaybankapure/craftman/src/store/appStore.ts)
Zustand store with:
- Active project, building, floor, unit state
- Undo/redo history (command pattern)
- Solver state and telemetry
- UI panel state (which panels open)
- Selected entity tracking

#### [MODIFY] [src/App.tsx](file:///Users/akshaybankapure/craftman/src/App.tsx)
Complete rewrite — professional multi-panel layout:
- Left: Project tree + Program editor
- Center: Canvas (2D/3D toggle)
- Right: Properties inspector + Violations panel
- Bottom: Unit-mix dashboard + Telemetry

#### [NEW] [src/components/ProgramEditor.tsx](file:///Users/akshaybankapure/craftman/src/components/ProgramEditor.tsx)
Interactive program definition:
- BHK type selector with variant picker
- Room list with area sliders (min/typical/max from norms)
- Adjacency matrix editor (drag connections)
- Quick-add from BHK templates
- "Validate against norms" button

#### [NEW] [src/components/UnitMixDashboard.tsx](file:///Users/akshaybankapure/craftman/src/components/UnitMixDashboard.tsx)
Unit-mix planning panel:
- Stacked bar chart showing BHK distribution
- Per-type area range visualization
- Total floor area / carpet area / super-built-up computation
- FSI utilization gauge
- "Add unit type" / "Remove" with live area recomputation

#### [NEW] [src/components/ViolationInspector.tsx](file:///Users/akshaybankapure/craftman/src/components/ViolationInspector.tsx)
Building-norm & common-mistake inspector:
- Color-coded violation list (error/warning/info)
- Click violation → highlight offending room/wall on plan
- Categories: "Norms", "Ventilation", "Privacy", "MEP", "Common Mistakes"
- Per-room compliance badge

#### [MODIFY] [src/components/PlanViewer2D.tsx](file:///Users/akshaybankapure/craftman/src/components/PlanViewer2D.tsx)
Major enhancement:
- **Draggable vertices** — mousedown on vertex → track mouse → call solver per frame
- Room color-coding by type (living=warm, bedroom=cool, bathroom=blue, etc.)
- Dimension lines on hover (wall lengths, room dimensions)
- Dot grid with snap-to-grid toggle
- Room labels with area, type, and violation badge
- Door/window indicators
- Attached bathroom highlighting
- MEP shaft indicators
- Zoom/pan with mouse wheel

#### [MODIFY] [src/components/MassingViewer3D.tsx](file:///Users/akshaybankapure/craftman/src/components/MassingViewer3D.tsx)
Enhanced 3D:
- Per-room color differentiation
- Floor stacking visualization
- Building outline with setback visualization
- Site context (parking, gardens)
- Floor selector (click floor to isolate)

#### [NEW] [src/components/ParetoExplorer.tsx](file:///Users/akshaybankapure/craftman/src/components/ParetoExplorer.tsx)
Interactive Pareto front visualization:
- Scatter plot (any 2 objectives as axes)
- Hover → preview layout thumbnail
- Click → load into editor
- Generation slider (animate evolution)
- Color by selected objective

#### [NEW] [src/components/ProjectSiteView.tsx](file:///Users/akshaybankapure/craftman/src/components/ProjectSiteView.tsx)
Site-plan view:
- Building footprints on site boundary
- Setback lines
- Parking layout
- Garden/amenity zones
- Road access points
- FSI utilization overlay

#### [NEW] [src/components/BHKConfigurator.tsx](file:///Users/akshaybankapure/craftman/src/components/BHKConfigurator.tsx)
Visual BHK template configurator:
- Select BHK type → see default room arrangement
- Toggle optional rooms (study, pooja, servant room, extra balcony)
- Adjust area targets per room with sliders
- Preview proportional layout in mini-view
- "Apply to floor" button

---

### Phase 5 — Optimizer & Backend Utilities

#### [NEW] [src/optimizer/worker.ts](file:///Users/akshaybankapure/craftman/src/optimizer/worker.ts)
Web Worker wrapper for NSGA-II:
- Receives `ProgramSpec` + options
- Streams Pareto front back per generation via `postMessage`
- Support stop/pause

#### [NEW] [src/utils/areaCalculator.ts](file:///Users/akshaybankapure/craftman/src/utils/areaCalculator.ts)
Area computation utilities:
- Carpet area (inside wall faces)
- Built-up area (including wall thickness)
- Super built-up area (including common areas pro-rated)
- Balcony area (50% or 100% based on enclosure)
- Loft area calculation

#### [NEW] [src/utils/graphSerializer.ts](file:///Users/akshaybankapure/craftman/src/utils/graphSerializer.ts)
Serialize/deserialize `FloorGraph` (Maps → plain arrays) for:
- Web Worker boundary
- localStorage save/load
- JSON export/import

#### [NEW] [src/utils/snapGrid.ts](file:///Users/akshaybankapure/craftman/src/utils/snapGrid.ts)
Grid snapping utilities:
- Snap to configurable grid (100mm, 300mm, etc.)
- Snap to nearby vertices
- Snap to wall extensions (alignment guides)

#### [MODIFY] [src/ifc/exportIFC.ts](file:///Users/akshaybankapure/craftman/src/ifc/exportIFC.ts)
Enrich IFC export:
- Multi-storey support
- IfcDoor and IfcWindow entities
- Room type as IfcSpace.LongName
- Property sets with area data

---

### Phase 6 — Styling & Polish

#### [MODIFY] [src/styles/index.css](file:///Users/akshaybankapure/craftman/src/styles/index.css)
Complete design system overhaul:
- CAD-precise aesthetic (not SaaS)
- JetBrains Mono for numeric readouts
- Refined glass panels with proper layering
- Animation system for solver settling
- Responsive panel system
- Color palette for all room types
- Violation badge styles

#### [MODIFY] [index.html](file:///Users/akshaybankapure/craftman/index.html)
- Add JetBrains Mono font
- Updated meta descriptions

---

## Verification Plan

### Automated Tests

```bash
# Existing solver test
npx vitest run src/solver/__tests__/area.test.ts

# New tests to add:
npx vitest run src/domain/__tests__/buildingNorms.test.ts   # Norm validation
npx vitest run src/domain/__tests__/bhkTemplates.test.ts    # BHK template validity
npx vitest run src/domain/__tests__/commonMistakes.test.ts  # Mistake detection
npx vitest run src/solver/__tests__/newConstraints.test.ts  # New constraint convergence

# Smoke test
node --experimental-strip-types --no-warnings src/smoke.ts

# TypeScript strict check
npx tsc -p tsconfig.json

# Dev server starts without errors
npm run dev
```

### Manual Verification
- Build and run `npm run dev` — app loads without errors
- Create a 2BHK unit → rooms have correct default areas from norms
- Generate NSGA-II options → Pareto front appears
- Click a Pareto option → plan loads
- Drag a vertex → plan re-solves in real-time
- Switch to 3D → see extruded building
- Check violation panel → shows any norm violations
- Export IFC → file downloads and opens in IFC viewer

---

## Execution Priority

I recommend executing **Phase 0 → Phase 1 → Phase 4 → Phase 2 → Phase 3 → Phase 5 → Phase 6**, because:
1. Phase 0 is required (app is currently broken)
2. Phase 1 (domain knowledge) is the core differentiator
3. Phase 4 (UI) makes it visible and testable
4. The rest builds on the above foundation

Each phase is a shippable checkpoint. Want me to start with Phase 0 + Phase 1?
