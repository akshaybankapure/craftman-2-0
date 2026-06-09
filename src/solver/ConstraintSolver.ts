/**
 * Position-Based Constraint Solver for floor-plan graphs.
 *
 * ============================================================================
 * KNOWN LIMITATION (read before relying on the area constraint):
 *
 *   The standalone `area` projection (analytic shoelace gradient) is NOT
 *   numerically stable on its own. Moving all free loop vertices along the area
 *   gradient simultaneously distorts the polygon into a degenerate sliver:
 *   `gradSq` collapses toward zero, `lambda = err/gradSq` explodes, and the
 *   polygon winding flips (area goes negative) and diverges. This was confirmed
 *   empirically — area went 9 -> 0.56 -> -3.5 -> blow-up within a few passes.
 *
 *   CORRECT FIX (not yet implemented here — this is the build target):
 *     The area constraint must be paired with SHAPE-PRESERVING constraints so
 *     the polygon stays well-conditioned while its area is corrected. Two viable
 *     approaches, in order of robustness:
 *       1. Per-step least-squares: assemble the Jacobian of [area; edge-lengths;
 *          angles] and take a damped Gauss-Newton / Levenberg-Marquardt step.
 *          Stable, the "real" way Finch-class tools do it.
 *       2. Pure PBD: add edgeLength constraints (rest lengths) and angle-
 *          preservation constraints on every room loop, and apply the area
 *          correction with a step clamped so |dArea| < 0.2*|area| per pass to
 *          prevent winding flips. Lighter weight, needs careful tuning.
 *     Either way, give each room its OWN corner vertices (do not share raw
 *     vertices across rooms for area loops); couple rooms via SOFT adjacency
 *     constraints instead. Shared-vertex topologies are under-determined for
 *     independent area targets and settle into degenerate equilibria.
 *
 *   The edgeLength, minDimension, orthogonality, adjacency, corridorWidth, and
 *   boundary projections below ARE stable and usable as-is.
 * ============================================================================
 *
 * WHY THIS DESIGN (the interview answer):
 *
 *   Architectural layout is an over-constrained geometry problem. A least-squares
 *   global solve (e.g. building a big sparse Jacobian and Newton-stepping) is
 *   accurate but slow and brittle when constraints conflict — which they always
 *   do in real layouts. Instead we use POSITION-BASED DYNAMICS (PBD): each
 *   constraint computes a positional correction for the vertices it touches, and
 *   we apply corrections iteratively (Gauss-Seidel style) until the system settles.
 *
 *   PBD is the standard technique in real-time physics (cloth, soft bodies). It
 *   is unconditionally stable, handles conflicting constraints gracefully (they
 *   just reach a compromise), and — critically for the "drag a wall and watch it
 *   resolve" feel — converges enough in a handful of iterations to run inside a
 *   16ms frame.
 *
 *   ANGLED WALLS: because corrections are computed as 2D vectors (not per-axis),
 *   nothing here assumes walls are axis-aligned. Orthogonality is just one more
 *   SOFT constraint with a tunable stiffness; set it high to get a near-rectilinear
 *   plan, low to allow free angles. That is the whole reason angled walls "fall
 *   out for free" of this architecture.
 *
 * Hard vs soft: hard constraints get a full-strength projection every iteration;
 * soft constraints get stiffness-scaled corrections. We run hard constraints in
 * an inner loop so feasibility is prioritized over optimization.
 */

import type {
  Constraint,
  FloorGraph,
  SolveProblem,
  Vec2,
  VertexId,
} from '../types/index.ts';
import {
  add,
  closestOnSegment,
  cross,
  dist,
  normalize,
  perp,
  pointInPolygon,
  polygonArea,
  scale,
  sub,
} from '../geometry/vec2.ts';

export interface SolveOptions {
  iterations: number;       // outer iterations
  hardSubsteps: number;     // inner projections for hard constraints per outer iter
  /** Global damping applied to every correction; keeps the system from oscillating. */
  damping: number;
  /** Convergence threshold: stop when max vertex movement < this (meters). */
  epsilon: number;
}

export const DEFAULT_SOLVE_OPTIONS: SolveOptions = {
  iterations: 24,
  hardSubsteps: 3,
  damping: 0.85,
  epsilon: 1e-4,
};

/** Accumulator: we sum corrections per vertex and apply once per pass, so a
 *  vertex touched by many constraints moves toward the weighted average rather
 *  than chasing the last constraint (this is what stabilizes the angled case). */
interface Correction {
  delta: Vec2;
  weight: number;
}

export class ConstraintSolver {
  private graph: FloorGraph;
  private constraints: Constraint[];
  private outline: Vec2[];

  constructor(problem: SolveProblem) {
    this.graph = problem.graph;
    this.constraints = problem.constraints;
    this.outline = problem.outline;
  }

