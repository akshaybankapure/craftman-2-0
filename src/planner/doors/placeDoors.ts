import { findSharedWall } from '../geometry/sharedWalls.ts';
import type {
  AccessTree,
  Door,
  DoorConfig,
  EntranceDirection,
  FloorPlanEntrance,
  RoomRect,
  SharedWall,
  Vec2,
} from '../types.ts';
import { DEFAULT_DOOR_CONFIG, isBathroomCategory } from '../types.ts';

export function placeDoors(
  tree: AccessTree,
  rooms: RoomRect[],
  sharedWalls: SharedWall[],
  entranceDir: EntranceDirection,
  outlineW: number,
  outlineH: number,
  config: DoorConfig = DEFAULT_DOOR_CONFIG,
): { doors: Door[]; entrance: FloorPlanEntrance; missingEdges: Array<{ parentId: string; childId: string }> } {
  const doors: Door[] = [];
  const missingEdges: Array<{ parentId: string; childId: string }> = [];
  let doorSeq = 0;

  for (const edge of tree.edges) {
    const wall = findSharedWall(sharedWalls, edge.parentId, edge.childId);
    if (!wall || wall.validDoorIntervals.length === 0) {
      missingEdges.push({ parentId: edge.parentId, childId: edge.childId });
      continue;
    }
    const door = doorOnWall(wall, edge.parentId, edge.childId, rooms, config, `d${doorSeq++}`);
    if (!door) {
      missingEdges.push({ parentId: edge.parentId, childId: edge.childId });
      continue;
    }
    doors.push(door);
  }

  const entryRoom = rooms.find(r => r.category === 'ENTRY');
  if (!entryRoom) {
    throw new Error('No ENTRY room');
  }
  const entranceDoor = placeEntranceDoor(entryRoom, entranceDir, outlineW, outlineH, config, `d${doorSeq++}`);
  doors.push(entranceDoor);

  const entrance: FloorPlanEntrance = {
    direction: entranceDir,
    exteriorEdge: { start: entranceDoor.wallStart, end: entranceDoor.wallEnd },
    door: entranceDoor,
  };

  return { doors, entrance, missingEdges };
}

function doorOnWall(
  wall: SharedWall,
  parentId: string,
  childId: string,
  rooms: RoomRect[],
  config: DoorConfig,
  id: string,
): Door | null {
  const interval = wall.validDoorIntervals[0];
  if (!interval) return null;
  const mid = (interval.start + interval.end) / 2;
  const half = config.doorWidth / 2;
  if (mid - half < interval.start || mid + half > interval.end) return null;

  let position: Vec2;
  let wallStart: Vec2;
  let wallEnd: Vec2;
  if (wall.axis === 'vertical') {
    position = { x: wall.start.x, y: mid };
    wallStart = { x: wall.start.x, y: mid - half };
    wallEnd = { x: wall.start.x, y: mid + half };
  } else {
    position = { x: mid, y: wall.start.y };
    wallStart = { x: mid - half, y: wall.start.y };
    wallEnd = { x: mid + half, y: wall.start.y };
  }

  const child = rooms.find(r => r.id === childId)!;
  const swingInto = isBathroomCategory(child.category) ? childId : parentId;

  return {
    id,
    roomAId: wall.roomAId,
    roomBId: wall.roomBId,
    wallStart,
    wallEnd,
    position,
    width: config.doorWidth,
    orientation: wall.axis,
    hingeSide: 'left',
    swingIntoRoomId: swingInto,
  };
}

function placeEntranceDoor(
  entry: RoomRect,
  dir: EntranceDirection,
  outlineW: number,
  outlineH: number,
  config: DoorConfig,
  id: string,
): Door {
  const half = config.doorWidth / 2;
  let position: Vec2;
  let wallStart: Vec2;
  let wallEnd: Vec2;
  let orientation: 'horizontal' | 'vertical';

  switch (dir) {
    case 'S': {
      const x = entry.x + entry.w / 2;
      const y = outlineH;
      position = { x, y };
      wallStart = { x: x - half, y };
      wallEnd = { x: x + half, y };
      orientation = 'horizontal';
      break;
    }
    case 'N': {
      const x = entry.x + entry.w / 2;
      const y = 0;
      position = { x, y };
      wallStart = { x: x - half, y };
      wallEnd = { x: x + half, y };
      orientation = 'horizontal';
      break;
    }
    case 'W': {
      const x = 0;
      const y = entry.y + entry.h / 2;
      position = { x, y };
      wallStart = { x, y: y - half };
      wallEnd = { x, y: y + half };
      orientation = 'vertical';
      break;
    }
    case 'E': {
      const x = outlineW;
      const y = entry.y + entry.h / 2;
      position = { x, y };
      wallStart = { x, y: y - half };
      wallEnd = { x, y: y + half };
      orientation = 'vertical';
      break;
    }
  }

  return {
    id,
    roomAId: entry.id,
    roomBId: '__EXTERIOR__',
    wallStart,
    wallEnd,
    position,
    width: config.doorWidth,
    orientation,
    hingeSide: 'right',
    swingIntoRoomId: entry.id,
    isEntrance: true,
  };
}

/** Attempt local repair: expand room toward parent along shared axis. */
export function repairMissingAdjacency(
  rooms: RoomRect[],
  parentId: string,
  childId: string,
  minOverlap: number,
): boolean {
  const parent = rooms.find(r => r.id === parentId);
  const child = rooms.find(r => r.id === childId);
  if (!parent || !child) return false;

  // Try shifting child to touch parent
  const eps = 0.05;
  const attempts: Array<() => void> = [
    () => { child.x = parent.x + parent.w; },
    () => { child.x = parent.x - child.w; },
    () => { child.y = parent.y + parent.h; },
    () => { child.y = parent.y - child.h; },
  ];

  const ox = child.x;
  const oy = child.y;
  for (const attempt of attempts) {
    child.x = ox;
    child.y = oy;
    attempt();
    // Align overlap
    if (Math.abs(child.x - (parent.x + parent.w)) < eps || Math.abs(parent.x - (child.x + child.w)) < eps) {
      const overlap = Math.min(parent.y + parent.h, child.y + child.h) - Math.max(parent.y, child.y);
      if (overlap < minOverlap) {
        child.y = parent.y;
        child.h = Math.max(child.h, minOverlap);
      }
      return true;
    }
    if (Math.abs(child.y - (parent.y + parent.h)) < eps || Math.abs(parent.y - (child.y + child.h)) < eps) {
      const overlap = Math.min(parent.x + parent.w, child.x + child.w) - Math.max(parent.x, child.x);
      if (overlap < minOverlap) {
        child.x = parent.x;
        child.w = Math.max(child.w, minOverlap);
      }
      return true;
    }
  }
  child.x = ox;
  child.y = oy;
  return false;
}
