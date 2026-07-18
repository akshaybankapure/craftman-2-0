/**
 * Adapt planner AccessTree + AreaBudgets → spatial engine AccessGraph + RoomRequirement[].
 * Room ids are preserved so packed spaces match topology nodes for door placement.
 */

import type {
  AccessGraph,
  AccessNode as SpatialAccessNode,
  AccessEdge as SpatialAccessEdge,
  RoomRequirement,
  RoomType as SpatialRoomType,
  TopologyFamily,
} from '../../spatial/types.ts';
import type { MissionGraphFamily } from '../../engine/topology/missionTypes.ts';
import type {
  AccessEdge,
  AccessNode,
  AccessNodeCategory,
  AccessTree,
  AreaBudget,
} from '../types.ts';

export function missionFamilyToTopologyFamily(family: MissionGraphFamily): TopologyFamily {
  switch (family) {
    case 'central_living_hub':
    case 'living_integrated_circulation':
      return 'HALL_CENTRIC';
    case 'short_private_corridor':
    case 'compact_wet_core':
      return 'PRIVATE_LOBBY';
    case 'split_public_private_spine':
    case 'corner_entry_distribution':
      return 'SPLIT_WING';
  }
}

export function categoryToSpatialType(cat: AccessNodeCategory): SpatialRoomType | null {
  switch (cat) {
    case 'ENTRY':
      return 'FOYER';
    case 'FOYER':
      return 'FOYER';
    case 'CORRIDOR':
      return 'PRIVATE_LOBBY';
    case 'LIVING':
      return 'LIVING';
    case 'KITCHEN':
      return 'KITCHEN';
    case 'BEDROOM':
      return 'BEDROOM';
    case 'COMMON_BATHROOM':
      return 'BATHROOM';
    case 'ENSUITE_BATHROOM':
      return 'ENSUITE';
    case 'UTILITY':
      return 'UTILITY';
    case 'BALCONY':
      return null;
  }
}

/**
 * Build engine RoomRequirement[] from planner budgets.
 * ENTRY becomes FOYER-typed (same id). Duplicate FOYER after ENTRY is dropped.
 */
export function budgetsToRequirements(budgets: AreaBudget[]): RoomRequirement[] {
  const hasEntry = budgets.some(b => b.category === 'ENTRY');
  const out: RoomRequirement[] = [];

  for (const b of budgets) {
    if (b.category === 'BALCONY') continue;
    if (hasEntry && b.category === 'FOYER') continue;
    const type = categoryToSpatialType(b.category);
    if (!type) continue;

    out.push({
      id: b.roomId,
      type,
      minAreaSqM: b.minArea,
      targetAreaSqM: b.targetArea,
      maxAreaSqM: b.maxArea,
      minWidthMm: Math.round(Math.min(b.minWidth, b.minHeight) * 1000),
      preferredAspectRatio: b.preferredAspectRatio,
      hardMaxAspectRatio:
        b.category === 'BEDROOM'
          ? 2.0
          : b.category === 'LIVING'
            ? 2.1
            : Math.max(2.2, b.preferredAspectRatio * 1.4),
      maxSideMm:
        b.category === 'BEDROOM'
          ? 6000
          : b.category === 'LIVING'
            ? 7500
            : b.category === 'KITCHEN'
              ? 5500
              : 6000,
      exteriorAccess:
        b.category === 'LIVING' || b.category === 'BEDROOM'
          ? 'REQUIRED'
          : b.category === 'KITCHEN'
            ? 'PREFERRED'
            : 'OPTIONAL',
      circulationAllowed:
        b.category === 'LIVING' ||
        b.category === 'CORRIDOR' ||
        b.category === 'ENTRY' ||
        b.category === 'FOYER',
      expansionWeight: Math.max(0.05, b.areaPriority / 10),
    });
  }
  return out;
}

/**
 * Convert planner AccessTree → spatial AccessGraph (for packer family + adjacency hints).
 */