  /** Run the solver in place on the graph. Returns the number of iterations
   *  actually used (useful for telemetry / proving convergence). */
  solve(opts: SolveOptions = DEFAULT_SOLVE_OPTIONS): number {
    const hard = this.constraints.filter((c) => c.hard);
    const soft = this.constraints.filter((c) => !c.hard);

    for (let iter = 0; iter < opts.iterations; iter++) {
      let maxMove = 0;
      // Inner loop: project hard constraints to feasibility first.
      for (let s = 0; s < opts.hardSubsteps; s++) {
        const move = this.projectPass(hard, opts.damping);
        maxMove = Math.max(maxMove, move);
      }
      // Then a single soft pass nudges toward the objective.
      const move = this.projectPass(soft, opts.damping);
      maxMove = Math.max(maxMove, move);

      if (maxMove < opts.epsilon) return iter + 1;
    }
    return opts.iterations;
  }

  /** One Gauss-Seidel pass over a constraint set. Returns max vertex displacement.
   *
   *  Corrections are SUMMED (not weight-averaged). Each constraint's projection
   *  already returns the exact displacement it wants for the vertex; stiffness
   *  scales that magnitude. A vertex touched by several constraints therefore
   *  moves by the (stiffness-weighted) sum of their demands, which is the correct
   *  PBD behavior. We divide only by a per-vertex constraint COUNT to keep the
   *  step bounded when many constraints pile on one vertex (prevents overshoot /
   *  the divergence that weight-averaging by gradient magnitude caused). */
  private projectPass(constraints: Constraint[], damping: number): number {
    const acc = new Map<VertexId, Correction>();
    const accumulate = (id: VertexId, delta: Vec2, weight: number) => {
      const cur = acc.get(id) ?? { delta: { x: 0, y: 0 }, weight: 0 };
      cur.delta = add(cur.delta, scale(delta, weight));
      cur.weight += 1; // COUNT of contributing constraints, not summed weights
      acc.set(id, cur);
    };

    for (const c of constraints) {
      this.evaluate(c, accumulate);
    }

    let maxMove = 0;
    for (const [id, corr] of acc) {
      const vert = this.graph.vertices.get(id);
      if (!vert || vert.pinned || corr.weight < 1) continue;
      // Average over the NUMBER of constraints (relaxation), then damp.
      let move = scale(corr.delta, damping / corr.weight);
      // Hard clamp on per-pass displacement.
      const MAX_STEP = 0.2; // meters per pass (stable default)
      const m = Math.hypot(move.x, move.y);
      if (m > MAX_STEP) move = scale(move, MAX_STEP / m);
      vert.pos = add(vert.pos, move);
      maxMove = Math.max(maxMove, Math.hypot(move.x, move.y));
    }

    this.enforceOutline();
    return maxMove;
  }

  /** Dispatch a constraint to its projection routine. The `out` callback receives
   *  (vertexId, desiredDelta, weight). */
  private evaluate(
    c: Constraint,
    out: (id: VertexId, delta: Vec2, weight: number) => void
  ): void {
    const w = c.hard ? 1.0 : c.stiffness;
    switch (c.kind) {
      case 'area':
        this.projectArea(c, w, out);
        break;
      case 'edgeLength':
        this.projectEdgeLength(c, w, out);
        break;
      case 'angle':
        this.projectAngle(c, w, out);
        break;
      case 'minDimension':
        this.projectMinDimension(c, w, out);
        break;
      case 'orthogonality':
        this.projectOrthogonality(c, w, out);
        break;
      case 'adjacency':
        this.projectAdjacency(c, w, out);
        break;
      case 'corridorWidth':
        this.projectCorridorWidth(c, w, out);
        break;
      case 'boundary':
        // handled globally by enforceOutline()
        break;
    }
  }

