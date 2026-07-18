/**
 * Mission-graph family generators.
 * Graphs are abstract access topologies — geometry comes later.
 */

import type { ContextProfile } from '../context/contextProfile.ts';
import { RNG } from '../kernel/rngStreams.ts';
import type {
  MissionEdge,
  MissionGraph,
  MissionGraphFamily,
  MissionNode,
  MissionNodeType,
} from './missionTypes.ts';
import { ALL_MISSION_FAMILIES, CORRIDOR_LESS_FAMILIES } from './missionTypes.ts';
import { validateMissionGraph } from './missionValidate.ts';

export interface MissionProgramme {
  bedrooms: number;
  bathrooms: number;
  hasUtility: boolean;
  hasBalcony: boolean;
  hasFoyer: boolean;
}

export function programmeFromContext(ctx: ContextProfile): MissionProgramme {
  return {
    bedrooms: Math.max(1, ctx.bhk),
    bathrooms: Math.max(1, ctx.bathrooms),
    hasUtility: ctx.hasUtility,
    hasBalcony: ctx.hasBalcony,
    hasFoyer: ctx.hasFoyer,
  };
}

class Builder {
  nodes: MissionNode[] = [];
  edges: MissionEdge[] = [];
  private seq = 0;

  node(type: MissionNodeType, label: string, privacyDepth: number, opts?: Partial<MissionNode>): MissionNode {
    const n: MissionNode = {
      id: `${type.toLowerCase()}_${this.seq++}`,
      type,
      required: opts?.required ?? true,
      privacyDepth,
      label,
      attachedTo: opts?.attachedTo,
      targetArea: opts?.targetArea,
    };
    this.nodes.push(n);
    return n;
  }

  link(
    from: MissionNode,
    to: MissionNode,
    relationship: MissionEdge['relationship'] = 'primary_access',
    required = true,
  ): void {
    this.edges.push({ from: from.id, to: to.id, relationship, required });
  }

  graph(family: MissionGraphFamily): MissionGraph {
    const hasDedicatedCirculation = this.nodes.some(
      n => n.type === 'CORRIDOR' || n.type === 'PRIVATE_THRESHOLD',
    );
    return {
      family,
      nodes: this.nodes,
      edges: this.edges,
      hasDedicatedCirculation,
    };
  }
}

function addBathrooms(
  b: Builder,
  bedrooms: MissionNode[],
  bathroomCount: number,
  parent: MissionNode,
): void {
  const ensuiteCount = Math.min(Math.max(0, bathroomCount - 1), bedrooms.length);
  const commonCount = Math.max(1, bathroomCount - ensuiteCount);

  for (let i = 0; i < ensuiteCount; i++) {
    const bed = bedrooms[i]!;
    const en = b.node('ENSUITE', `Ensuite ${i + 1}`, bed.privacyDepth + 1, {
      attachedTo: bed.id,
    });
    b.link(bed, en);
  }
  for (let i = 0; i < commonCount; i++) {
    const bath = b.node('COMMON_BATHROOM', `Bathroom ${i + 1}`, parent.privacyDepth);
    b.link(parent, bath);
  }
}

function addOptional(
  b: Builder,
  prog: MissionProgramme,
  living: MissionNode,
  kitchen: MissionNode,
  bedrooms: MissionNode[],
  rng: RNG,
): void {
  if (prog.hasUtility) {
    const util = b.node('UTILITY', 'Utility', kitchen.privacyDepth + 1);
    b.link(kitchen, util, 'service_adjacency');
  }
  if (prog.hasBalcony) {
    const bal = b.node('BALCONY', 'Balcony', living.privacyDepth, { required: false });
    const parent = rng.bool(0.65) ? living : bedrooms[0] ?? living;
    b.link(parent, bal, 'open_transition', false);
  }
}

