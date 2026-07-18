/**
 * Collapse optional CORRIDOR nodes into Living when circulation is living-integrated.
 * Corridor stays optional: topology still supports corridor families when materialised.
 */

import type { AccessEdge, AccessNode, AccessTree } from '../../planner/types.ts';

/**
 * Remove CORRIDOR category nodes and rewire their neighbours onto Living
 * (or Foyer / Entry as fallback). Returns a new tree; input is not mutated.
 */
export function collapseOptionalCorridor(tree: AccessTree): AccessTree {
  const corridors = tree.nodes.filter(n => n.category === 'CORRIDOR');
  if (corridors.length === 0) return tree;

  const host =
    tree.nodes.find(n => n.category === 'LIVING') ??
    tree.nodes.find(n => n.category === 'FOYER') ??
    tree.nodes.find(n => n.category === 'ENTRY');
  if (!host) return tree;

  const corridorIds = new Set(corridors.map(n => n.id));
  const nodes: AccessNode[] = tree.nodes.filter(n => !corridorIds.has(n.id));
  const edges: AccessEdge[] = [];
  const seen = new Set<string>();

  const push = (parentId: string, childId: string) => {
    if (parentId === childId) return;
    const key = `${parentId}->${childId}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ parentId, childId, kind: 'required' });
  };

  for (const e of tree.edges) {
    const aCorr = corridorIds.has(e.parentId);
    const bCorr = corridorIds.has(e.childId);
    if (aCorr && bCorr) continue;
    if (aCorr) {
      push(host.id, e.childId);
      continue;
    }
    if (bCorr) {
      // Orient: host as parent of the former corridor parent when that parent is living-side
      const parentNode = tree.nodes.find(n => n.id === e.parentId);
      if (
        parentNode &&
        (parentNode.category === 'ENTRY' ||
          parentNode.category === 'FOYER' ||
          parentNode.category === 'LIVING')
      ) {
        // entry/living → corridor becomes entry/living → (nothing); children already rewired
        continue;
      }
      push(host.id, e.parentId);
      continue;
    }
    push(e.parentId, e.childId);
  }

  // Ensure every bedroom / bath that lost its corridor parent still hangs off host
  for (const n of nodes) {
    if (
      n.category !== 'BEDROOM' &&
      n.category !== 'COMMON_BATHROOM' &&
      n.category !== 'KITCHEN'
    ) {
      continue;
    }
    const hasParent = edges.some(e => e.childId === n.id);
    if (!hasParent) push(host.id, n.id);
  }

  return {
    rootId: corridorIds.has(tree.rootId) ? host.id : tree.rootId,
    nodes,
    edges,
  };
}