  // --- Area constraint --------------------------------------------------------
  // Gradient of polygon area w.r.t. a vertex p_i is 0.5 * perp(p_{i+1} - p_{i-1}).
  // We move every loop vertex along its area-gradient to push the measured area
  // toward target. This is the exact analytic gradient of the shoelace formula,
  // which is why it converges fast and works for arbitrary (angled) polygons.
  private projectArea(
    c: Constraint,
    w: number,
    out: (id: VertexId, d: Vec2, weight: number) => void
  ): void {
    const faceId = c.targets.faces?.[0];
    if (!faceId) return;
    const face = this.graph.faces.get(faceId);
    if (!face) return;

    const pts = face.loop.map((id) => this.graph.vertices.get(id)!.pos);
    const area = polygonArea(pts);
    const target = c.params.target ?? face.targetArea;
    
    // STABLE AREA CORRECTION:
    // 1. Clamp error so we never try to change area by more than 20% in one pass.
    // This prevents the "winding flip" where a large correction overshoots and 
    // makes the polygon self-intersect or invert.
    const currentAreaAbs = Math.max(1.0, Math.abs(area));
    const maxDelta = currentAreaAbs * 0.2; // small steps for stability
    let err = target - area;
    if (Math.abs(err) > maxDelta) {
      err = Math.sign(err) * maxDelta;
    }

    if (Math.abs(err) < 1e-6) return;

    // 2. Analytic gradient of shoelace area.
    let gradSq = 0;
    const grads: Vec2[] = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const prev = pts[(i - 1 + n) % n];
      const next = pts[(i + 1) % n];
      // The gradient of the shoelace area A w.r.t. p_i is 0.5 * (y_{i+1}-y_{i-1}, x_{i-1}-x_{i+1})
      // which is 0.5 * perp_cw(p_{i+1} - p_{i-1}).
      // Our perp() is CCW, so we use -perp(next - prev).
      const g = scale(perp(sub(next, prev)), -0.5);
      grads.push(g);
      gradSq += g.x * g.x + g.y * g.y;
    }
    if (gradSq < 1e-9) return;

