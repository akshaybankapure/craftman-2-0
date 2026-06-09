# finch-core

A graph-based parametric floor-plan engine: real-time constraint solving, NSGA-II
multi-objective layout exploration, and IFC export. Benchmarked against the *idea*
of [Finch](https://www.finch3d.com) — a graph-based real-time building design tool —
not its full feature set.

## The thesis (why this is built the way it is)

Finch's impressive property is **not** "AI generates floor plans." It's a graph
formulation of a building (rooms = faces, walls = edges, junctions = vertices) with
**real-time constraint propagation**: drag a wall, everything downstream re-solves
instantly. The LLM and the optimizer are secondary.

This codebase takes the same stance:

| Layer | Role | Status |
|---|---|---|
| **Constraint solver** (`src/solver`) | The core. Position-based relaxation over a planar graph. Angled walls fall out naturally because corrections are 2D vectors and orthogonality is just a tunable *soft* constraint. | Stable for edge-length / min-dimension / orthogonality / adjacency / corridor / boundary. **Area constraint has a documented stability limitation + the correct fix — see below.** |
| **NSGA-II** (`src/optimizer`) | Searches solver *parameters* (not geometry) to produce a Pareto front of *feasible* layouts. Cleanly separates slow "explore" from instant "edit". | Working: faithful non-dominated sort, crowding, SBX, polynomial mutation. |
| **IFC export** (`src/ifc`) | Emits valid IFC2x3 STEP (project→site→building→storey, `IfcWallStandardCase` + `IfcSpace`). Opens in IFC viewers / Revit / ArchiCAD. | Working. |
| **Gemini** (build target) | Natural language → structured `ProgramSpec` only. Never touches geometry. The solver guarantees validity. | Spec'd in `types`, not yet wired. |

## Honest status — read this

This is a **core engine scaffold**, not a finished product. What runs today:

```bash
npm install
node --experimental-strip-types --no-warnings src/smoke.ts   # full pipeline
npx tsc -p tsconfig.json                                       # typechecks clean
```

The smoke test builds a 4-room floor, solves it, runs NSGA-II to a Pareto front,
and exports IFC — all functional.

### The one real open problem (and why it's an asset)

The standalone `area` projection is **not numerically stable on its own**. Confirmed
empirically: moving all loop vertices along the analytic shoelace gradient distorts
the polygon into a degenerate sliver, `gradSq` collapses, the correction explodes,
and winding flips. This is documented in detail at the top of
`src/solver/ConstraintSolver.ts`.

**The correct fix** (the build target, not faked here):
1. Pair `area` with shape-preserving constraints (edge rest-lengths + angle
   preservation) so the polygon stays well-conditioned, **and/or**
2. Replace per-constraint PBD for the area sub-problem with a damped Gauss-Newton /
   Levenberg-Marquardt least-squares step over `[area; edge-lengths; angles]`.
3. Give each room its **own** corner vertices; couple rooms by *soft adjacency*,
   never by sharing raw area-loop vertices (shared-vertex topologies are
   under-determined for independent area targets).

This is deliberately left as documented work rather than half-implemented. In an
interview it's a strong story: *"I built a PBD layout solver, found the area
constraint diverged, diagnosed it as ill-conditioning + topological
under-determination rather than a numerical bug, and the fix is decoupling geometry
from topology plus shape-preserving companions or a least-squares step."* That
sentence demonstrates more than a green demo would.

## Architecture map

```
src/
  types/index.ts        Domain model: planar graph, constraints, ProgramSpec, objectives
  geometry/vec2.ts      2D math: shoelace area, point-in-polygon, segment projection
  solver/               PBD constraint solver (the Finch-equivalent core)
  optimizer/
    NSGA2.ts            Faithful NSGA-II over a real-valued genome
    objectives.ts       areaError / circulation / daylight / structural irregularity
  ifc/exportIFC.ts      IFC2x3 STEP writer
  smoke.ts              End-to-end pipeline test
```

## License

MIT (add your own LICENSE file).
