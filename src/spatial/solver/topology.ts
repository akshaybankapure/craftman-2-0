import type {
  AccessEdge,
  AccessGraph,
  AccessNode,
  NormalizedBrief,
  ProgrammeBudget,
  ReasoningIssue,
  ReasoningResult,
  RoomRequirement,
  TopologyFamily
} from "../types.ts";

function issue(code: string, message: string, affectedIds: string[] = [], evidence?: Record<string, unknown>): ReasoningIssue {
  const base: ReasoningIssue = { code, stage: "TOPOLOGY", message, affectedIds };
  return evidence === undefined ? base : { ...base, evidence };
}

function nodeForRoom(req: RoomRequirement): AccessNode {
  return { id: `node_${req.id}`, roomId: req.id, type: "ROOM" };
}

function edge(from: string, to: string, kind: AccessEdge["kind"] = "PRIMARY_ACCESS"): AccessEdge {
  return { id: `${from}__${to}`, from, to, required: true, kind };
}

function roomNodesByType(budget: ProgrammeBudget, type: RoomRequirement["type"]): AccessNode[] {
  return budget.requirements.filter((r) => r.type === type).map(nodeForRoom);
}

function findOne(budget: ProgrammeBudget, type: RoomRequirement["type"]): AccessNode | undefined {
  const req = budget.requirements.find((r) => r.type === type);
  return req ? nodeForRoom(req) : undefined;
}

export function generateTopologyVariants(brief: NormalizedBrief, budget: ProgrammeBudget): AccessGraph[] {
  // Prefer lobby-based families for 3+ BHK so private wings remain legal.
  const families: TopologyFamily[] =
    brief.bhk >= 3
      ? ["PRIVATE_LOBBY", "SPLIT_WING", "HALL_CENTRIC"]
      : ["HALL_CENTRIC", "PRIVATE_LOBBY", "SPLIT_WING"];
  return families.map((family) => buildTopology(family, brief, budget));
}

function buildTopology(family: TopologyFamily, brief: NormalizedBrief, budget: ProgrammeBudget): AccessGraph {
  const exterior: AccessNode = { id: "EXTERIOR", type: "EXTERIOR" };
  const roomNodes = budget.requirements.map(nodeForRoom);
  const nodes = [exterior, ...roomNodes];
  const living = findOne(budget, "LIVING")!;
  const kitchen = findOne(budget, "KITCHEN")!;
  const foyer = findOne(budget, "FOYER");
  const lobby = findOne(budget, "PRIVATE_LOBBY");
  const bedrooms = roomNodesByType(budget, "BEDROOM");
  const ensuites = roomNodesByType(budget, "ENSUITE");
  const commonBaths = roomNodesByType(budget, "BATHROOM");
  const dining = roomNodesByType(budget, "DINING");
  const study = roomNodesByType(budget, "STUDY");
  const utility = roomNodesByType(budget, "UTILITY");
  const storage = roomNodesByType(budget, "STORAGE");
  const lounges = roomNodesByType(budget, "FAMILY_LOUNGE");
  const edges: AccessEdge[] = [];

  const entryHost = foyer ?? living;
  edges.push(edge(exterior.id, entryHost.id));
  if (foyer) edges.push(edge(foyer.id, living.id, "OPEN_TRANSITION"));
  edges.push(edge(living.id, kitchen.id));
  dining.forEach((n) => edges.push(edge(living.id, n.id, "OPEN_TRANSITION")));
  study.forEach((n) => edges.push(edge(living.id, n.id)));
  lounges.forEach((n) => edges.push(edge(living.id, n.id, "OPEN_TRANSITION")));
  utility.forEach((n) => edges.push(edge(kitchen.id, n.id)));
  storage.forEach((n) => edges.push(edge(living.id, n.id)));

  // Common baths may only hang off lobby/foyer (never living) — matches physicalTopology.
  const bathHost = lobby ?? foyer;
  if (lobby) edges.push(edge(living.id, lobby.id, "OPEN_TRANSITION"));

  if (family === "HALL_CENTRIC") {
    // All bedrooms off living/hall; baths off lobby/foyer when present.
    bedrooms.forEach((bed) => edges.push(edge(living.id, bed.id)));
    if (bathHost) commonBaths.forEach((bath) => edges.push(edge(bathHost.id, bath.id)));
    else if (commonBaths.length === 0) {
      // legal: ensuite-only programmes
    } else {
      // Last resort for 1 BHK without lobby/foyer: attach one bath to living is illegal
      // in physical resolution — leave baths unattached so validateTopology fails closed.
    }
  } else if (family === "SPLIT_WING") {
    // Public wing (guest / first bedroom) off living; private wing off lobby.
    const privateHost = lobby ?? living;
    if (bedrooms.length <= 2) {
      bedrooms.forEach((bed, i) => {
        const parent = i === 0 ? living : privateHost;
        edges.push(edge(parent.id, bed.id));
      });
    } else {
      // 3–4 BHK: first bedroom public (guest), remaining private.
      bedrooms.forEach((bed, i) => {
        const parent = i === 0 ? living : privateHost;
        edges.push(edge(parent.id, bed.id));
      });
    }
    if (bathHost) commonBaths.forEach((bath) => edges.push(edge(bathHost.id, bath.id)));
    // Optional study near private wing for larger homes
    if (brief.bhk >= 3 && study.length === 0 && lobby) {
      // no-op: study already wired from living when present
    }
  } else {
    // PRIVATE_LOBBY: all bedrooms + common baths off the private host.
    const privateHost = lobby ?? living;
    bedrooms.forEach((bed) => edges.push(edge(privateHost.id, bed.id)));
    if (bathHost) commonBaths.forEach((bath) => edges.push(edge(bathHost.id, bath.id)));
    else if (privateHost !== living) commonBaths.forEach((bath) => edges.push(edge(privateHost.id, bath.id)));
  }

  ensuites.forEach((ensuite, i) => {
    const bedroom = bedrooms[i % Math.max(1, bedrooms.length)]!;
    if (bedroom) edges.push(edge(bedroom.id, ensuite.id, "ENSUITE_ACCESS"));
  });

  return { family, nodes, edges, entryNodeId: exterior.id };
}

