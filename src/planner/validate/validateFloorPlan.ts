import { bathroomRemovalInvariant } from '../topology/generateAccessTrees.ts';
import { isAllowedEdge, isForbiddenEdge } from '../topology/accessMatrix.ts';
import { findSharedWall } from '../geometry/sharedWalls.ts';
import { verifyRouteIntegrity } from '../graph/portalGraph.ts';
import type {
  AccessTree,
  AreaBudget,
  Door,
  FloorPlan,
  RoomRect,
  SharedWall,
  ValidationIssue,
  ValidationMetrics,
  ValidationResult,
} from '../types.ts';
import { isBathroomCategory, roomArea } from '../types.ts';
import { budgetFor } from '../budget/areaBudget.ts';

export interface ValidateInput {
  rooms: RoomRect[];
  topology: AccessTree;
  budgets: AreaBudget[];
  sharedWalls: SharedWall[];
  doors: Door[];
  routes: FloorPlan['routes'];
  entrance: FloorPlan['entrance'];
  outlineW: number;
  outlineH: number;
  missingTopologyEdges: Array<{ parentId: string; childId: string }>;
}

export function validateFloorPlan(input: ValidateInput): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  const {
    rooms, topology, budgets, sharedWalls, doors, routes,
    entrance, outlineW, outlineH, missingTopologyEdges,
  } = input;

  // Required rooms present
  for (const n of topology.nodes) {
    if (!rooms.some(r => r.id === n.id)) {
      errors.push({ code: 'MISSING_ROOM', message: `Missing room ${n.id}`, roomIds: [n.id] });
    }
  }

  // Envelope containment + overlaps
  for (const r of rooms) {
    if (r.x < -0.05 || r.y < -0.05 || r.x + r.w > outlineW + 0.05 || r.y + r.h > outlineH + 0.05) {
      errors.push({ code: 'OUT_OF_BOUNDS', message: `${r.id} outside envelope`, roomIds: [r.id] });
    }
  }
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i];
      const b = rooms[j];
      if (a.category === 'CORRIDOR' || b.category === 'CORRIDOR') continue;
      if (a.category === 'BALCONY' || b.category === 'BALCONY') continue;
      const overlap = rectOverlap(a, b);
      if (overlap > 0.15) {
        errors.push({
          code: 'OVERLAP',
          message: `${a.id} overlaps ${b.id} (${overlap.toFixed(2)} m²)`,
          roomIds: [a.id, b.id],
        });
      }
    }
  }

  // Min area / dimensions
  for (const r of rooms) {
    const b = budgetFor(budgets, r.id);
    const area = roomArea(r);
    if (area < b.minArea - 0.15) {
      errors.push({
        code: 'MIN_AREA',
        message: `${r.id} area ${area.toFixed(2)} < min ${b.minArea}`,
        roomIds: [r.id],
      });
    }
    if (r.w < b.minWidth - 0.05 || r.h < b.minHeight - 0.05) {
      errors.push({
        code: 'MIN_DIM',
        message: `${r.id} dims ${r.w.toFixed(2)}x${r.h.toFixed(2)} below min`,
        roomIds: [r.id],
      });
    }
    if (area > b.maxArea + 0.5) {
      warnings.push({
        code: 'MAX_AREA',
        message: `${r.id} area ${area.toFixed(2)} > max ${b.maxArea}`,
        roomIds: [r.id],
      });
      // Entry oversize is hard error
      if (r.category === 'ENTRY' || r.category === 'FOYER') {
        errors.push({
          code: 'ENTRY_OVERSIZE',
          message: `${r.id} exceeds max area ${b.maxArea}`,
          roomIds: [r.id],
        });
      }
    }
  }

  // Entrance on correct exterior edge
  const ed = entrance.door.position;
  const dir = entrance.direction;
  const onEdge =
    (dir === 'S' && Math.abs(ed.y - outlineH) < 0.1) ||
    (dir === 'N' && Math.abs(ed.y) < 0.1) ||
    (dir === 'W' && Math.abs(ed.x) < 0.1) ||
    (dir === 'E' && Math.abs(ed.x - outlineW) < 0.1);
  if (!onEdge) {
    errors.push({ code: 'ENTRANCE_EDGE', message: `Entrance not on ${dir} boundary` });
  }

  const entranceDoors = doors.filter(d => d.isEntrance);
  if (entranceDoors.length !== 1) {
    errors.push({ code: 'ENTRANCE_COUNT', message: `Expected 1 entrance door, got ${entranceDoors.length}` });
  }

  // Missing topology edges
  for (const m of missingTopologyEdges) {
    errors.push({
      code: 'MISSING_TOPOLOGY_EDGE',
      message: `Required edge ${m.parentId}→${m.childId} not geometrically realised`,
      roomIds: [m.parentId, m.childId],
    });
  }

  // Every internal door on shared wall; every traversable edge has door
  const internalDoors = doors.filter(d => d.roomBId !== '__EXTERIOR__');
  for (const d of internalDoors) {
    const wall = findSharedWall(sharedWalls, d.roomAId, d.roomBId);
    if (!wall) {
      errors.push({
        code: 'DOOR_NO_WALL',
        message: `Door ${d.id} not on shared wall`,
        roomIds: [d.roomAId, d.roomBId],
      });
    } else if (wall.length < d.width) {
      errors.push({
        code: 'DOOR_WALL_SHORT',
        message: `Shared wall shorter than door for ${d.id}`,
        roomIds: [d.roomAId, d.roomBId],
      });
    }
  }

  for (const e of topology.edges) {
    const hasDoor = internalDoors.some(
      d =>
        (d.roomAId === e.parentId && d.roomBId === e.childId) ||
        (d.roomAId === e.childId && d.roomBId === e.parentId),
    );
    if (!hasDoor) {
      errors.push({
        code: 'EDGE_NO_DOOR',
        message: `Topology edge ${e.parentId}→${e.childId} has no door`,
        roomIds: [e.parentId, e.childId],
      });
    }
  }

  // Forbidden edges among doors
  const byId = new Map(rooms.map(r => [r.id, r]));
  for (const d of internalDoors) {
    const a = byId.get(d.roomAId);
    const b = byId.get(d.roomBId);
    if (!a || !b) continue;
    if (isForbiddenEdge(a.category, b.category) || !isAllowedEdge(a.category, b.category)) {
      errors.push({
        code: 'FORBIDDEN_EDGE',
        message: `Forbidden door ${a.category}↔${b.category}`,
        roomIds: [a.id, b.id],
      });
    }
  }

  // Specific forbidden pairs
  for (const d of internalDoors) {
    const a = byId.get(d.roomAId)!;
    const b = byId.get(d.roomBId)!;
    const cats = [a.category, b.category].sort().join('|');
    if (
      (isBathroomCategory(a.category) && isBathroomCategory(b.category)) ||
      cats === 'BEDROOM|BEDROOM' ||
      (isBathroomCategory(a.category) && b.category === 'KITCHEN') ||
      (isBathroomCategory(b.category) && a.category === 'KITCHEN') ||
      (isBathroomCategory(a.category) && b.category === 'LIVING') ||
      (isBathroomCategory(b.category) && a.category === 'LIVING')
    ) {
      // Ensuite-bedroom is allowed; skip if ensuite-bedroom
      const ensuiteBed =
        (a.category === 'ENSUITE_BATHROOM' && b.category === 'BEDROOM') ||
        (b.category === 'ENSUITE_BATHROOM' && a.category === 'BEDROOM');
      if (!ensuiteBed) {
        errors.push({
          code: 'ILLEGAL_PAIR',
          message: `Illegal pair ${a.category}↔${b.category}`,
          roomIds: [a.id, b.id],
        });
      }
    }
  }

  // Bathroom degree exactly 1 in door graph
  const doorAdj = new Map<string, string[]>();
  for (const r of rooms) doorAdj.set(r.id, []);
  for (const d of internalDoors) {
    doorAdj.get(d.roomAId)!.push(d.roomBId);
    doorAdj.get(d.roomBId)!.push(d.roomAId);
  }
  let bathroomLeafViolations = 0;
  for (const r of rooms) {
    if (!isBathroomCategory(r.category)) continue;
    const deg = doorAdj.get(r.id)?.length ?? 0;
    if (deg !== 1) {
      bathroomLeafViolations++;
      errors.push({
        code: 'BATHROOM_DEGREE',
        message: `Bathroom ${r.id} degree ${deg} ≠ 1`,
        roomIds: [r.id],
      });
    }
  }

  // Bathroom removal connectivity (topology)
  if (!bathroomRemovalInvariant(topology)) {
    errors.push({ code: 'BATHROOM_ARTICULATION', message: 'Bathroom is an articulation point in topology' });
  }

  // No path through bathroom between non-bathrooms
  if (bathroomTransitExists(rooms, doorAdj)) {
    errors.push({ code: 'BATHROOM_TRANSIT', message: 'Bathroom lies on a transit path' });
  }

  // Bedroom primary parent
  for (const r of rooms) {
    if (r.category !== 'BEDROOM') continue;
    const neighbors = doorAdj.get(r.id) ?? [];
    const primary = neighbors.filter(nid => {
      const n = byId.get(nid);
      return n && (n.category === 'CORRIDOR' || n.category === 'LIVING' || n.category === 'FOYER');
    });
    if (primary.length !== 1) {
      errors.push({
        code: 'BEDROOM_PARENT',
        message: `Bedroom ${r.id} has ${primary.length} primary parents`,
        roomIds: [r.id],
      });
    }
  }

  // Connectivity from ENTRY via doors
  const entry = rooms.find(r => r.category === 'ENTRY');
  let reachableCount = 0;
  if (entry) {
    const seen = new Set<string>();
    const q = [entry.id];
    seen.add(entry.id);
    while (q.length) {
      const cur = q.shift()!;
      for (const n of doorAdj.get(cur) ?? []) {
        if (!seen.has(n)) {
          seen.add(n);
          q.push(n);
        }
      }
    }
    reachableCount = seen.size;
    for (const r of rooms) {
      if (r.category === 'BALCONY') continue;
      if (!seen.has(r.id)) {
        errors.push({
          code: 'UNREACHABLE',
          message: `${r.id} unreachable from ENTRY`,
          roomIds: [r.id],
        });
      }
    }
  }

  // Route integrity
  for (const msg of verifyRouteIntegrity(routes, rooms, doors)) {
    errors.push({ code: 'ROUTE_INTEGRITY', message: msg });
  }

  // Soft: living/bedroom exterior access
  for (const r of rooms) {
    if (r.category !== 'LIVING' && r.category !== 'BEDROOM') continue;
    const onExterior =
      r.x < 0.1 || r.y < 0.1 || r.x + r.w > outlineW - 0.1 || r.y + r.h > outlineH - 0.1;
    if (!onExterior) {
      warnings.push({
        code: 'NO_EXTERIOR',
        message: `${r.id} has no exterior wall`,
        roomIds: [r.id],
      });
    }
  }

  const totalArea = rooms.reduce((s, r) => s + roomArea(r), 0);
  const corridorArea = rooms.filter(r => r.category === 'CORRIDOR').reduce((s, r) => s + roomArea(r), 0);
  const entryArea = rooms.filter(r => r.category === 'ENTRY' || r.category === 'FOYER').reduce((s, r) => s + roomArea(r), 0);

  const metrics: ValidationMetrics = {
    totalArea,
    corridorAreaRatio: totalArea > 0 ? corridorArea / totalArea : 0,
    entryAreaRatio: totalArea > 0 ? entryArea / totalArea : 0,
    reachableCount,
    doorCount: doors.length,
    missingTopologyEdges: missingTopologyEdges.length,
    bathroomLeafViolations,
  };

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    metrics,
  };
}

