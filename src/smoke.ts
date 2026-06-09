/**
 * Smoke test: exercises the entire pipeline so we KNOW it runs, not just compiles.
 *   1. Build a small 4-room floor as a planar graph
 *   2. Solve constraints (with angled walls allowed via low orthogonality stiffness)
 *   3. Run NSGA-II over area-target genes, get a Pareto front
 *   4. Export the solved layout to IFC and sanity-check the STEP output
 */

import type {
  Constraint,
  Edge,
  Face,
  FloorGraph,
  ProgramSpec,
  SolveProblem,
  Vec2,
  Vertex,
} from './types/index.ts';
import { ConstraintSolver, DEFAULT_SOLVE_OPTIONS } from './solver/ConstraintSolver.ts';
import { NSGA2, DEFAULT_NSGA_OPTIONS, type Evaluator } from './optimizer/NSGA2.ts';
import { scoreObjectives } from './optimizer/objectives.ts';
import { exportIFC } from './ifc/exportIFC.ts';
import { polygonArea } from './geometry/vec2.ts';

// --- Build a 10x8 floor split into 4 rooms ---------------------------------
function buildFloor(): { problem: SolveProblem } {
  const vertices = new Map<string, Vertex>();
  const V = (id: string, x: number, y: number, pinned = false) =>
    vertices.set(id, { id, pos: { x, y }, pinned });

  // outline corners (pinned)
  V('o0', 0, 0, true);
  V('o1', 10, 0, true);
  V('o2', 10, 8, true);
  V('o3', 0, 8, true);
  // interior cross junctions (free to move) — deliberately perturbed off-center
  // and asymmetric so the solver has REAL work: rooms start unequal and angled.
  V('m0', 3.2, 0);
  V('m1', 10, 5.5);
  V('m2', 6.8, 8);
  V('m3', 0, 2.5);
  V('c', 4.1, 5.2); // center pushed off-center

  const edges = new Map<string, Edge>();
  const E = (id: string, a: string, b: string, ext = false) =>
    edges.set(id, { id, a, b, isExterior: ext });
  // perimeter
  E('e0', 'o0', 'm0', true);
  E('e1', 'm0', 'o1', true);
  E('e2', 'o1', 'm1', true);
  E('e3', 'm1', 'o2', true);
  E('e4', 'o2', 'm2', true);
  E('e5', 'm2', 'o3', true);
  E('e6', 'o3', 'm3', true);
  E('e7', 'm3', 'o0', true);
  // interior cross
  E('i0', 'm0', 'c');
  E('i1', 'm1', 'c');
  E('i2', 'm2', 'c');
  E('i3', 'm3', 'c');

  const faces = new Map<string, Face>();
  const F = (f: Face) => faces.set(f.id, f);
  F({ id: 'r0', type: 'living', loop: ['o0', 'm0', 'c', 'm3'], targetArea: 20, minDimension: 2.5 });
  F({ id: 'r1', type: 'kitchen', loop: ['m0', 'o1', 'm1', 'c'], targetArea: 20, minDimension: 2.5 });
  F({ id: 'r2', type: 'bedroom', loop: ['c', 'm1', 'o2', 'm2'], targetArea: 20, minDimension: 2.5 });
  F({ id: 'r3', type: 'bathroom', loop: ['m3', 'c', 'm2', 'o3'], targetArea: 20, minDimension: 2.0 });

  const graph: FloorGraph = { vertices, edges, faces };
  const outline: Vec2[] = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 8 },
    { x: 0, y: 8 },
  ];

  const constraints: Constraint[] = [];
  for (const f of faces.values()) {
    constraints.push({ kind: 'area', hard: false, stiffness: 0.6, targets: { faces: [f.id] }, params: { target: f.targetArea } });
    constraints.push({ kind: 'minDimension', hard: true, stiffness: 1, targets: { faces: [f.id] }, params: { min: f.minDimension } });
  }
  // Soft orthogonality on interior edges only — LOW stiffness lets walls angle.
  for (const id of ['i0', 'i1', 'i2', 'i3']) {
    constraints.push({ kind: 'orthogonality', hard: false, stiffness: 0.25, targets: { edges: [id] }, params: {} });
  }

  return { problem: { graph, constraints, outline } };
}

// --- 1 & 2: build + solve ---------------------------------------------------
const { problem } = buildFloor();
const solver = new ConstraintSolver(problem);
const iters = solver.solve(DEFAULT_SOLVE_OPTIONS);
const scores = scoreObjectives(problem.graph, problem.outline);
console.log('[solve] converged in', iters, 'iterations');
console.log('[solve] room areas:',
  [...problem.graph.faces.values()].map(
    (f) => f.type + '=' + Math.abs(polygonArea(f.loop.map((id) => problem.graph.vertices.get(id)!.pos))).toFixed(1)
  ).join(', ')
);
console.log('[solve] objectives:', JSON.stringify(
  Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, +v.toFixed(3)]))
));

// --- 3: NSGA-II over area-target genes --------------------------------------
// Genome = 4 genes, each scaling a room's target area in [12, 28] m^2.
const evaluator: Evaluator = {
  geneCount: 4,
  evaluate: (genome) => {
    const built = buildFloor().problem;
    const faceIds = ['r0', 'r1', 'r2', 'r3'];
    genome.forEach((g, i) => {
      const target = 12 + g * 16;
      const face = built.graph.faces.get(faceIds[i])!;
      face.targetArea = target;
      for (const c of built.constraints) {
        if (c.kind === 'area' && c.targets.faces?.[0] === faceIds[i]) c.params.target = target;
      }
    });
    new ConstraintSolver(built).solve();
    return scoreObjectives(built.graph, built.outline);
  },
};

const nsga = new NSGA2(evaluator, { ...DEFAULT_NSGA_OPTIONS, populationSize: 24, generations: 15 });
const front = nsga.run();
console.log('[nsga] Pareto front size:', front.length);
console.log('[nsga] best areaError candidate objectives:',
  front[0].objectives.map((x) => +x.toFixed(3)));

// --- 4: IFC export ----------------------------------------------------------
const ifc = exportIFC(problem.graph);
const lineCount = ifc.split('\n').length;
const hasWalls = ifc.includes('IFCWALLSTANDARDCASE');
const hasSpaces = ifc.includes('IFCSPACE');
const validHeader = ifc.startsWith('ISO-10303-21;') && ifc.includes('FILE_SCHEMA');
console.log('[ifc] lines:', lineCount, '| walls:', hasWalls, '| spaces:', hasSpaces, '| valid header:', validHeader);

if (validHeader && hasWalls && hasSpaces && front.length > 0) {
  console.log('\nPIPELINE OK: solve -> optimize -> export all functional.');
} else {
  console.error('\nPIPELINE FAILED');
  process.exit(1);
}