export function validateTopology(graph: AccessGraph, budget: ProgrammeBudget): ReasoningResult<AccessGraph> {
  const fatalErrors: ReasoningIssue[] = [];
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const reqById = new Map(budget.requirements.map((r) => [r.id, r]));
  const adjacency = new Map<string, string[]>();
  graph.nodes.forEach((n) => adjacency.set(n.id, []));
  for (const e of graph.edges) {
    if (!nodeById.has(e.from) || !nodeById.has(e.to)) {
      fatalErrors.push(issue("TOPOLOGY_MISSING_NODE", "An access edge references a missing node.", [e.id]));
      continue;
    }
    adjacency.get(e.from)!.push(e.to);
    adjacency.get(e.to)!.push(e.from);
  }

  const typeOf = (nodeId: string): RoomRequirement["type"] | "EXTERIOR" => {
    const node = nodeById.get(nodeId)!;
    if (node.type === "EXTERIOR") return "EXTERIOR";
    return reqById.get(node.roomId!)!.type;
  };

  for (const e of graph.edges) {
    const a = typeOf(e.from);
    const b = typeOf(e.to);
    const pair = new Set([a, b]);
    if (
      pair.has("BATHROOM") &&
      (pair.has("KITCHEN") ||
        pair.has("ENSUITE") ||
        pair.has("LIVING") ||
        (a === "BATHROOM" && b === "BATHROOM"))
    ) {
      fatalErrors.push(issue("TOPOLOGY_FORBIDDEN_BATHROOM_EDGE", `Forbidden access edge ${a} ↔ ${b}.`, [e.id]));
    }
    if (a === "BEDROOM" && b === "BEDROOM") {
      fatalErrors.push(issue("TOPOLOGY_BEDROOM_TO_BEDROOM", "Bedrooms may not provide primary access to one another.", [e.id]));
    }
    if (pair.has("EXTERIOR") && (pair.has("BEDROOM") || pair.has("BATHROOM") || pair.has("ENSUITE") || pair.has("KITCHEN"))) {
      fatalErrors.push(issue("TOPOLOGY_INVALID_ENTRY_EDGE", `Exterior cannot open directly to ${a === "EXTERIOR" ? b : a}.`, [e.id]));
    }
  }

  const roomNodeIds = graph.nodes.filter((n) => n.type === "ROOM").map((n) => n.id);
  const visited = new Set<string>();
  const queue = [graph.entryNodeId];
  while (queue.length) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const next of adjacency.get(current) ?? []) if (!visited.has(next)) queue.push(next);
  }
  const unreachable = roomNodeIds.filter((id) => !visited.has(id));
  if (unreachable.length) fatalErrors.push(issue("TOPOLOGY_UNREACHABLE", "Some rooms are not reachable from the entrance.", unreachable));

  for (const node of graph.nodes) {
    if (node.type !== "ROOM") continue;
    const req = reqById.get(node.roomId!)!;
    const degree = adjacency.get(node.id)?.length ?? 0;
    if ((req.type === "BATHROOM" || req.type === "ENSUITE") && degree !== 1) {
      fatalErrors.push(issue("TOPOLOGY_BATHROOM_DEGREE", `${req.type} must have degree exactly one.`, [node.roomId!], { degree }));
    }
    if (req.type === "BEDROOM") {
      const nonEnsuiteNeighbours = (adjacency.get(node.id) ?? []).filter((other) => typeOf(other) !== "ENSUITE");
      if (nonEnsuiteNeighbours.length !== 1) {
        fatalErrors.push(issue("TOPOLOGY_BEDROOM_PRIMARY_PARENT", "Each bedroom must have exactly one non-ensuite access edge.", [node.roomId!], {
          primaryDegree: nonEnsuiteNeighbours.length
        }));
      }
    }
  }

  return {
    passed: fatalErrors.length === 0,
    ...(fatalErrors.length === 0 ? { value: graph } : {}),
    fatalErrors,
    repairableErrors: [],
    warnings: [],
    metrics: { nodeCount: graph.nodes.length, edgeCount: graph.edges.length, family: graph.family }
  };
}
