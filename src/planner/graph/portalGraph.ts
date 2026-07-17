import type {
  CorridorSpine,
  Door,
  PortalEdge,
  PortalGraph,
  PortalNode,
  RoomRect,
  RoutePolyline,
  Vec2,
} from '../types.ts';
import { roomCentroid } from '../types.ts';

/** Build portal graph from physical doors; routes pass through door midpoints. */
export function buildPortalGraph(
  rooms: RoomRect[],
  doors: Door[],
  spine: CorridorSpine,
): PortalGraph {
  const nodes: PortalNode[] = [];
  const edges: PortalEdge[] = [];

  for (const room of rooms) {
    const c = roomCentroid(room);
    nodes.push({
      id: `c:${room.id}`,
      kind: 'centroid',
      position: c,
      roomIds: [room.id],
    });
  }

  for (const door of doors) {
    if (door.roomBId === '__EXTERIOR__') {
      nodes.push({
        id: `door:${door.id}`,
        kind: 'door',
        position: door.position,
        roomIds: [door.roomAId],
      });
      edges.push({
        a: `door:${door.id}`,
        b: `c:${door.roomAId}`,
        length: dist(door.position, roomCentroid(rooms.find(r => r.id === door.roomAId)!)),
        roomId: door.roomAId,
      });
      continue;
    }

    nodes.push({
      id: `door:${door.id}`,
      kind: 'door',
      position: door.position,
      roomIds: [door.roomAId, door.roomBId],
    });

    for (const rid of [door.roomAId, door.roomBId]) {
      const room = rooms.find(r => r.id === rid);
      if (!room) continue;
      const c = roomCentroid(room);
      const waypoint = interiorWaypoint(c, door.position, room);
      const wpId = `wp:${door.id}:${rid}`;
      nodes.push({
        id: wpId,
        kind: 'centroid',
        position: waypoint,
        roomIds: [rid],
      });
      edges.push({
        a: `c:${rid}`,
        b: wpId,
        length: dist(c, waypoint),
        roomId: rid,
      });
      edges.push({
        a: wpId,
        b: `door:${door.id}`,
        length: dist(waypoint, door.position),
        roomId: rid,
      });
    }
  }

  // Corridor centreline nodes for smoother routing
  for (let i = 0; i < spine.centreline.length; i++) {
    const p = spine.centreline[i];
    const corr = rooms.find(r => r.category === 'CORRIDOR');
    if (!corr) break;
    nodes.push({
      id: `cl:${i}`,
      kind: 'centreline',
      position: p,
      roomIds: [corr.id],
    });
    if (i > 0) {
      edges.push({
        a: `cl:${i - 1}`,
        b: `cl:${i}`,
        length: dist(spine.centreline[i - 1], p),
        roomId: corr.id,
      });
    }
    edges.push({
      a: `cl:${i}`,
      b: `c:${corr.id}`,
      length: dist(p, roomCentroid(corr)),
      roomId: corr.id,
    });
  }

  return { nodes, edges };
}

/** A* shortest path between two portal nodes. */
export function astar(
  graph: PortalGraph,
  startId: string,
  goalId: string,
): Vec2[] | null {
  const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));
  if (!nodeMap.has(startId) || !nodeMap.has(goalId)) return null;

  const adj = new Map<string, Array<{ to: string; cost: number }>>();
  for (const n of graph.nodes) adj.set(n.id, []);
  for (const e of graph.edges) {
    adj.get(e.a)?.push({ to: e.b, cost: e.length });
    adj.get(e.b)?.push({ to: e.a, cost: e.length });
  }

  const open = new Set<string>([startId]);
  const came = new Map<string, string>();
  const g = new Map<string, number>([[startId, 0]]);
  const f = new Map<string, number>([
    [startId, dist(nodeMap.get(startId)!.position, nodeMap.get(goalId)!.position)],
  ]);

  while (open.size > 0) {
    let current = '';
    let best = Infinity;
    for (const id of open) {
      const score = f.get(id) ?? Infinity;
      if (score < best) {
        best = score;
        current = id;
      }
    }
    if (current === goalId) {
      return reconstruct(came, nodeMap, current);
    }
    open.delete(current);
    for (const { to, cost } of adj.get(current) ?? []) {
      const tentative = (g.get(current) ?? Infinity) + cost;
      if (tentative < (g.get(to) ?? Infinity)) {
        came.set(to, current);
        g.set(to, tentative);
        f.set(
          to,
          tentative + dist(nodeMap.get(to)!.position, nodeMap.get(goalId)!.position),
        );
        open.add(to);
      }
    }
  }
  return null;
}

