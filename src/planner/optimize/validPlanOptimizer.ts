import { roomArea } from '../types.ts';
import type { AreaBudget, EntranceDirection, FloorPlan, RoomRect } from '../types.ts';
import { validateCompletePlan } from '../validate/validateFloorPlan.ts';
import { computeSharedWalls } from '../geometry/sharedWalls.ts';
import { placeDoors } from '../doors/placeDoors.ts';
import { buildPortalGraph, buildRoutes } from '../graph/portalGraph.ts';
import { RNG } from '../rng.ts';
import { budgetFor } from '../budget/areaBudget.ts';
import { DEFAULT_DESIGN_PREFS, isDaylightCategory, type DesignPrefs } from './designPrefs.ts';
import { scoresForPriority, type MetricKey } from './metrics.ts';
import { planShapeComplexity, roomShapeMetrics } from '../geometry/roomShape.ts';

/**
 * Lexicographic scores (lower better). P1 validity is gated before calling this.
 * Soft terms are parameterized by DesignPrefs when provided.
 */
export function lexicoScores(plan: FloorPlan, prefs: DesignPrefs = DEFAULT_DESIGN_PREFS): number[] {
  const rooms = plan.rooms;
  const budgets = plan.budgets;
  let areaErr = 0;
  for (const r of rooms) {
    const b = budgetFor(budgets, r.id);
    areaErr += Math.abs(roomArea(r) - b.targetArea) / Math.max(1, b.targetArea);
  }
  areaErr /= Math.max(1, rooms.length);

  const daylight = daylightScore(plan, prefs);
  const privacy = privacyGradientError(plan, prefs);
  const corridorEff = corridorScore(plan, prefs);
  const wet = wetClusterScore(rooms);
  const shape = shapePenalty(rooms, prefs);
  const balance = centroidBalance(rooms, plan.outlineW, plan.outlineH);

  return [areaErr, daylight, privacy, corridorEff, wet, shape, balance];
}

/** Recompute soft scores with current design preferences. */
export function rescorePlan(plan: FloorPlan, prefs: DesignPrefs = DEFAULT_DESIGN_PREFS): FloorPlan {
  const next = clonePlan(plan);
  next.scores = scorePack(next, prefs);
  return next;
}

export function compareLexico(a: number[], b: number[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const da = a[i] ?? 0;
    const db = b[i] ?? 0;
    if (Math.abs(da - db) > 1e-6) return da - db;
  }
  return 0;
}

/**
 * Simulated annealing over valid geometry transforms only.
 * Rejects immediately if validation fails after mutation.
 * When `priority` / `weights` are given (from the resolved strategy),
 * acceptance uses the same weighted lexicographic order as ranking, so
 * generation genuinely optimises what the strategy says matters.
 */
export function optimizeValidPlan(
  plan: FloorPlan,
  iterations = 80,
  prefs: DesignPrefs = DEFAULT_DESIGN_PREFS,
  priority?: MetricKey[],
  weights?: Record<MetricKey, number>,
): FloorPlan {
  if (!plan.validation.valid) return plan;
  const order = priority?.length ? priority : undefined;
  const cmp = (a: number[], b: number[]) =>
    order || weights
      ? compareLexico(scoresForPriority(a, order ?? [], weights), scoresForPriority(b, order ?? [], weights))
      : compareLexico(a, b);
  const rng = new RNG(plan.seed ^ 0x9e3779b9);
  let current = clonePlan(plan);
  current.scores = { ...scorePack(current, prefs) };
  let best = clonePlan(current);

  let T = 1.0;
  for (let i = 0; i < iterations; i++) {
    const candidate = mutate(clonePlan(current), rng);
    rebuildDerived(candidate);
    const v = validateCompletePlan(candidate);
    candidate.validation = v;
    if (!v.valid) {
      T *= 0.97;
      continue;
    }
    candidate.scores = scorePack(candidate, prefs);
    const d = cmp(candidate.scores.lexico, current.scores!.lexico);
    if (d < 0 || rng.next() < Math.exp(-d / Math.max(1e-6, T))) {
      current = candidate;
      if (cmp(current.scores!.lexico, best.scores!.lexico) < 0) {
        best = clonePlan(current);
      }
    }
    T *= 0.97;
  }
  return best;
}

function scorePack(plan: FloorPlan, prefs: DesignPrefs = DEFAULT_DESIGN_PREFS) {
  const lex = lexicoScores(plan, prefs);
  return {
    areaError: lex[0],
    daylight: lex[1],
    privacy: lex[2],
    corridorEfficiency: lex[3],
    wetClustering: lex[4],
    shapeQuality: lex[5],
    lexico: lex,
  };
}

