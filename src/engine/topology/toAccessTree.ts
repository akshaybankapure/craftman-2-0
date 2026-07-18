/**
 * Adapt MissionGraph → existing AccessTree so doors/validation keep working.
 *
 * Collapses abstract nodes:
 * - PUBLIC_HUB → identity of LIVING (edges rewired)
 * - PRIVATE_THRESHOLD → CORRIDOR (short lobby / private wing)
 * - DINING → absorbed into LIVING (open zone)
 * - ENSUITE → ENSUITE_BATHROOM
 * - EXTERIOR dropped
 */

import type { AccessEdge, AccessNode, AccessNodeCategory, AccessTree } from '../../planner/types.ts';
import { assertLegalTree } from '../../planner/topology/generateAccessTrees.ts';
import type { MissionGraph, MissionNode, MissionNodeType } from './missionTypes.ts';

function mapType(t: MissionNodeType): AccessNodeCategory | null {
  switch (t) {
    case 'EXTERIOR':
    case 'DINING':
    case 'PUBLIC_HUB':
      return null; // collapsed
    case 'ENTRY':
      return 'ENTRY';
    case 'FOYER':
      return 'FOYER';
    case 'PRIVATE_THRESHOLD':
    case 'CORRIDOR':
      return 'CORRIDOR';
    case 'LIVING':
      return 'LIVING';
    case 'KITCHEN':
      return 'KITCHEN';
    case 'UTILITY':
      return 'UTILITY';
    case 'BEDROOM':
      return 'BEDROOM';
    case 'COMMON_BATHROOM':
      return 'COMMON_BATHROOM';
    case 'ENSUITE':
      return 'ENSUITE_BATHROOM';
    case 'BALCONY':
      return 'BALCONY';
  }
}

export function missionGraphToAccessTree(graph: MissionGraph): AccessTree {
  const living = graph.nodes.find(n => n.type === 'LIVING');
  const hub = graph.nodes.find(n => n.type === 'PUBLIC_HUB');

  /** Mission node id → surviving access node id */
  const idMap = new Map<string, string>();

  const nodes: AccessNode[] = [];
  const edges: AccessEdge[] = [];

  for (const n of graph.nodes) {
    if (n.type === 'EXTERIOR' || n.type === 'DINING') continue;
    if (n.type === 'PUBLIC_HUB') {
      // Rewire through living
      if (living) idMap.set(n.id, living.id);
      continue;
    }
    const cat = mapType(n.type);
    if (!cat) continue;

    // Prefer stable ids from mission graph
    const accessId = n.id;
    idMap.set(n.id, accessId);
    const node: AccessNode = {
      id: accessId,
      category: cat,
      label: n.label,
    };
    if (n.type === 'ENSUITE' && n.attachedTo) {
      node.attachedTo = n.attachedTo;
    }
    nodes.push(node);
  }

  // Ensure living exists in map
  if (living) idMap.set(living.id, living.id);
  if (hub && living) idMap.set(hub.id, living.id);

  const edgeKeys = new Set<string>();
  const addEdge = (parentId: string, childId: string) => {
    if (parentId === childId) return;
    const key = [parentId, childId].sort().join('|');
    if (edgeKeys.has(key)) return;
    // Avoid duplicate directed
    if (edges.some(e => e.parentId === parentId && e.childId === childId)) return;
    edgeKeys.add(key);
    edges.push({ parentId, childId, kind: 'required' });
  };

  for (const e of graph.edges) {
    const fromN = graph.nodes.find(n => n.id === e.from);
    const toN = graph.nodes.find(n => n.id === e.to);
    if (!fromN || !toN) continue;
    // Skip pure dining / exterior / open dining edges
    if (fromN.type === 'DINING' || toN.type === 'DINING') {
      // dining open to living — no wall
      continue;
    }
    if (fromN.type === 'EXTERIOR' || toN.type === 'EXTERIOR') continue;

    // service_adjacency kitchen↔threshold: keep for wet clustering hint but
    // AccessTree needs a tree-ish primary parent — skip service-only if primary exists
    if (e.relationship === 'service_adjacency') continue;
    if (
      e.relationship === 'open_transition' &&
      fromN.type !== 'BALCONY' &&
      toN.type !== 'BALCONY'
    ) {
      continue;
    }

    let a = idMap.get(e.from);
    let b = idMap.get(e.to);
    if (!a || !b) continue;

    // Orient edge: parent should be lower privacy / circulation side
    const parentFirst = shouldBeParent(fromN, toN);
    if (parentFirst) addEdge(a, b);
    else addEdge(b, a);
  }

  // If PUBLIC_HUB was entry target, ensure ENTRY→LIVING
  const entry = nodes.find(n => n.category === 'ENTRY');
  const livingNode = nodes.find(n => n.category === 'LIVING');
  if (entry && livingNode) {
    const entryLinked = edges.some(
      e => e.parentId === entry.id || e.childId === entry.id,
    );
    if (!entryLinked) addEdge(entry.id, livingNode.id);
  }

  const rootId = entry?.id ?? nodes[0]?.id;
  if (!rootId) throw new Error('Empty access tree from mission graph');

  const tree: AccessTree = { rootId, nodes, edges };

  // Remap ensuite attachedTo through idMap
  for (const n of tree.nodes) {
    if (n.category === 'ENSUITE_BATHROOM' && n.attachedTo) {
      n.attachedTo = idMap.get(n.attachedTo) ?? n.attachedTo;
    }
  }

  assertLegalTree(tree);
  return tree;
}

function shouldBeParent(a: MissionNode, b: MissionNode): boolean {
  const order = (t: MissionNodeType): number => {
    switch (t) {
      case 'ENTRY': return 0;
      case 'FOYER': return 1;
      case 'PUBLIC_HUB': return 2;
      case 'LIVING': return 3;
      case 'DINING': return 3;
      case 'KITCHEN': return 4;
      case 'PRIVATE_THRESHOLD': return 5;
      case 'CORRIDOR': return 5;
      case 'BEDROOM': return 6;
      case 'COMMON_BATHROOM': return 7;
      case 'ENSUITE': return 8;
      case 'UTILITY': return 7;
      case 'BALCONY': return 7;
      case 'EXTERIOR': return -1;
    }
  };
  // Ensuite child of bedroom
  if (b.type === 'ENSUITE') return true;
  if (a.type === 'ENSUITE') return false;
  return order(a.type) <= order(b.type);
}
