# Antigravity Build Prompt — Finch-Core Web App

Paste this into Antigravity. It assumes the `finch-core` engine modules
(`src/solver`, `src/optimizer`, `src/ifc`, `src/geometry`, `src/types`) already exist
in the repo. Build the application *around* them. Do not rewrite the engine from
scratch; extend and wire it.

---

## Role & standard

You are a senior frontend + computational-geometry engineer. The bar is
**production-grade, enterprise AEC tooling** — comparable in polish to finch3d.com.
No placeholder UI, no lorem ipsum, no fake data, no "TODO" left in shipped paths.
Every feature you add must actually run. If something can't be done well, say so and
leave it documented rather than faked.

## Mission

Build a web app that lets an architect: (1) define a building program in natural
language or a form, (2) generate feasible floor-plan options via NSGA-II, (3) edit
any option in real time in a 2D plan view with live constraint solving, (4) view it
in 3D, and (5) export IFC. Full-building shell (massing → floors → units) as the
visible product, with the **single-floor solver as the deep, defensible core**.

## FIRST TASK — fix the solver (highest priority, do before UI work)

The `area` constraint in `src/solver/ConstraintSolver.ts` is documented as unstable.
Implement the correct fix described in that file's header comment:
- Give each room its own corner vertices; couple rooms via soft `adjacency`
  constraints (already implemented), not shared area-loop vertices.
- Make area correction stable: clamp per-step area change to <20% of current area to
  prevent winding flips, AND add per-room `edgeLength` (rest-length) + an
  angle-preservation constraint so the polygon stays well-conditioned. If PBD tuning
  proves fragile, implement the per-room damped Gauss-Newton least-squares step over
  `[area; edge-lengths; angles]` instead — this is the robust path.
- Prove it: write a test `src/solver/__tests__/area.test.ts` that starts 6 rooms at
  wrong areas and asserts every room reaches within 5% of target and the solve runs
  in < 16ms for a 6-room floor (so it's real-time). Do not proceed to UI until this
  passes.

## Stack (non-negotiable)

- Vite + React 18 + TypeScript (strict).
- Zustand for state. The floor graph is the single source of truth.
- 2D plan editor: SVG (primary editing surface — architects edit in plan).
- 3D view: Three.js (r150+), extruding walls from the same graph. OrbitControls.
- NSGA-II runs in a **Web Worker** (`src/optimizer/worker.ts`) so the UI never blocks;
  stream the Pareto front back per generation.
- Gemini via `@google/generative-ai`, key from `import.meta.env.VITE_GEMINI_KEY`,
  called only to turn NL → `ProgramSpec` JSON (use the type in `src/types`). The LLM
  must NEVER emit geometry. Validate its JSON against the schema; reject and retry on
  malformed output.
- No backend required for v1 (all client-side). Document where a backend would go.

## Features (build in this order, each fully working before the next)

1. **Plan editor (SVG).** Render rooms as filled polygons (color by `RoomType`),
   walls as thick strokes, junctions as draggable handles. Dragging a vertex calls
   the solver and re-renders within the frame. Show live area labels per room and a
   constraint-violation badge (red when a hard constraint is unmet).
2. **Program panel.** A form to set rooms (type, count, target area, min dimension)
   and adjacency requirements, PLUS a natural-language box ("3-bed, 85m², kitchen
   open to living") that calls Gemini → `ProgramSpec` → populates the form. User can
   always edit the form after; the LLM is a starting point, not authority.
3. **Generate (NSGA-II).** "Explore" button kicks off the worker. Show a live Pareto
   front as a scatter (area-error vs circulation, color by daylight). Clicking a point
   loads that layout into the editor. Show generation counter + a stop button.
4. **3D view.** Toggle between plan and 3D. Same graph, walls extruded to height,
   floor slab, simple unlit-but-tasteful material. Camera orbits.
5. **Massing → floors (shallow, honest).** Let the user stack N identical floors and
   set floor height; 3D shows the stack. Be explicit in code comments that inter-floor
   variation and vertical circulation are out of scope for v1.
6. **IFC export.** "Export IFC" downloads a `.ifc` via the existing `exportIFC`. Add a
   note in the UI that it's a feasibility-stage export.

## Design (use the frontend-design principles; avoid AI-slop aesthetics)

- Pick a precise, restrained, *technical* aesthetic: think CAD/engineering software,
  not a SaaS landing page. Dark editor canvas, light precise UI chrome, a single
  sharp accent color. Monospace for numeric/dimension readouts; a clean grotesque or
  a distinctive technical typeface for UI — NOT Inter/Roboto/Arial.
- Plan view: subtle dot grid, snap-to-grid toggle, dimension lines on hover.
- Motion: minimal and functional — solver settling should be visible (vertices ease
  to solved positions), Pareto points fade in per generation. No decorative bounce.
- It must *feel* like a precise instrument. Every pixel intentional.

## Engineering rules

- TypeScript strict, no `any` in committed code.
- Pure functions for all geometry/solver math; side effects only in the store and UI.
- Web Worker boundary: pass plain serializable data (the graph is Maps — convert to
  arrays at the boundary).
- Performance budget: vertex drag → re-solve → re-render under 16ms for floors up to
  ~12 rooms. Profile and document if exceeded.
- Tests for: solver area/adjacency/min-dimension convergence, NSGA-II dominance &
  crowding correctness, IFC output validity (header + entity presence).
- Honest commits: if a feature is partial, the README status table reflects it.

## Definition of done for v1

A user can type a program in plain English, get a Pareto front of feasible plans,
click one, drag a wall and watch the layout re-solve live, switch to 3D, stack
floors, and export an IFC that opens in a viewer. The solver area test passes and the
re-solve stays within frame budget. The repo's README honestly states what is and
isn't done.

## What NOT to do

- Do not let Gemini produce geometry or "draw" plans. It outputs `ProgramSpec` only.
- Do not fake the solver with random or hardcoded layouts to make a demo look good.
- Do not claim Finch parity. Claim: "a graph-based real-time floor-plan core with
  multi-objective generation and IFC export, built solo as a focused slice."
- Do not ship `localStorage`-dependent code in artifacts; use in-memory state.