function mutate(plan: FloorPlan, rng: RNG): FloorPlan {
  const move = rng.int(0, 3);
  if (move === 0) return swapRooms(plan, rng);
  if (move === 1) return shiftSharedWall(plan, rng);
  return expandContract(plan, rng);
}

function swapRooms(plan: FloorPlan, rng: RNG): FloorPlan {
  const swappable = plan.rooms.filter(
    r => r.category === 'BEDROOM' || r.category === 'COMMON_BATHROOM' || r.category === 'KITCHEN',
  );
  if (swappable.length < 2) return plan;
  const a = rng.pick(swappable);
  const b = rng.pick(swappable.filter(x => x.id !== a.id));
  if (!b) return plan;
  // Swap geometry only for same-ish categories or bedrooms
  if (a.category !== b.category && !(a.category === 'BEDROOM' && b.category === 'BEDROOM')) {
    if (!(a.category === 'BEDROOM' || b.category === 'BEDROOM')) return plan;
  }
  const tmp = { x: a.x, y: a.y, w: a.w, h: a.h };
  a.x = b.x; a.y = b.y; a.w = b.w; a.h = b.h;
  b.x = tmp.x; b.y = tmp.y; b.w = tmp.w; b.h = tmp.h;
  return plan;
}

/** Game-theoretic wall shift: accept if both rooms stay above mins and social welfare improves. */
function shiftSharedWall(plan: FloorPlan, rng: RNG): FloorPlan {
  if (plan.sharedWalls.length === 0) return plan;
  const wall = rng.pick(plan.sharedWalls);
  const a = plan.rooms.find(r => r.id === wall.roomAId);
  const b = plan.rooms.find(r => r.id === wall.roomBId);
  if (!a || !b) return plan;
  if (a.category === 'CORRIDOR' || b.category === 'CORRIDOR') return plan;
  if (a.category === 'ENTRY' || b.category === 'ENTRY') return plan;

  const delta = (rng.next() - 0.5) * 0.4;
  const beforeA = utility(a, plan.budgets);
  const beforeB = utility(b, plan.budgets);

  if (wall.axis === 'vertical') {
    // Move vertical wall: adjust widths
    a.w += delta;
    b.x += delta;
    b.w -= delta;
  } else {
    a.h += delta;
    b.y += delta;
    b.h -= delta;
  }

  const ba = budgetFor(plan.budgets, a.id);
  const bb = budgetFor(plan.budgets, b.id);
  if (a.w < ba.minWidth || a.h < ba.minHeight || b.w < bb.minWidth || b.h < bb.minHeight) {
    // revert
    if (wall.axis === 'vertical') {
      a.w -= delta; b.x -= delta; b.w += delta;
    } else {
      a.h -= delta; b.y -= delta; b.h += delta;
    }
    return plan;
  }

  const afterA = utility(a, plan.budgets);
  const afterB = utility(b, plan.budgets);
  const social = (afterA - beforeA) + (afterB - beforeB);
  if (social < -0.05) {
    if (wall.axis === 'vertical') {
      a.w -= delta; b.x -= delta; b.w += delta;
    } else {
      a.h -= delta; b.y -= delta; b.h += delta;
    }
  }
  return plan;
}

function expandContract(plan: FloorPlan, rng: RNG): FloorPlan {
  const living = plan.rooms.find(r => r.category === 'LIVING');
  const kit = plan.rooms.find(r => r.category === 'KITCHEN');
  if (!living || !kit) return plan;
  const delta = (rng.next() - 0.5) * 0.3;
  // Grow living into kitchen along shared side if aligned
  if (Math.abs(living.x + living.w - kit.x) < 0.1 || Math.abs(kit.x + kit.w - living.x) < 0.1) {
    living.w += delta;
    kit.w -= delta;
    if (kit.x > living.x) kit.x += delta;
  } else if (Math.abs(living.y + living.h - kit.y) < 0.1 || Math.abs(kit.y + kit.h - living.y) < 0.1) {
    living.h += delta;
    kit.h -= delta;
    if (kit.y > living.y) kit.y += delta;
  }
  const bk = budgetFor(plan.budgets, kit.id);
  if (kit.w < bk.minWidth || kit.h < bk.minHeight) {
    // skip — rebuild will catch invalid
  }
  return plan;
}

