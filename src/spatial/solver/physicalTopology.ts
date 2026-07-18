import { BATHROOM_DOOR_WIDTH_MM, DEFAULT_DOOR_WIDTH_MM, DOOR_SIDE_CLEARANCE_MM } from "../constants.ts";
import type {
  AccessEdge,
  AccessGraph,
  AccessNode,
  ReasoningIssue,
  ReasoningResult,
  SharedBoundary,
  SpaceRegion,
  TopologyFamily
} from "../types.ts";
import { OccupancyGrid } from "../grid/OccupancyGrid.ts";

function issue(code: string, message: string, affectedIds: string[] = [], evidence?: Record<string, unknown>): ReasoningIssue {
  const base: ReasoningIssue = { code, stage: "TOPOLOGY", message, affectedIds };
  return evidence === undefined ? base : { ...base, evidence };
}

function edge(from: string, to: string, kind: AccessEdge["kind"] = "PRIMARY_ACCESS"): AccessEdge {
  return { id: `${from}__${to}`, from, to, required: true, kind };
}

function roomNode(space: SpaceRegion): AccessNode {
  return { id: `node_${space.id}`, roomId: space.id, type: "ROOM" };
}

function boundaryFor(boundaries: SharedBoundary[], a: string, b: string): SharedBoundary | undefined {
  return boundaries.find((s) => (s.roomAId === a && s.roomBId === b) || (s.roomAId === b && s.roomBId === a));
}

function doorCapable(boundaries: SharedBoundary[], a: SpaceRegion, b: SpaceRegion): boolean {
  const boundary = boundaryFor(boundaries, a.id, b.id);
  if (!boundary) return false;
  const width = [a.type, b.type].some((t) => t === "BATHROOM" || t === "ENSUITE") ? BATHROOM_DOOR_WIDTH_MM : DEFAULT_DOOR_WIDTH_MM;
  const needed = width + 2 * DOOR_SIDE_CLEARANCE_MM;
  return boundary.segments.some((s) => s.end - s.start >= needed);
}

function touchesEntranceEdge(grid: OccupancyGrid, space: SpaceRegion, edgeName: "NORTH" | "SOUTH" | "EAST" | "WEST"): boolean {
  for (let idx = 0; idx < grid.labels.length; idx++) {
    if (grid.labels[idx] !== space.label) continue;
    const { x, y } = grid.coords(idx);
    if (edgeName === "NORTH" && (y === 0 || !grid.isInside(grid.index(x, y - 1)))) return true;
    if (edgeName === "SOUTH" && (y + 1 >= grid.height || !grid.isInside(grid.index(x, y + 1)))) return true;
    if (edgeName === "WEST" && (x === 0 || !grid.isInside(grid.index(x - 1, y)))) return true;
    if (edgeName === "EAST" && (x + 1 >= grid.width || !grid.isInside(grid.index(x + 1, y)))) return true;
  }
  return false;
}