export function buildRoutes(
  rooms: RoomRect[],
  doors: Door[],
  portalGraph: PortalGraph,
): RoutePolyline[] {
  const routes: RoutePolyline[] = [];
  const internalDoors = doors.filter(d => d.roomBId !== '__EXTERIOR__');

  for (const door of internalDoors) {
    const path = [
      roomCentroid(rooms.find(r => r.id === door.roomAId)!),
      interiorWaypoint(
        roomCentroid(rooms.find(r => r.id === door.roomAId)!),
        door.position,
        rooms.find(r => r.id === door.roomAId)!,
      ),
      door.position,
      interiorWaypoint(
        roomCentroid(rooms.find(r => r.id === door.roomBId)!),
        door.position,
        rooms.find(r => r.id === door.roomBId)!,
      ),
      roomCentroid(rooms.find(r => r.id === door.roomBId)!),
    ];
    routes.push({ roomAId: door.roomAId, roomBId: door.roomBId, points: path });
  }

  // Entry → each room via A*
  const entry = rooms.find(r => r.category === 'ENTRY');
  const entranceDoor = doors.find(d => d.isEntrance);
  if (entry && entranceDoor) {
    for (const room of rooms) {
      if (room.id === entry.id) continue;
      const path = astar(portalGraph, `door:${entranceDoor.id}`, `c:${room.id}`);
      if (path) {
        routes.push({ roomAId: entry.id, roomBId: room.id, points: path });
      }
    }
  }

  return routes;
}

/** Verify route segments stay inside walkable rooms and only cross at doors. */
export function verifyRouteIntegrity(
  routes: RoutePolyline[],
  rooms: RoomRect[],
  doors: Door[],
): string[] {
  const errors: string[] = [];
  for (const route of routes) {
    for (let i = 0; i < route.points.length - 1; i++) {
      const a = route.points[i];
      const b = route.points[i + 1];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const inRoom = rooms.some(r => pointInRoom(mid, r));
      const nearDoor = doors.some(d => dist(mid, d.position) < d.width);
      if (!inRoom && !nearDoor) {
        errors.push(`Route ${route.roomAId}→${route.roomBId} leaves walkable geometry`);
        break;
      }
    }
  }
  return errors;
}

function interiorWaypoint(centroid: Vec2, door: Vec2, room: RoomRect): Vec2 {
  return {
    x: centroid.x * 0.65 + door.x * 0.35,
    y: centroid.y * 0.65 + door.y * 0.35,
  };
}

function reconstruct(
  came: Map<string, string>,
  nodes: Map<string, PortalNode>,
  current: string,
): Vec2[] {
  const pts: Vec2[] = [nodes.get(current)!.position];
  while (came.has(current)) {
    current = came.get(current)!;
    pts.push(nodes.get(current)!.position);
  }
  pts.reverse();
  return pts;
}

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pointInRoom(p: Vec2, r: RoomRect): boolean {
  const parts = r.parts ?? [{ x: r.x, y: r.y, w: r.w, h: r.h }];
  return parts.some(
    part =>
      p.x >= part.x - 0.05 &&
      p.x <= part.x + part.w + 0.05 &&
      p.y >= part.y - 0.05 &&
      p.y <= part.y + part.h + 0.05,
  );
}