function utility(room: RoomRect, budgets: AreaBudget[]): number {
  const b = budgetFor(budgets, room.id);
  const area = roomArea(room);
  const areaU = 1 - Math.abs(area - b.targetArea) / Math.max(1, b.targetArea);
  const aspect = room.w / Math.max(0.1, room.h);
  const aspectU = 1 - Math.abs(aspect - b.preferredAspectRatio) / 2;
  return Math.max(0, areaU) + Math.max(0, aspectU) * 0.3;
}

function rebuildDerived(plan: FloorPlan): void {
  plan.sharedWalls = computeSharedWalls(plan.rooms);
  const placed = placeDoors(
    plan.topology,
    plan.rooms,
    plan.sharedWalls,
    plan.entrance.direction,
    plan.outlineW,
    plan.outlineH,
  );
  plan.doors = placed.doors;
  plan.entrance = placed.entrance;
  plan.portalGraph = buildPortalGraph(plan.rooms, plan.doors, plan.spine);
  plan.routes = buildRoutes(plan.rooms, plan.doors, plan.portalGraph);
}

function clonePlan(plan: FloorPlan): FloorPlan {
  return {
    ...plan,
    rooms: plan.rooms.map(r => ({ ...r, parts: r.parts?.map(p => ({ ...p })) })),
    furniture: plan.furniture?.map(f => ({ ...f })),
    sharedWalls: [...plan.sharedWalls],
    doors: plan.doors.map(d => ({ ...d })),
    routes: plan.routes.map(r => ({ ...r, points: r.points.map(p => ({ ...p })) })),
    budgets: plan.budgets.map(b => ({ ...b })),
    topology: {
      ...plan.topology,
      nodes: plan.topology.nodes.map(n => ({ ...n })),
      edges: plan.topology.edges.map(e => ({ ...e })),
    },
    spine: {
      ...plan.spine,
      centreline: plan.spine.centreline.map(p => ({ ...p })),
      polygons: plan.spine.polygons.map(p => ({ ...p })),
    },
    entrance: {
      ...plan.entrance,
      door: { ...plan.entrance.door },
      exteriorEdge: {
        start: { ...plan.entrance.exteriorEdge.start },
        end: { ...plan.entrance.exteriorEdge.end },
      },
    },
    portalGraph: {
      nodes: plan.portalGraph.nodes.map(n => ({ ...n, position: { ...n.position }, roomIds: [...n.roomIds] })),
      edges: plan.portalGraph.edges.map(e => ({ ...e })),
    },
    validation: {
      ...plan.validation,
      errors: [...plan.validation.errors],
      warnings: [...plan.validation.warnings],
      metrics: { ...plan.validation.metrics },
    },
    scores: plan.scores ? { ...plan.scores, lexico: [...plan.scores.lexico] } : undefined,
    debug: plan.debug ? { ...plan.debug } : undefined,
  };
}

function daylightScore(plan: FloorPlan, prefs: DesignPrefs): number {
  const targets = plan.rooms.filter(r => isDaylightCategory(r.category, prefs));
  if (targets.length === 0) return 0;
  let err = 0;
  for (const r of targets) {
    const faces = exteriorFaces(r, plan.outlineW, plan.outlineH);
    if (faces.length === 0) {
      err += 1;
      continue;
    }
    // Preferred façades: missing them costs extra; wrong-only exterior still partial credit
    if (prefs.daylightFacades.length > 0) {
      const hit = faces.some(f => prefs.daylightFacades.includes(f));
      err += hit ? 0 : 0.45;
    }
  }
  return err / targets.length;
}

function exteriorFaces(
  r: RoomRect,
  W: number,
  H: number,
  eps = 0.15,
): EntranceDirection[] {
  // Planner coords: entrance S sits at high Y (see embedRooms placeEntryFoyerNS).
  const faces: EntranceDirection[] = [];
  if (r.y < eps) faces.push('N');
  if (r.y + r.h > H - eps) faces.push('S');
  if (r.x < eps) faces.push('W');
  if (r.x + r.w > W - eps) faces.push('E');
  return faces;
}

function corridorScore(plan: FloorPlan, prefs: DesignPrefs): number {
  const ratio = plan.validation.metrics.corridorAreaRatio;
  const target = Math.max(0.04, prefs.maxCorridorRatio);
  // Soft hinge: below target is fine; above grows linearly
  return Math.max(0, ratio - target) / Math.max(0.05, target);
}