/** Central living hub — corridor-less; bedrooms off living; bath off private threshold. */
function buildCentralLivingHub(prog: MissionProgramme, rng: RNG): MissionGraph {
  const b = new Builder();
  const entry = b.node('ENTRY', 'Entry', 0);
  const foyer = prog.hasFoyer ? b.node('FOYER', 'Foyer', 1) : null;
  const living = b.node('LIVING', 'Living', foyer ? 2 : 1);
  const kitchen = b.node('KITCHEN', 'Kitchen', living.privacyDepth);
  const threshold = b.node('PRIVATE_THRESHOLD', 'Private lobby', living.privacyDepth + 1);

  if (foyer) {
    b.link(entry, foyer);
    b.link(foyer, living);
  } else {
    b.link(entry, living);
  }
  b.link(living, kitchen);
  b.link(living, threshold);

  const bedrooms: MissionNode[] = [];
  for (let i = 0; i < prog.bedrooms; i++) {
    const bed = b.node('BEDROOM', `Bedroom ${i + 1}`, threshold.privacyDepth + 1);
    bedrooms.push(bed);
    // Mix: most off threshold; one may open to living for guest suite
    if (i === prog.bedrooms - 1 && prog.bedrooms >= 2 && rng.bool(0.4)) {
      b.link(living, bed);
    } else {
      b.link(threshold, bed);
    }
  }
  addBathrooms(b, bedrooms, prog.bathrooms, threshold);
  addOptional(b, prog, living, kitchen, bedrooms, rng);
  return b.graph('central_living_hub');
}

/** Living-integrated circulation — no corridor; bedrooms primarily off living. */
function buildLivingIntegrated(prog: MissionProgramme, rng: RNG): MissionGraph {
  const b = new Builder();
  const entry = b.node('ENTRY', 'Entry', 0);
  const living = b.node('LIVING', 'Living', 1);
  const kitchen = b.node('KITCHEN', 'Kitchen', 1);
  b.link(entry, living);
  b.link(living, kitchen);

  // Small threshold only for common bath privacy
  const threshold = b.node('PRIVATE_THRESHOLD', 'Bath lobby', 2);

  const bedrooms: MissionNode[] = [];
  for (let i = 0; i < prog.bedrooms; i++) {
    const bed = b.node('BEDROOM', `Bedroom ${i + 1}`, 2);
    bedrooms.push(bed);
    b.link(living, bed);
  }
  b.link(living, threshold);
  addBathrooms(b, bedrooms, prog.bathrooms, threshold);
  addOptional(b, prog, living, kitchen, bedrooms, rng);
  return b.graph('living_integrated_circulation');
}

/** Short private corridor spine. */
function buildShortPrivateCorridor(prog: MissionProgramme, rng: RNG): MissionGraph {
  const b = new Builder();
  const entry = b.node('ENTRY', 'Entry', 0);
  const foyer = prog.hasFoyer && rng.bool(0.5) ? b.node('FOYER', 'Foyer', 1) : null;
  const living = b.node('LIVING', 'Living', foyer ? 2 : 1);
  const kitchen = b.node('KITCHEN', 'Kitchen', living.privacyDepth);
  const corridor = b.node('CORRIDOR', 'Corridor', living.privacyDepth + 1);

  if (foyer) {
    b.link(entry, foyer);
    b.link(foyer, living);
  } else {
    b.link(entry, living);
  }
  b.link(living, kitchen);
  b.link(living, corridor);

  const bedrooms: MissionNode[] = [];
  for (let i = 0; i < prog.bedrooms; i++) {
    const bed = b.node('BEDROOM', `Bedroom ${i + 1}`, corridor.privacyDepth + 1);
    bedrooms.push(bed);
    b.link(corridor, bed);
  }
  addBathrooms(b, bedrooms, prog.bathrooms, corridor);
  addOptional(b, prog, living, kitchen, bedrooms, rng);
  return b.graph('short_private_corridor');
}

/** Split public/private spine with corridor after living. */
function buildSplitSpine(prog: MissionProgramme, rng: RNG): MissionGraph {
  const b = new Builder();
  const entry = b.node('ENTRY', 'Entry', 0);
  const hub = b.node('PUBLIC_HUB', 'Public hub', 1);
  const living = b.node('LIVING', 'Living', 1);
  const dining = b.node('DINING', 'Dining', 1, { required: false });
  const kitchen = b.node('KITCHEN', 'Kitchen', 1);
  const corridor = b.node('CORRIDOR', 'Private corridor', 2);

  b.link(entry, hub);
  b.link(hub, living);
  b.link(hub, dining, 'open_transition', false);
  b.link(hub, kitchen);
  b.link(hub, corridor);

  const bedrooms: MissionNode[] = [];
  for (let i = 0; i < prog.bedrooms; i++) {
    const bed = b.node('BEDROOM', `Bedroom ${i + 1}`, 3);
    bedrooms.push(bed);
    b.link(corridor, bed);
  }
  addBathrooms(b, bedrooms, prog.bathrooms, corridor);
  addOptional(b, prog, living, kitchen, bedrooms, rng);
  return b.graph('split_public_private_spine');
}

