import {
  addUndirected,
  articulationPoints,
  bfsReachable,
  degree,
  emptyAdj,
  isArticulationFor,
} from '../kernel/graphs.ts';
import type { MissionEdge, MissionGraph, MissionNode, MissionNodeType } from './missionTypes.ts';

export interface MissionValidationResult {
  valid: boolean;
  errors: string[];
}

const ALLOWED_PRIMARY: ReadonlySet<string> = new Set([
  pair('ENTRY', 'FOYER'),
  pair('ENTRY', 'LIVING'),
  pair('ENTRY', 'PUBLIC_HUB'),
  pair('FOYER', 'LIVING'),
  pair('FOYER', 'PUBLIC_HUB'),
  pair('FOYER', 'CORRIDOR'),
  pair('FOYER', 'PRIVATE_THRESHOLD'),
  pair('PUBLIC_HUB', 'LIVING'),
  pair('PUBLIC_HUB', 'DINING'),
  pair('PUBLIC_HUB', 'KITCHEN'),
  pair('PUBLIC_HUB', 'PRIVATE_THRESHOLD'),
  pair('PUBLIC_HUB', 'CORRIDOR'),
  pair('LIVING', 'DINING'),
  pair('LIVING', 'KITCHEN'),
  pair('LIVING', 'PRIVATE_THRESHOLD'),
  pair('LIVING', 'CORRIDOR'),
  pair('LIVING', 'BEDROOM'), // living-hub / fallback
  pair('PRIVATE_THRESHOLD', 'BEDROOM'),
  pair('PRIVATE_THRESHOLD', 'COMMON_BATHROOM'),
  pair('PRIVATE_THRESHOLD', 'CORRIDOR'),
  pair('CORRIDOR', 'BEDROOM'),
  pair('CORRIDOR', 'COMMON_BATHROOM'),
  pair('CORRIDOR', 'LIVING'),
  pair('BEDROOM', 'ENSUITE'),
  pair('KITCHEN', 'UTILITY'),
  pair('LIVING', 'BALCONY'),
  pair('BEDROOM', 'BALCONY'),
  pair('DINING', 'KITCHEN'),
]);

const FORBIDDEN: ReadonlySet<string> = new Set([
  pair('COMMON_BATHROOM', 'COMMON_BATHROOM'),
  pair('COMMON_BATHROOM', 'ENSUITE'),
  pair('ENSUITE', 'ENSUITE'),
  pair('COMMON_BATHROOM', 'BEDROOM'),
  pair('COMMON_BATHROOM', 'KITCHEN'),
  pair('ENSUITE', 'KITCHEN'),
  pair('COMMON_BATHROOM', 'LIVING'), // default forbidden; living-hub uses PRIVATE_THRESHOLD or foyer
  pair('ENSUITE', 'LIVING'),
  pair('BEDROOM', 'BEDROOM'),
  pair('ENTRY', 'BEDROOM'),
  pair('ENTRY', 'COMMON_BATHROOM'),
  pair('ENTRY', 'ENSUITE'),
  pair('ENTRY', 'KITCHEN'),
  pair('ENSUITE', 'CORRIDOR'),
  pair('ENSUITE', 'PRIVATE_THRESHOLD'),
  pair('ENSUITE', 'PUBLIC_HUB'),
  pair('ENSUITE', 'FOYER'),
  pair('ENSUITE', 'ENTRY'),
  pair('ENSUITE', 'UTILITY'),
  pair('ENSUITE', 'BALCONY'),
  pair('ENSUITE', 'DINING'),
]);

function pair(a: MissionNodeType, b: MissionNodeType): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function isBath(t: MissionNodeType): boolean {
  return t === 'COMMON_BATHROOM' || t === 'ENSUITE';
}

