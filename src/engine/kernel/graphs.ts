/**
 * Generic undirected / directed graph utilities.
 */

export type GraphAdj = Map<string, string[]>;

export function emptyAdj(nodeIds: Iterable<string>): GraphAdj {
  const adj: GraphAdj = new Map();
  for (const id of nodeIds) adj.set(id, []);
  return adj;
}

export function addUndirected(adj: GraphAdj, a: string, b: string): void {
  if (!adj.has(a)) adj.set(a, []);
  if (!adj.has(b)) adj.set(b, []);
  if (!adj.get(a)!.includes(b)) adj.get(a)!.push(b);
  if (!adj.get(b)!.includes(a)) adj.get(b)!.push(a);
}

export function addDirected(adj: GraphAdj, a: string, b: string): void {
  if (!adj.has(a)) adj.set(a, []);
  if (!adj.has(b)) adj.set(b, []);
  if (!adj.get(a)!.includes(b)) adj.get(a)!.push(b);
}

export function degree(adj: GraphAdj, id: string): number {
  return adj.get(id)?.length ?? 0;
}

export function bfsReachable(adj: GraphAdj, root: string): Set<string> {
  const seen = new Set<string>();
  const q = [root];
  seen.add(root);
  while (q.length) {
    const cur = q.shift()!;
    for (const n of adj.get(cur) ?? []) {
      if (!seen.has(n)) {
        seen.add(n);
        q.push(n);
      }
    }
  }
  return seen;
}

export function connectedComponents(adj: GraphAdj): string[][] {
  const remaining = new Set(adj.keys());
  const comps: string[][] = [];
  while (remaining.size) {
    const start = remaining.values().next().value!;
    const reach = bfsReachable(adj, start);
    comps.push([...reach]);
    for (const id of reach) remaining.delete(id);
  }
  return comps;
}

/**
 * Articulation points (cut vertices) via Tarjan DFS.
 * Removing an articulation point increases component count.
 */
export function articulationPoints(adj: GraphAdj): Set<string> {
  const nodes = [...adj.keys()];
  const disc = new Map<string, number>();
  const low = new Map<string, number>();
  const parent = new Map<string, string | null>();
  const ap = new Set<string>();
  let time = 0;

  function dfs(u: string): void {
    disc.set(u, time);
    low.set(u, time);
    time++;
    let children = 0;
    for (const v of adj.get(u) ?? []) {
      if (!disc.has(v)) {
        children++;
        parent.set(v, u);
        dfs(v);
        low.set(u, Math.min(low.get(u)!, low.get(v)!));
        if (parent.get(u) === null && children > 1) ap.add(u);
        if (parent.get(u) !== null && low.get(v)! >= disc.get(u)!) ap.add(u);
      } else if (v !== parent.get(u)) {
        low.set(u, Math.min(low.get(u)!, disc.get(v)!));
      }
    }
  }

  for (const n of nodes) {
    if (!disc.has(n)) {
      parent.set(n, null);
      dfs(n);
    }
  }
  return ap;
}

/** True if removing `nodeId` disconnects any of `mustReach` from `root`. */
export function isArticulationFor(
  adj: GraphAdj,
  nodeId: string,
  root: string,
  mustReach: readonly string[],
): boolean {
  if (nodeId === root) return false;
  const filtered: GraphAdj = new Map();
  for (const [k, vs] of adj) {
    if (k === nodeId) continue;
    filtered.set(k, vs.filter(v => v !== nodeId));
  }
  if (!filtered.has(root)) return true;
  const seen = bfsReachable(filtered, root);
  return mustReach.some(id => id !== nodeId && !seen.has(id));
}
