/**
 * Corridor demand model — decides whether dedicated circulation is required.
 */

import type { ContextProfile } from '../context/contextProfile.ts';
import type { MissionGraph } from '../topology/missionTypes.ts';
import { CORRIDOR_LESS_FAMILIES } from '../topology/missionTypes.ts';

export type CirculationDemand =
  | { kind: 'none'; reason: string }
  | { kind: 'private_threshold'; reason: string }
  | { kind: 'corridor'; reason: string };

export function resolveCirculationDemand(
  ctx: ContextProfile,
  graph: MissionGraph,
): CirculationDemand {
  const policy = ctx.circulation.corridorPolicy;

  if (policy === 'always') {
    return { kind: 'corridor', reason: 'User/strategy corridorPolicy=always' };
  }

  if (policy === 'never') {
    if (graph.nodes.some(n => n.type === 'CORRIDOR')) {
      return {
        kind: 'private_threshold',
        reason: 'corridorPolicy=never — demote corridor to private threshold',
      };
    }
    return { kind: 'none', reason: 'corridorPolicy=never' };
  }

  // ifNeeded
  if (CORRIDOR_LESS_FAMILIES.has(graph.family)) {
    if (graph.nodes.some(n => n.type === 'PRIVATE_THRESHOLD')) {
      return {
        kind: 'private_threshold',
        reason: `Family ${graph.family} uses private threshold / bath lobby only`,
      };
    }
    return {
      kind: 'none',
      reason: `Family ${graph.family} is living-integrated`,
    };
  }

  if (graph.nodes.some(n => n.type === 'CORRIDOR')) {
    return {
      kind: 'corridor',
      reason: `Family ${graph.family} includes corridor spine`,
    };
  }

  return {
    kind: 'private_threshold',
    reason: 'Default short private threshold',
  };
}