export function resolvePhysicalTopology(
  family: TopologyFamily,
  spaces: SpaceRegion[],
  boundaries: SharedBoundary[],
  grid: OccupancyGrid,
  entranceEdge: "NORTH" | "SOUTH" | "EAST" | "WEST"
): ReasoningResult<AccessGraph> {
  const fatalErrors: ReasoningIssue[] = [];
  const exterior: AccessNode = { id: "EXTERIOR", type: "EXTERIOR" };
  const nodes = [exterior, ...spaces.map(roomNode)];
  const edges: AccessEdge[] = [];
  const byType = (type: SpaceRegion["type"]): SpaceRegion[] => spaces.filter((s) => s.type === type);
  const living = byType("LIVING")[0];
  const kitchen = byType("KITCHEN")[0];
  const foyer = byType("FOYER")[0];
  const lobby = byType("PRIVATE_LOBBY")[0];
  const bedrooms = byType("BEDROOM");
  const ensuites = byType("ENSUITE");
  const commonBaths = byType("BATHROOM");

  if (!living || !kitchen) {
    fatalErrors.push(issue("PHYSICAL_TOPOLOGY_CORE_MISSING", "Living and Kitchen are required."));
    return { passed: false, fatalErrors, repairableErrors: [], warnings: [], metrics: {} };
  }

  const entryHost = foyer && touchesEntranceEdge(grid, foyer, entranceEdge)
    ? foyer
    : touchesEntranceEdge(grid, living, entranceEdge)
      ? living
      : undefined;
  if (!entryHost) fatalErrors.push(issue("PHYSICAL_TOPOLOGY_NO_ENTRY_HOST", "Neither Foyer nor Living touches the selected entrance edge.", [foyer?.id ?? "", living.id].filter(Boolean)));
  else edges.push(edge(exterior.id, `node_${entryHost.id}`));

  if (foyer && foyer.id !== entryHost?.id) {
    if (doorCapable(boundaries, foyer, living)) edges.push(edge(`node_${foyer.id}`, `node_${living.id}`, "OPEN_TRANSITION"));
    else fatalErrors.push(issue("PHYSICAL_TOPOLOGY_FOYER_LIVING", "Foyer does not share a door-capable boundary with Living.", [foyer.id, living.id]));
  } else if (foyer && entryHost?.id === foyer.id) {
    if (doorCapable(boundaries, foyer, living)) edges.push(edge(`node_${foyer.id}`, `node_${living.id}`, "OPEN_TRANSITION"));
    else fatalErrors.push(issue("PHYSICAL_TOPOLOGY_FOYER_LIVING", "Foyer does not share a door-capable boundary with Living.", [foyer.id, living.id]));
  }

  if (doorCapable(boundaries, living, kitchen)) edges.push(edge(`node_${living.id}`, `node_${kitchen.id}`));
  else {
    const dining = byType("DINING").find((d) => doorCapable(boundaries, living, d) && doorCapable(boundaries, d, kitchen));
    if (dining) {
      edges.push(edge(`node_${living.id}`, `node_${dining.id}`, "OPEN_TRANSITION"));
      edges.push(edge(`node_${dining.id}`, `node_${kitchen.id}`));
    } else fatalErrors.push(issue("PHYSICAL_TOPOLOGY_KITCHEN_ACCESS", "Kitchen has no legal door-capable connection to Living or Dining.", [kitchen.id]));
  }

  let privateHost = living;
  if (lobby) {
    const host = doorCapable(boundaries, living, lobby) ? living : foyer && doorCapable(boundaries, foyer, lobby) ? foyer : undefined;
    if (!host) fatalErrors.push(issue("PHYSICAL_TOPOLOGY_LOBBY_ACCESS", "Private lobby has no legal connection to Living or Foyer.", [lobby.id]));
    else {
      edges.push(edge(`node_${host.id}`, `node_${lobby.id}`, "OPEN_TRANSITION"));
      privateHost = lobby;
    }
  }

  for (const bedroom of bedrooms) {
    const preferred = family === "HALL_CENTRIC" && doorCapable(boundaries, living, bedroom) ? living : privateHost;
    const parent = doorCapable(boundaries, preferred, bedroom)
      ? preferred
      : doorCapable(boundaries, living, bedroom)
        ? living
        : lobby && doorCapable(boundaries, lobby, bedroom)
          ? lobby
          : undefined;
    if (!parent) fatalErrors.push(issue("PHYSICAL_TOPOLOGY_BEDROOM_ACCESS", `${bedroom.id} has no legal door-capable parent.`, [bedroom.id]));
    else edges.push(edge(`node_${parent.id}`, `node_${bedroom.id}`));
  }

  const unusedBedrooms = new Set(bedrooms.map((b) => b.id));
  for (const ensuite of ensuites) {
    const parent = bedrooms.find((b) => unusedBedrooms.has(b.id) && doorCapable(boundaries, b, ensuite));
    if (!parent) fatalErrors.push(issue("PHYSICAL_TOPOLOGY_ENSUITE_ACCESS", `${ensuite.id} is not adjacent to an available Bedroom.`, [ensuite.id]));
    else {
      unusedBedrooms.delete(parent.id);
      edges.push(edge(`node_${parent.id}`, `node_${ensuite.id}`, "ENSUITE_ACCESS"));
    }
  }

  for (const bath of commonBaths) {
    const candidates = [lobby, foyer].filter((s): s is SpaceRegion => Boolean(s));
    const parent = candidates.find((s) => doorCapable(boundaries, s, bath));
    if (!parent) fatalErrors.push(issue("PHYSICAL_TOPOLOGY_COMMON_BATH_ACCESS", `${bath.id} must connect to a lobby or foyer, but no door-capable boundary exists.`, [bath.id]));
    else edges.push(edge(`node_${parent.id}`, `node_${bath.id}`));
  }

  const handled = new Set(edges.flatMap((e) => [e.from, e.to]));
  for (const space of spaces) {
    const nodeId = `node_${space.id}`;
    if (handled.has(nodeId)) continue;
    const preferredParents = space.type === "UTILITY" ? [kitchen] : [living, foyer, lobby].filter((s): s is SpaceRegion => Boolean(s));
    const parent = preferredParents.find((p) => doorCapable(boundaries, p, space));
    if (!parent) fatalErrors.push(issue("PHYSICAL_TOPOLOGY_OPTIONAL_ACCESS", `${space.id} has no legal door-capable parent.`, [space.id]));
    else edges.push(edge(`node_${parent.id}`, nodeId, space.type === "DINING" || space.type === "FAMILY_LOUNGE" ? "OPEN_TRANSITION" : "PRIMARY_ACCESS"));
  }

  const graph: AccessGraph = { family, nodes, edges, entryNodeId: exterior.id };
  return {
    passed: fatalErrors.length === 0,
    ...(fatalErrors.length === 0 ? { value: graph } : {}),
    fatalErrors,
    repairableErrors: [],
    warnings: [],
    metrics: { edgeCount: edges.length, family }
  };
}