export function accessTreeToAccessGraph(
  tree: AccessTree,
  family: TopologyFamily,
): AccessGraph {
  const packedIds = new Set(
    tree.nodes
      .filter(n => categoryToSpatialType(n.category) !== null)
      .filter(n => !(n.category === 'FOYER' && tree.nodes.some(x => x.category === 'ENTRY')))
      .map(n => n.id),
  );

  const exterior: SpatialAccessNode = { id: 'EXTERIOR', type: 'EXTERIOR' };
  const roomNodes: SpatialAccessNode[] = [...packedIds].map(id => ({
    id: `node_${id}`,
    roomId: id,
    type: 'ROOM' as const,
  }));
  const nodes = [exterior, ...roomNodes];
  const edges: SpatialAccessEdge[] = [];

  const entry =
    tree.nodes.find(n => n.category === 'ENTRY' && packedIds.has(n.id)) ??
    tree.nodes.find(n => n.category === 'FOYER' && packedIds.has(n.id)) ??
    tree.nodes.find(n => n.category === 'LIVING' && packedIds.has(n.id));

  if (entry) {
    edges.push({
      id: `EXTERIOR__node_${entry.id}`,
      from: 'EXTERIOR',
      to: `node_${entry.id}`,
      required: true,
      kind: 'PRIMARY_ACCESS',
    });
  }

  for (const e of tree.edges) {
    if (!packedIds.has(e.parentId) || !packedIds.has(e.childId)) continue;
    const child = tree.nodes.find(n => n.id === e.childId);
    const kind =
      child?.category === 'ENSUITE_BATHROOM' ? 'ENSUITE_ACCESS' : 'PRIMARY_ACCESS';
    edges.push({
      id: `node_${e.parentId}__node_${e.childId}`,
      from: `node_${e.parentId}`,
      to: `node_${e.childId}`,
      required: e.kind === 'required',
      kind,
    });
  }

  return {
    family,
    nodes,
    edges,
    entryNodeId: 'EXTERIOR',
  };
}

/**
 * Convert a geometry-resolved spatial AccessGraph back to planner AccessTree
 * so placeDoors/validation match the packed adjacencies.
 */
export function accessGraphToAccessTree(
  graph: AccessGraph,
  categoryByRoomId: Map<string, AccessNodeCategory>,
): AccessTree {
  const nodes: AccessNode[] = [];
  const edges: AccessEdge[] = [];
  const seen = new Set<string>();

  for (const n of graph.nodes) {
    if (n.type !== 'ROOM' || !n.roomId) continue;
    if (seen.has(n.roomId)) continue;
    seen.add(n.roomId);
    const category = categoryByRoomId.get(n.roomId) ?? 'LIVING';
    nodes.push({ id: n.roomId, category, label: n.roomId });
  }

  let entryId =
    nodes.find(n => n.category === 'ENTRY')?.id ??
    nodes.find(n => n.category === 'FOYER')?.id;

  for (const e of graph.edges) {
    if (e.from === 'EXTERIOR' || e.to === 'EXTERIOR') {
      const hostNode = graph.nodes.find(
        n => n.id === (e.from === 'EXTERIOR' ? e.to : e.from),
      );
      if (hostNode?.roomId) entryId = hostNode.roomId;
      continue;
    }
    const a = graph.nodes.find(n => n.id === e.from)?.roomId;
    const b = graph.nodes.find(n => n.id === e.to)?.roomId;
    if (!a || !b || a === b) continue;
    pushOrientedEdge(edges, nodes, categoryByRoomId, a, b);
  }

  finalizeEntry(nodes, edges, entryId);
  return {
    rootId: entryId ?? nodes[0]?.id ?? 'root',
    nodes,
    edges,
  };
}

/**
 * Build AccessTree purely from rooms + shared-wall adjacencies.
 * Edges are filtered to legal access pairs and pruned to a spanning tree.
 */
