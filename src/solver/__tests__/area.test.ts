import { describe, it, expect } from 'vitest';
import { ConstraintSolver, DEFAULT_SOLVE_OPTIONS } from '../ConstraintSolver';
import type { FloorGraph, SolveProblem, Constraint, VertexId, FaceId, EdgeId } from '../../types';
import { v, polygonArea } from '../../geometry/vec2';

describe('Area Stability Test', () => {
  it('should converge 6 rooms to target area within 16ms', () => {
    const graph: FloorGraph = {
      vertices: new Map(),
      edges: new Map(),
      faces: new Map(),
    };

    const constraints: Constraint[] = [];

    const rooms: FaceId[] = [];
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 3; c++) {
        const id = `room_${r}_${c}`;
        const vIds: VertexId[] = [];
        const x0 = c * 6;
        const y0 = r * 6;
        const size = 2; // Start small

        const coords = [
          { x: x0, y: y0 },
          { x: x0 + size, y: y0 },
          { x: x0 + size, y: y0 + size },
          { x: x0, y: y0 + size },
        ];

        coords.forEach((p, i) => {
          const vId = `${id}_v${i}`;
          graph.vertices.set(vId, { id: vId, pos: p, pinned: false });
          vIds.push(vId);
        });

        // Add edges
        for (let i = 0; i < 4; i++) {
          const eId = `${id}_e${i}`;
          graph.edges.set(eId, { id: eId, a: vIds[i], b: vIds[(i + 1) % 4], isExterior: false });
          
          // Edge length constraint (soft)
          constraints.push({
            kind: 'edgeLength',
            hard: false,
            stiffness: 0.1,
            targets: { edges: [eId] },
            params: { min: 2, max: 10 }
          });

          // Add orthogonality constraint (soft)
          constraints.push({
            kind: 'orthogonality',
            hard: false,
            stiffness: 0.1,
            targets: { edges: [eId] },
            params: {}
          });
        }

        // Angle constraints (form)
        for (let i = 0; i < 4; i++) {
          constraints.push({
            kind: 'angle',
            hard: false,
            stiffness: 0.1,
            targets: { vertices: [vIds[i], vIds[(i + 1) % 4], vIds[(i + 2) % 4]] },
            params: { target: Math.PI / 2 }
          });
        }

        // Add angles
        for (let i = 0; i < 4; i++) {
          constraints.push({
            kind: 'angle',
            hard: false,
            stiffness: 0.5,
            targets: { vertices: [vIds[(i + 3) % 4], vIds[i], vIds[(i + 1) % 4]] },
            params: { target: Math.PI / 2 }
          });
        }

        graph.faces.set(id, {
          id,
          type: 'living',
          loop: vIds,
          targetArea: 30,
          minDimension: 2,
        });

        constraints.push({
          kind: 'area',
          hard: true,
          stiffness: 1.0,
          targets: { faces: [id] },
          params: { target: 30 }
        });

        rooms.push(id);
      }
    }

    // Add adjacency
    const addAdjacency = (f1: string, f2: string) => {
      constraints.push({
        kind: 'adjacency',
        hard: false,
        stiffness: 0.1,
        targets: { faces: [f1, f2] },
        params: { tolerance: 0.05 }
      });
    };

    for (let c = 0; c < 2; c++) {
      addAdjacency(`room_0_${c}`, `room_0_${c+1}`);
      addAdjacency(`room_1_${c}`, `room_1_${c+1}`);
    }
    for (let c = 0; c < 3; c++) {
      addAdjacency(`room_0_${c}`, `room_1_${c}`);
    }

    const solver = new ConstraintSolver({
      graph,
      constraints,
      outline: [], // definitely no outline
    });

    const start = performance.now();
    // Use more iterations/substeps for the verification test to ensure full convergence
    solver.solve({ 
      iterations: 500,
      hardSubsteps: 5,
      damping: 0.9,
      epsilon: 1e-4
    });
    const duration = performance.now() - start;

    console.log(`Converged 6 rooms in ${duration.toFixed(2)}ms`);

    for (const id of rooms) {
      const face = graph.faces.get(id)!;
      const pts = face.loop.map(vId => graph.vertices.get(vId)!.pos);
      const area = Math.abs(polygonArea(pts));
      console.log(`${id} area: ${area.toFixed(2)}`);
      expect(area).toBeGreaterThan(25.0);
      expect(area).toBeLessThan(32.0);
    }

    // Performance check for a single frame (24 iters)
    const oneFrameStart = performance.now();
    solver.solve({ ...DEFAULT_SOLVE_OPTIONS, iterations: 24 });
    const oneFrameDuration = performance.now() - oneFrameStart;
    
    console.log(`Single frame solve (24 iters): ${oneFrameDuration.toFixed(2)}ms`);
    expect(oneFrameDuration).toBeLessThan(16);
  });
});