export function validateMissionGraph(graph: MissionGraph): MissionValidationResult {
  const errors: string[] = [];
  const byId = new Map(graph.nodes.map(n => [n.id, n]));

  for (const e of graph.edges) {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b) {
      errors.push(`Edge references missing node ${e.from}→${e.to}`);
      continue;
    }
    const key = pair(a.type, b.type);
    if (FORBIDDEN.has(key)) {
      errors.push(`Forbidden relationship ${a.type} ↔ ${b.type}`);
    } else if (e.relationship === 'primary_access' && !ALLOWED_PRIMARY.has(key)) {
      // open_transition / service_adjacency may be looser
      if (e.relationship === 'primary_access') {
        errors.push(`Disallowed primary_access ${a.type} → ${b.type}`);
      }
    }

    // Ensuite may only connect to its owning bedroom
    if (a.type === 'ENSUITE' || b.type === 'ENSUITE') {
      const ensuite = a.type === 'ENSUITE' ? a : b;
      const other = a.type === 'ENSUITE' ? b : a;
      if (other.type !== 'BEDROOM' || ensuite.attachedTo !== other.id) {
        errors.push(`Ensuite ${ensuite.id} must connect only to its owning bedroom`);
      }
    }
  }

  // Build undirected adjacency for degree / reachability
  const adj = emptyAdj(graph.nodes.map(n => n.id));
  for (const e of graph.edges) {
    if (byId.has(e.from) && byId.has(e.to)) addUndirected(adj, e.from, e.to);
  }

  for (const n of graph.nodes) {
    if (isBath(n.type) && degree(adj, n.id) !== 1) {
      errors.push(`Bathroom ${n.id} must have degree 1, got ${degree(adj, n.id)}`);
    }
  }

  // Bedroom: exactly one primary circulation parent (non-ensuite edge)
  for (const n of graph.nodes.filter(x => x.type === 'BEDROOM')) {
    const primaryParents = graph.edges.filter(
      e =>
        (e.to === n.id || e.from === n.id) &&
        e.relationship === 'primary_access' &&
        (() => {
          const otherId = e.from === n.id ? e.to : e.from;
          const other = byId.get(otherId);
          return other && other.type !== 'ENSUITE' && other.type !== 'BALCONY';
        })(),
    );
    if (primaryParents.length !== 1) {
      errors.push(`Bedroom ${n.id} must have exactly one primary circulation parent, got ${primaryParents.length}`);
    }
  }

  const entry = graph.nodes.find(n => n.type === 'ENTRY');
  if (!entry) {
    errors.push('Missing ENTRY');
  } else {
    const reachable = bfsReachable(adj, entry.id);
    for (const n of graph.nodes) {
      if (n.required && !reachable.has(n.id) && n.type !== 'EXTERIOR') {
        errors.push(`Required node ${n.id} not reachable from ENTRY`);
      }
    }

    // Bathrooms must not be articulation points for other rooms
    for (const bath of graph.nodes.filter(n => isBath(n.type))) {
      const must = graph.nodes
        .filter(n => n.required && !isBath(n.type) && n.type !== 'EXTERIOR')
        .map(n => n.id);
      if (isArticulationFor(adj, bath.id, entry.id, must)) {
        errors.push(`Bathroom ${bath.id} is an articulation point`);
      }
    }

    // Also: no bathroom in articulationPoints of the full graph among required rooms
    const ap = articulationPoints(adj);
    for (const bath of graph.nodes.filter(n => isBath(n.type))) {
      if (ap.has(bath.id)) {
        // Bathrooms are leaves so shouldn't be APs; double-check
        if (degree(adj, bath.id) > 1) {
          errors.push(`Bathroom ${bath.id} appears as articulation point`);
        }
      }
    }
  }

  // No bedroom↔bedroom primary
  for (const e of graph.edges) {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (a && b && a.type === 'BEDROOM' && b.type === 'BEDROOM') {
      errors.push('Bedroom ↔ Bedroom edge forbidden');
    }
  }

  return { valid: errors.length === 0, errors };
}

export function missionAdj(graph: MissionGraph): Map<string, string[]> {
  const adj = emptyAdj(graph.nodes.map(n => n.id));
  for (const e of graph.edges) addUndirected(adj, e.from, e.to);
  return adj;
}

export function findNode(graph: MissionGraph, type: MissionNodeType): MissionNode | undefined {
  return graph.nodes.find(n => n.type === type);
}

export function findNodes(graph: MissionGraph, type: MissionNodeType): MissionNode[] {
  return graph.nodes.filter(n => n.type === type);
}