/** Corner entry — foyer distributes to living and private wing. */
function buildCornerEntry(prog: MissionProgramme, rng: RNG): MissionGraph {
  const b = new Builder();
  const entry = b.node('ENTRY', 'Entry', 0);
  const foyer = b.node('FOYER', 'Foyer', 1);
  const living = b.node('LIVING', 'Living', 2);
  const kitchen = b.node('KITCHEN', 'Kitchen', 2);
  const threshold = b.node('PRIVATE_THRESHOLD', 'Private lobby', 2);

  b.link(entry, foyer);
  b.link(foyer, living);
  b.link(foyer, threshold);
  b.link(living, kitchen);

  const bedrooms: MissionNode[] = [];
  for (let i = 0; i < prog.bedrooms; i++) {
    const bed = b.node('BEDROOM', `Bedroom ${i + 1}`, 3);
    bedrooms.push(bed);
    b.link(threshold, bed);
  }
  addBathrooms(b, bedrooms, prog.bathrooms, threshold);
  addOptional(b, prog, living, kitchen, bedrooms, rng);
  return b.graph('corner_entry_distribution');
}

/** Compact wet-core — kitchen/bath clustered; living hub for beds. */
function buildCompactWetCore(prog: MissionProgramme, rng: RNG): MissionGraph {
  const b = new Builder();
  const entry = b.node('ENTRY', 'Entry', 0);
  const living = b.node('LIVING', 'Living', 1);
  const kitchen = b.node('KITCHEN', 'Kitchen', 1);
  const threshold = b.node('PRIVATE_THRESHOLD', 'Wet lobby', 2);

  b.link(entry, living);
  b.link(living, kitchen);
  b.link(kitchen, threshold, 'service_adjacency'); // wet adjacency — primary access still living→threshold
  b.link(living, threshold);

  const bedrooms: MissionNode[] = [];
  for (let i = 0; i < prog.bedrooms; i++) {
    const bed = b.node('BEDROOM', `Bedroom ${i + 1}`, 2);
    bedrooms.push(bed);
    b.link(living, bed);
  }
  addBathrooms(b, bedrooms, prog.bathrooms, threshold);
  addOptional(b, prog, living, kitchen, bedrooms, rng);
  return b.graph('compact_wet_core');
}

const BUILDERS: Record<MissionGraphFamily, (p: MissionProgramme, rng: RNG) => MissionGraph> = {
  central_living_hub: buildCentralLivingHub,
  living_integrated_circulation: buildLivingIntegrated,
  short_private_corridor: buildShortPrivateCorridor,
  split_public_private_spine: buildSplitSpine,
  corner_entry_distribution: buildCornerEntry,
  compact_wet_core: buildCompactWetCore,
};

/** Families eligible given corridor policy.
 * Corridor spines are optional by default (ifNeeded): all families remain
 * eligible, but corridor-less ones are listed first so the bandit explores
 * living-integrated layouts before dedicated corridor rooms.
 */
export function eligibleFamilies(ctx: ContextProfile): MissionGraphFamily[] {
  const policy = ctx.circulation.corridorPolicy;
  const filtered = ALL_MISSION_FAMILIES.filter(f => {
    const less = CORRIDOR_LESS_FAMILIES.has(f);
    if (policy === 'always') return true;
    if (policy === 'never') return less;
    return true; // ifNeeded — corridor optional, not excluded
  });
  if (policy === 'ifNeeded' && ctx.circulation.preferLivingHub) {
    return [
      ...filtered.filter(f => CORRIDOR_LESS_FAMILIES.has(f)),
      ...filtered.filter(f => !CORRIDOR_LESS_FAMILIES.has(f)),
    ];
  }
  return filtered;
}

export function generateMissionGraph(
  family: MissionGraphFamily,
  ctx: ContextProfile,
  seed: number,
): MissionGraph {
  const rng = new RNG(seed);
  const prog = programmeFromContext(ctx);
  const graph = BUILDERS[family](prog, rng);
  const v = validateMissionGraph(graph);
  if (!v.valid) {
    throw new Error(`Invalid mission graph ${family}: ${v.errors.join('; ')}`);
  }
  return graph;
}

export function generateMissionGraphVariants(
  ctx: ContextProfile,
  rootSeed: number,
  maxPerFamily = 2,
): MissionGraph[] {
  const families = eligibleFamilies(ctx);
  const out: MissionGraph[] = [];
  let i = 0;
  for (const family of families) {
    for (let v = 0; v < maxPerFamily; v++) {
      try {
        const g = generateMissionGraph(family, ctx, rootSeed + i * 9973 + v * 131);
        out.push(g);
      } catch {
        // skip invalid variant
      }
      i++;
    }
  }
  return out;
}