export function accessTreeFromSharedWalls(
  rooms: Array<{ id: string; category: AccessNodeCategory }>,
  sharedPairs: Array<{ roomAId: string; roomBId: string; length: number }>,
  minDoorLength = 0.9,
): AccessTree {
  const categoryByRoomId = new Map(rooms.map(r => [r.id, r.category]));
  const nodes: AccessNode[] = rooms.map(r => ({
    id: r.id,
    category: r.category,
    label: r.id,
  }));

  type Cand = { a: string; b: string; length: number; score: number };
  const cands: Cand[] = [];
  const seen = new Set<string>();

  for (const w of sharedPairs) {
    if (w.length < minDoorLength) continue;
    const key = [w.roomAId, w.roomBId].sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    const ca = categoryByRoomId.get(w.roomAId);
    const cb = categoryByRoomId.get(w.roomBId);
    if (!ca || !cb || !isLegalAccessPair(ca, cb)) continue;
    const score = pairPriority(ca, cb) * 1000 + w.length;
    cands.push({ a: w.roomAId, b: w.roomBId, length: w.length, score });
  }

  cands.sort((x, y) => y.score - x.score);

  const edges: AccessEdge[] = [];
  const childTaken = new Set<string>(); // rooms that already have a parent (except living hub)
  const ensuiteAttached = new Set<string>();

  for (const c of cands) {
    const ca = categoryByRoomId.get(c.a)!;
    const cb = categoryByRoomId.get(c.b)!;

    // Orient parent → child
    let parentId = c.a;
    let childId = c.b;
    let parentCat = ca;
    let childCat = cb;
    if (shouldSwapParent(ca, cb)) {
      parentId = c.b;
      childId = c.a;
      parentCat = cb;
      childCat = ca;
    }

    // Ensuite: exactly one bedroom parent
    if (childCat === 'ENSUITE_BATHROOM') {
      if (parentCat !== 'BEDROOM' || ensuiteAttached.has(childId)) continue;
      edges.push({ parentId, childId, kind: 'required' });
      const ensuite = nodes.find(n => n.id === childId);
      if (ensuite) ensuite.attachedTo = parentId;
      ensuiteAttached.add(childId);
      childTaken.add(childId);
      continue;
    }

    // Common bath: exactly one parent (prefer corridor/foyer, allow living)
    if (childCat === 'COMMON_BATHROOM') {
      if (childTaken.has(childId)) continue;
      if (
        parentCat !== 'CORRIDOR' &&
        parentCat !== 'FOYER' &&
        parentCat !== 'LIVING' &&
        parentCat !== 'ENTRY'
      ) {
        continue;
      }
      edges.push({ parentId, childId, kind: 'required' });
      childTaken.add(childId);
      continue;
    }

    // Bedrooms: exactly one primary parent
    if (childCat === 'BEDROOM') {
      if (childTaken.has(childId)) continue;
      if (parentCat !== 'LIVING' && parentCat !== 'CORRIDOR' && parentCat !== 'ENTRY') {
        continue;
      }
      edges.push({ parentId, childId, kind: 'required' });
      childTaken.add(childId);
      continue;
    }

    // Kitchen: one living parent
    if (childCat === 'KITCHEN') {
      if (childTaken.has(childId)) continue;
      if (parentCat !== 'LIVING' && parentCat !== 'ENTRY') continue;
      edges.push({ parentId, childId, kind: 'required' });
      childTaken.add(childId);
      continue;
    }

    // Corridor / living / entry links — allow hub connectivity
    if (
      (parentCat === 'ENTRY' && (childCat === 'LIVING' || childCat === 'CORRIDOR' || childCat === 'FOYER')) ||
      (parentCat === 'FOYER' && childCat === 'LIVING') ||
      (parentCat === 'LIVING' && childCat === 'CORRIDOR') ||
      (parentCat === 'CORRIDOR' && childCat === 'LIVING')
    ) {
      const edgeKey = `${parentId}->${childId}`;
      if (edges.some(e => `${e.parentId}->${e.childId}` === edgeKey)) continue;
      // Prefer single ENTRY→LIVING
      if (parentCat === 'ENTRY' && childCat === 'LIVING' && childTaken.has(childId)) continue;
      edges.push({ parentId, childId, kind: 'required' });
      if (childCat !== 'LIVING' && childCat !== 'CORRIDOR') childTaken.add(childId);
      continue;
    }
  }

  const entryId = nodes.find(n => n.category === 'ENTRY')?.id;
  finalizeEntry(nodes, edges, entryId);
  return {
    rootId: entryId ?? nodes[0]?.id ?? 'root',
    nodes,
    edges,
  };
}

