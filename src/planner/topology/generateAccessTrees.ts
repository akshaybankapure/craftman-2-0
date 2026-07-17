import { programmeFromSpec } from '../budget/areaBudget.ts';
import { RNG } from '../rng.ts';
import type { AccessEdge, AccessNode, AccessNodeCategory, AccessTree } from '../types.ts';
import type { ProgramSpec } from '../../types/index.ts';
import { allowedParents, isAllowedEdge, isBathroom, maxDegree } from './accessMatrix.ts';

export interface TopologyProgramme {
  bedrooms: number;
  bathrooms: number;
  hasUtility: boolean;
  hasBalcony: boolean;
  hasFoyer: boolean;
}

/**
 * Generate a legal rooted access tree for the programme.
 * Never emits forbidden edges. Bathrooms are always leaves.
 */
export function generateAccessTree(
  spec: ProgramSpec,
  seed: number,
  variant?: number,
): AccessTree {
  const prog = programmeFromSpec(spec);
  const rng = new RNG(seed);
  const v = variant ?? rng.int(0, 3);
  return buildTree(prog, rng, v);
}

export function generateAccessTreeFromProgramme(
  prog: TopologyProgramme,
  seed: number,
  variant = 0,
): AccessTree {
  return buildTree(prog, new RNG(seed), variant);
}

function buildTree(prog: TopologyProgramme, rng: RNG, variant: number): AccessTree {
  const nodes: AccessNode[] = [];
  const edges: AccessEdge[] = [];
  let seq = 0;
  const id = (cat: AccessNodeCategory, label: string) => {
    const n: AccessNode = { id: `${cat.toLowerCase()}_${seq++}`, category: cat, label };
    nodes.push(n);
    return n;
  };

  const entry = id('ENTRY', 'Entry');
  // Foyer on some variants for topological variety
  const useFoyer = prog.hasFoyer && (variant === 1 || variant === 3) && rng.bool(0.55);
  const foyer = useFoyer ? id('FOYER', 'Foyer') : null;
  const corridor = id('CORRIDOR', 'Corridor');
  const living = id('LIVING', 'Living');
  const kitchen = id('KITCHEN', 'Kitchen');

  if (foyer) {
    link(edges, entry.id, foyer.id);
    link(edges, foyer.id, corridor.id);
    link(edges, corridor.id, living.id);
  } else {
    link(edges, entry.id, corridor.id);
    link(edges, corridor.id, living.id);
  }

  link(edges, living.id, kitchen.id);

  const bedrooms: AccessNode[] = [];
  for (let i = 0; i < prog.bedrooms; i++) {
    bedrooms.push(id('BEDROOM', `Bedroom ${i + 1}`));
  }

  // Ensuite assignment: 1 common + min(baths-1, beds) ensuites
  const ensuiteCount = Math.min(Math.max(0, prog.bathrooms - 1), prog.bedrooms);
  const commonCount = Math.max(1, prog.bathrooms - ensuiteCount);

  const ensuites: AccessNode[] = [];
  for (let i = 0; i < ensuiteCount; i++) {
    const bath = id('ENSUITE_BATHROOM', `Ensuite ${i + 1}`);
    bath.attachedTo = bedrooms[i].id;
    ensuites.push(bath);
    link(edges, bedrooms[i].id, bath.id);
  }

  const commons: AccessNode[] = [];
  for (let i = 0; i < commonCount; i++) {
    const bath = id('COMMON_BATHROOM', `Bathroom ${i + 1}`);
    commons.push(bath);
    // Always corridor parent so geometry can guarantee a shared wall
    link(edges, corridor.id, bath.id);
  }

  // Bedrooms off corridor (reliable shared walls with spine)
  bedrooms.forEach(bed => {
    link(edges, corridor.id, bed.id);
  });

  if (prog.hasUtility) {
    const util = id('UTILITY', 'Utility');
    link(edges, kitchen.id, util.id);
  }

  if (prog.hasBalcony) {
    const bal = id('BALCONY', 'Balcony');
    const parent = rng.bool(0.7) ? living.id : bedrooms[0]?.id ?? living.id;
    link(edges, parent, bal.id);
  }

  const tree: AccessTree = { rootId: entry.id, nodes, edges };
  assertLegalTree(tree);
  return tree;
}

function link(edges: AccessEdge[], parentId: string, childId: string): void {
  edges.push({ parentId, childId, kind: 'required' });
}