function rectOverlap(a: RoomRect, b: RoomRect): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  if (x2 <= x1 || y2 <= y1) return 0;
  return (x2 - x1) * (y2 - y1);
}

function bathroomTransitExists(
  rooms: RoomRect[],
  doorAdj: Map<string, string[]>,
): boolean {
  const baths = new Set(rooms.filter(r => isBathroomCategory(r.category)).map(r => r.id));
  const nonBath = rooms.filter(r => !isBathroomCategory(r.category) && r.category !== 'BALCONY');

  for (const start of nonBath) {
    for (const goal of nonBath) {
      if (start.id === goal.id) continue;
      // BFS avoiding... actually check if shortest path must go through bath
      // Simpler: if any bath has 2+ non-bath neighbors that are not otherwise connected — already degree==1 prevents this
      const neighbors = doorAdj.get(
        [...baths][0] ?? ''
      );
      void neighbors;
    }
  }

  // With degree==1 bathrooms cannot be transit nodes
  for (const bid of baths) {
    const n = doorAdj.get(bid) ?? [];
    if (n.length > 1) return true;
  }
  return false;
}

/** Convenience wrapper for a full FloorPlan object. */
export function validateCompletePlan(plan: FloorPlan, missing: Array<{ parentId: string; childId: string }> = []): ValidationResult {
  return validateFloorPlan({
    rooms: plan.rooms,
    topology: plan.topology,
    budgets: plan.budgets,
    sharedWalls: plan.sharedWalls,
    doors: plan.doors,
    routes: plan.routes,
    entrance: plan.entrance,
    outlineW: plan.outlineW,
    outlineH: plan.outlineH,
    missingTopologyEdges: missing.length ? missing : plan.validation?.metrics
      ? [] // revalidate from structure
      : plan.topology.edges
          .filter(e => !plan.doors.some(d =>
            (d.roomAId === e.parentId && d.roomBId === e.childId) ||
            (d.roomAId === e.childId && d.roomBId === e.parentId)
          ))
          .map(e => ({ parentId: e.parentId, childId: e.childId })),
  });
}