function isLegalAccessPair(a: AccessNodeCategory, b: AccessNodeCategory): boolean {
  if (a === 'BEDROOM' && b === 'BEDROOM') return false;
  if (
    (a === 'BEDROOM' && b === 'COMMON_BATHROOM') ||
    (b === 'BEDROOM' && a === 'COMMON_BATHROOM')
  ) {
    return false;
  }
  if (
    (a === 'BEDROOM' && b === 'KITCHEN') ||
    (b === 'BEDROOM' && a === 'KITCHEN')
  ) {
    return false;
  }
  if (a === 'ENSUITE_BATHROOM' || b === 'ENSUITE_BATHROOM') {
    const other = a === 'ENSUITE_BATHROOM' ? b : a;
    if (other !== 'BEDROOM') return false;
  }
  if (
    (a === 'COMMON_BATHROOM' && b === 'ENSUITE_BATHROOM') ||
    (b === 'COMMON_BATHROOM' && a === 'ENSUITE_BATHROOM')
  ) {
    return false;
  }
  return true;
}

function pairPriority(a: AccessNodeCategory, b: AccessNodeCategory): number {
  const pair = new Set([a, b]);
  if (pair.has('ENTRY') && pair.has('LIVING')) return 10;
  if (pair.has('BEDROOM') && pair.has('ENSUITE_BATHROOM')) return 9;
  if (pair.has('CORRIDOR') && pair.has('COMMON_BATHROOM')) return 8;
  if (pair.has('LIVING') && pair.has('COMMON_BATHROOM')) return 8;
  if (pair.has('FOYER') && pair.has('COMMON_BATHROOM')) return 8;
  if (pair.has('LIVING') && pair.has('BEDROOM')) return 7;
  if (pair.has('CORRIDOR') && pair.has('BEDROOM')) return 7;
  if (pair.has('LIVING') && pair.has('KITCHEN')) return 6;
  if (pair.has('LIVING') && pair.has('CORRIDOR')) return 5;
  if (pair.has('ENTRY') && pair.has('CORRIDOR')) return 4;
  return 1;
}

function shouldSwapParent(a: AccessNodeCategory, b: AccessNodeCategory): boolean {
  const rank = (c: AccessNodeCategory): number => {
    switch (c) {
      case 'ENTRY':
        return 0;
      case 'FOYER':
        return 1;
      case 'CORRIDOR':
        return 2;
      case 'LIVING':
        return 3;
      case 'KITCHEN':
        return 4;
      case 'BEDROOM':
        return 5;
      case 'COMMON_BATHROOM':
        return 6;
      case 'ENSUITE_BATHROOM':
        return 7;
      default:
        return 4;
    }
  };
  return rank(a) > rank(b);
}

function pushOrientedEdge(
  edges: AccessEdge[],
  nodes: AccessNode[],
  categoryByRoomId: Map<string, AccessNodeCategory>,
  a: string,
  b: string,
): void {
  const catA = categoryByRoomId.get(a);
  const catB = categoryByRoomId.get(b);
  const rank = (c?: AccessNodeCategory): number => {
    switch (c) {
      case 'ENTRY':
        return 0;
      case 'FOYER':
        return 1;
      case 'CORRIDOR':
        return 2;
      case 'LIVING':
        return 3;
      case 'KITCHEN':
        return 4;
      case 'BEDROOM':
        return 5;
      case 'COMMON_BATHROOM':
        return 6;
      case 'ENSUITE_BATHROOM':
        return 7;
      default:
        return 4;
    }
  };
  if (catB === 'ENSUITE_BATHROOM') {
    edges.push({ parentId: a, childId: b, kind: 'required' });
    const ensuite = nodes.find(n => n.id === b);
    if (ensuite) ensuite.attachedTo = a;
  } else if (catA === 'ENSUITE_BATHROOM') {
    edges.push({ parentId: b, childId: a, kind: 'required' });
    const ensuite = nodes.find(n => n.id === a);
    if (ensuite) ensuite.attachedTo = b;
  } else if (rank(catA) <= rank(catB)) {
    edges.push({ parentId: a, childId: b, kind: 'required' });
  } else {
    edges.push({ parentId: b, childId: a, kind: 'required' });
  }
}

function finalizeEntry(
  nodes: AccessNode[],
  edges: AccessEdge[],
  entryId: string | undefined,
): void {
  if (!entryId) return;
  const entryNode = nodes.find(n => n.id === entryId);
  if (entryNode && entryNode.category === 'FOYER') {
    entryNode.category = 'ENTRY';
  }
  const living = nodes.find(n => n.category === 'LIVING');
  if (
    living &&
    entryId !== living.id &&
    !edges.some(e => e.parentId === entryId || e.childId === entryId)
  ) {
    edges.push({ parentId: entryId, childId: living.id, kind: 'required' });
  }
}