export function assertLegalTree(tree: AccessTree): void {
  const byId = new Map(tree.nodes.map(n => [n.id, n]));
  const degree = new Map<string, number>();
  for (const n of tree.nodes) degree.set(n.id, 0);

  for (const e of tree.edges) {
    const a = byId.get(e.parentId);
    const b = byId.get(e.childId);
    if (!a || !b) throw new Error('Edge references missing node');
    if (!isAllowedEdge(a.category, b.category)) {
      throw new Error(`Forbidden edge ${a.category} ↔ ${b.category}`);
    }
    degree.set(e.parentId, (degree.get(e.parentId) ?? 0) + 1);
    degree.set(e.childId, (degree.get(e.childId) ?? 0) + 1);
  }

  for (const n of tree.nodes) {
    const d = degree.get(n.id) ?? 0;
    if (d > maxDegree(n.category)) {
      throw new Error(`Degree ${d} exceeds max for ${n.category}`);
    }
    if (isBathroom(n.category) && d !== 1) {
      throw new Error(`Bathroom ${n.id} must have degree 1, got ${d}`);
    }
  }

  // Parent rules
  for (const e of tree.edges) {
    const parent = byId.get(e.parentId)!;
    const child = byId.get(e.childId)!;
    const allowed = allowedParents(child.category);
    if (allowed.length > 0 && !allowed.includes(parent.category)) {
      // ENTRY↔LIVING without foyer is allowed via isAllowedEdge; skip strict parent for ENTRY-LIVING
      if (!(parent.category === 'ENTRY' && child.category === 'LIVING')) {
        throw new Error(
          `Illegal parent ${parent.category} for ${child.category}`
        );
      }
    }
    if (child.category === 'ENSUITE_BATHROOM' && child.attachedTo !== parent.id) {
      throw new Error('Ensuite must attach to its assigned bedroom');
    }
  }

  // Bathroom removal must not disconnect others from ENTRY
  if (!bathroomRemovalInvariant(tree)) {
    throw new Error('Bathroom articulation invariant failed');
  }

  // All reachable from ENTRY
  if (!allReachable(tree)) {
    throw new Error('Not all rooms reachable from ENTRY');
  }
}

function allReachable(tree: AccessTree): boolean {
  const adj = adjacency(tree);
  const seen = new Set<string>();
  const q = [tree.rootId];
  seen.add(tree.rootId);
  while (q.length) {
    const cur = q.shift()!;
    for (const n of adj.get(cur) ?? []) {
      if (!seen.has(n)) {
        seen.add(n);
        q.push(n);
      }
    }
  }
  return seen.size === tree.nodes.length;
}

/** Removing any bathroom must leave remaining non-bathrooms connected to ENTRY. */
export function bathroomRemovalInvariant(tree: AccessTree): boolean {
  const baths = tree.nodes.filter(n => isBathroom(n.category));
  for (const bath of baths) {
    const filtered: AccessTree = {
      rootId: tree.rootId,
      nodes: tree.nodes.filter(n => n.id !== bath.id),
      edges: tree.edges.filter(
        e => e.parentId !== bath.id && e.childId !== bath.id
      ),
    };
    const nonBath = filtered.nodes.filter(n => !isBathroom(n.category));
    const adj = adjacency(filtered);
    const seen = new Set<string>();
    const q = [filtered.rootId];
    seen.add(filtered.rootId);
    while (q.length) {
      const cur = q.shift()!;
      for (const n of adj.get(cur) ?? []) {
        if (!seen.has(n)) {
          seen.add(n);
          q.push(n);
        }
      }
    }
    for (const n of nonBath) {
      if (!seen.has(n.id)) return false;
    }
  }
  return true;
}

export function adjacency(tree: AccessTree): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const n of tree.nodes) adj.set(n.id, []);
  for (const e of tree.edges) {
    adj.get(e.parentId)!.push(e.childId);
    adj.get(e.childId)!.push(e.parentId);
  }
  return adj;
}

export function childrenOf(tree: AccessTree, parentId: string): string[] {
  return tree.edges.filter(e => e.parentId === parentId).map(e => e.childId);
}

export function parentOf(tree: AccessTree, childId: string): string | null {
  const e = tree.edges.find(x => x.childId === childId);
  return e?.parentId ?? null;
}