function privacyGradientError(plan: FloorPlan, prefs: DesignPrefs): number {
  const entry = plan.rooms.find(r => r.category === 'ENTRY');
  const living = plan.rooms.find(r => r.category === 'LIVING');
  if (!entry || !living) return 0;
  const ec = { x: entry.x + entry.w / 2, y: entry.y + entry.h / 2 };
  const lc = { x: living.x + living.w / 2, y: living.y + living.h / 2 };
  const livingDist = Math.hypot(lc.x - ec.x, lc.y - ec.y);
  const depths = prefs.minDepthByCategory ? graphDepths(plan) : null;
  let err = 0;
  let n = 0;
  for (const r of plan.rooms) {
    if (r.category !== 'BEDROOM') continue;
    const c = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    const d = Math.hypot(c.x - ec.x, c.y - ec.y);
    if (d < livingDist - 0.5) err += 1;
    if (prefs.privacyOppositeEntry) {
      // Extra penalty if bedroom hugs the entrance façade
      const onEntryFace = touchesEntranceFacade(r, plan.entrance.direction, plan.outlineW, plan.outlineH);
      if (onEntryFace) err += 0.5;
    }
    // Access-graph depth: bedrooms shallower than the strategy requires
    // are penalised even when geometrically far from the entrance.
    if (depths) {
      const want = prefs.minDepthByCategory?.[r.category];
      const have = depths.get(r.id) ?? Infinity;
      if (want !== undefined && have < want) err += 0.4 * (want - have);
    }
    n++;
  }
  return n > 0 ? err / n : 0;
}

/** BFS depth from ENTRY over the access tree. */
function graphDepths(plan: FloorPlan): Map<string, number> {
  const children = new Map<string, string[]>();
  for (const e of plan.topology.edges) {
    if (!children.has(e.parentId)) children.set(e.parentId, []);
    children.get(e.parentId)!.push(e.childId);
  }
  const depths = new Map<string, number>();
  const queue: Array<{ id: string; depth: number }> = [{ id: plan.topology.rootId, depth: 0 }];
  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (depths.has(id)) continue;
    depths.set(id, depth);
    for (const c of children.get(id) ?? []) queue.push({ id: c, depth: depth + 1 });
  }
  return depths;
}

function touchesEntranceFacade(
  r: RoomRect,
  dir: EntranceDirection,
  W: number,
  H: number,
  eps = 0.2,
): boolean {
  switch (dir) {
    case 'S': return r.y + r.h > H - eps;
    case 'N': return r.y < eps;
    case 'E': return r.x + r.w > W - eps;
    case 'W': return r.x < eps;
  }
}

function wetClusterScore(rooms: RoomRect[]): number {
  const wet = rooms.filter(
    r =>
      r.category === 'KITCHEN' ||
      r.category === 'COMMON_BATHROOM' ||
      r.category === 'ENSUITE_BATHROOM' ||
      r.category === 'UTILITY',
  );
  if (wet.length < 2) return 0;
  const cx = wet.reduce((s, r) => s + r.x + r.w / 2, 0) / wet.length;
  const cy = wet.reduce((s, r) => s + r.y + r.h / 2, 0) / wet.length;
  const varSum = wet.reduce(
    (s, r) => s + (r.x + r.w / 2 - cx) ** 2 + (r.y + r.h / 2 - cy) ** 2,
    0,
  );
  return varSum / wet.length / 100;
}

/**
 * Room-shape penalty using per-category aspect limits from the strategy.
 * Corridors / entries / foyers are excluded — circulation spaces are judged
 * on width, travel distance and wasted area, not room aspect rules.
 */
function shapePenalty(rooms: RoomRect[], prefs: DesignPrefs): number {
  const fallback = Math.max(1.5, prefs.maxAspectRatio);
  let aspectPen = 0;
  let n = 0;
  for (const r of rooms) {
    if (r.category === 'CORRIDOR' || r.category === 'ENTRY' || r.category === 'FOYER') continue;
    n++;
    const limit = Math.max(1.2, prefs.maxAspectRatioByCategory?.[r.category] ?? fallback);
    const aspect = Math.max(r.w / r.h, r.h / r.w);
    if (aspect > limit) aspectPen += aspect - limit;
    // Fold in spatial-engine complexity (reflex corners, fill, short edges).
    const shape = roomShapeMetrics(r);
    aspectPen += shape.complexityScore / 20;
  }
  const meanAspect = aspectPen / Math.max(1, n);
  // Blend with whole-plan complexity so L-shaped halls aren't over-penalised alone.
  return meanAspect * 0.7 + planShapeComplexity(rooms) * 0.3;
}

function centroidBalance(rooms: RoomRect[], W: number, H: number): number {
  const cx = rooms.reduce((s, r) => s + r.x + r.w / 2, 0) / rooms.length;
  const cy = rooms.reduce((s, r) => s + r.y + r.h / 2, 0) / rooms.length;
  return Math.hypot(cx - W / 2, cy - H / 2) / Math.hypot(W, H);
}