    // 3. Apply correction delta.
    const lambda = (err / gradSq);
    for (let i = 0; i < n; i++) {
      out(face.loop[i], scale(grads[i], lambda), w);
    }
  }

  // --- Angle preservation (rest-angle) ----------------------------------------
  // PBD angle constraint: keeps the triangle (prev, curr, next) at target area
  // or uses dot/cross product to restore the interior angle.
  private projectAngle(
    c: Constraint,
    w: number,
    out: (id: VertexId, d: Vec2, weight: number) => void
  ): void {
    const targets = c.targets.vertices;
    if (!targets || targets.length !== 3) return;
    const [idA, idB, idC] = targets;
    const pa = this.graph.vertices.get(idA)!.pos;
    const pb = this.graph.vertices.get(idB)!.pos;
    const pc = this.graph.vertices.get(idC)!.pos;

    const v1 = sub(pa, pb);
    const v2 = sub(pc, pb);
    const l1 = Math.hypot(v1.x, v1.y);
    const l2 = Math.hypot(v2.x, v2.y);
    if (l1 < 1e-6 || l2 < 1e-6) return;

    const currentAng = Math.atan2(v2.y, v2.x) - Math.atan2(v1.y, v1.x);
    const targetAng = c.params.target; // rest angle
    let diff = currentAng - targetAng;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;

    if (Math.abs(diff) < 1e-6) return;

    // Move A and C perpendicular to their arms to restore angle.
    // This is a simplified PBD angle constraint.
    const p1 = scale(perp(v1), 1 / l1);
    const p2 = scale(perp(v2), -1 / l2);

    out(idA, scale(p1, diff * l1 * 0.5), w);
    out(idC, scale(p2, diff * l2 * 0.5), w);
  }

  // --- Edge length ------------------------------------------------------------
  private projectEdgeLength(
    c: Constraint,
    w: number,
    out: (id: VertexId, d: Vec2, weight: number) => void
  ): void {
    const edgeId = c.targets.edges?.[0];
    if (!edgeId) return;
    const edge = this.graph.edges.get(edgeId);
    if (!edge) return;
    const a = this.graph.vertices.get(edge.a)!;
    const b = this.graph.vertices.get(edge.b)!;
    const d = sub(b.pos, a.pos);
    const l = Math.hypot(d.x, d.y);
    if (l < 1e-9) return;
    const min = c.params.min ?? 0;
    const max = c.params.max ?? Infinity;
    let targetL = l;
    if (l < min) targetL = min;
    else if (l > max) targetL = max;
    else return;
    const dir = scale(d, 1 / l);
    const corr = scale(dir, (targetL - l) / 2);
    out(edge.a, scale(corr, -1), w);
    out(edge.b, corr, w);
  }

  // --- Minimum room dimension -------------------------------------------------
  // Approximate the narrowest span by the min distance between non-adjacent
  // edges of the loop, and push those edges apart if below min. Works for
  // convex-ish rooms which is the common case; documented limitation for
  // strongly non-convex rooms.
  private projectMinDimension(
    c: Constraint,
    w: number,
    out: (id: VertexId, d: Vec2, weight: number) => void
  ): void {
    const faceId = c.targets.faces?.[0];
    if (!faceId) return;
    const face = this.graph.faces.get(faceId);
    if (!face) return;
    const min = c.params.min ?? face.minDimension;
    const loop = face.loop;
    const n = loop.length;
    const P = loop.map((id) => this.graph.vertices.get(id)!.pos);

    for (let i = 0; i < n; i++) {
      const a = P[i];
      const b = P[(i + 1) % n];
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue; // adjacent wrap
        const p = P[j];
        const cp = closestOnSegment(p, a, b);
        const d = sub(p, cp);
        const gap = Math.hypot(d.x, d.y);
        if (gap < min && gap > 1e-6) {
          const dir = scale(d, 1 / gap);
          const push = scale(dir, (min - gap) / 2);
          out(loop[j], push, w);
          out(loop[i], scale(push, -0.5), w);
          out(loop[(i + 1) % n], scale(push, -0.5), w);
        }
      }
    }
  }

  // --- Orthogonality (SOFT) ---------------------------------------------------
  // Snaps an edge toward the nearest axis (0 or 90 deg). Because it is soft and
  // stiffness-tunable, low stiffness => free angled walls, high stiffness =>
  // rectilinear plan. This is the single knob that controls "how angled" a plan is.
  private projectOrthogonality(
    c: Constraint,
    w: number,
    out: (id: VertexId, d: Vec2, weight: number) => void
  ): void {
    const edgeId = c.targets.edges?.[0];
    if (!edgeId) return;
    const edge = this.graph.edges.get(edgeId);
    if (!edge) return;
    const a = this.graph.vertices.get(edge.a)!;
    const b = this.graph.vertices.get(edge.b)!;
    const d = sub(b.pos, a.pos);
    const l = Math.hypot(d.x, d.y);
    if (l < 1e-9) return;
    const ang = Math.atan2(d.y, d.x);
    // Nearest multiple of 90 degrees.
    const snapped = (Math.round(ang / (Math.PI / 2)) * Math.PI) / 2;
    const targetDir = { x: Math.cos(snapped), y: Math.sin(snapped) };
    const mid = scale(add(a.pos, b.pos), 0.5);
    const half = (l / 2);
    const newA = sub(mid, scale(targetDir, half));
    const newB = add(mid, scale(targetDir, half));
    out(edge.a, sub(newA, a.pos), w);
    out(edge.b, sub(newB, b.pos), w);
  }

  // --- Adjacency --------------------------------------------------------------
  // Two rooms must share a wall: pull their centroids' shared boundary together
  // by reducing the gap between their nearest edges.
  private projectAdjacency(
    c: Constraint,
    w: number,
    out: (id: VertexId, d: Vec2, weight: number) => void
  ): void {
    const [fa, fb] = c.targets.faces ?? [];
    if (!fa || !fb) return;
    const faceA = this.graph.faces.get(fa);
    const faceB = this.graph.faces.get(fb);
    if (!faceA || !faceB) return;
    // Find the closest vertex pair across the two loops and draw them together.
    let best = Infinity;
    let bestA: VertexId | null = null;
    let bestB: VertexId | null = null;
    for (const ia of faceA.loop) {
      for (const ib of faceB.loop) {
        const pa = this.graph.vertices.get(ia)!.pos;
        const pb = this.graph.vertices.get(ib)!.pos;
        const dd = dist(pa, pb);
        if (dd < best) {
          best = dd;
          bestA = ia;
          bestB = ib;
        }
      }
    }
    if (bestA && bestB) {
      const pa = this.graph.vertices.get(bestA)!.pos;
      const pb = this.graph.vertices.get(bestB)!.pos;
      const mid = scale(add(pa, pb), 0.5);
      // Always pull together if not exactly at the same spot.
      // Tolerance can be used for "stopping" the solve, but here 
      // we want to maintain the coupling.
      out(bestA, sub(mid, pa), w * 0.5);
      out(bestB, sub(mid, pb), w * 0.5);
    }
  }

  // --- Corridor minimum clear width ------------------------------------------
  private projectCorridorWidth(
    c: Constraint,
    w: number,
    out: (id: VertexId, d: Vec2, weight: number) => void
  ): void {
    // Reuse min-dimension projection with the corridor's required width.
    this.projectMinDimension(
      { ...c, params: { min: c.params.width ?? 1.2 } },
      w,
      out
    );
  }

  // --- Outline containment (hard, global) ------------------------------------
  private enforceOutline(): void {
    if (this.outline.length < 3) return;
    for (const vert of this.graph.vertices.values()) {
      if (vert.pinned) continue;
      if (!pointInPolygon(vert.pos, this.outline)) {
        // Project back onto the nearest outline edge.
        let bestPt = vert.pos;
        let bestD = Infinity;
        for (let i = 0; i < this.outline.length; i++) {
          const a = this.outline[i];
          const b = this.outline[(i + 1) % this.outline.length];
          const cp = closestOnSegment(vert.pos, a, b);
          const d = dist(vert.pos, cp);
          if (d < bestD) {
            bestD = d;
            bestPt = cp;
          }
        }
        vert.pos = bestPt;
      }
    }
  }
}
