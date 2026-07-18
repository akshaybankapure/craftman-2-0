import type { FloorPlan } from '../types.ts';
import { compareLexico, lexicoScores } from './validPlanOptimizer.ts';

/** Soft ranking metrics (lower = better). Hard validation is separate. */
export type MetricKey =
  | 'areaError'
  | 'daylight'
  | 'privacy'
  | 'corridorEfficiency'
  | 'wetClustering'
  | 'shapeQuality'
  | 'balance';

export interface MetricDef {
  key: MetricKey;
  /** Index in lexicoScores() vector */
  index: number;
  label: string;
  short: string;
  hint: string;
}

export const METRIC_DEFS: MetricDef[] = [
  { key: 'areaError', index: 0, label: 'Area fit', short: 'Area', hint: 'Rooms match target sizes' },
  { key: 'daylight', index: 1, label: 'Daylight', short: 'Light', hint: 'Habitable rooms on exterior' },
  { key: 'privacy', index: 2, label: 'Privacy', short: 'Privacy', hint: 'Bedrooms away from entry' },
  { key: 'corridorEfficiency', index: 3, label: 'Circulation', short: 'Circ.', hint: 'Compact corridor footprint' },
  { key: 'wetClustering', index: 4, label: 'Wet cluster', short: 'Wet', hint: 'Baths & kitchen grouped' },
  { key: 'shapeQuality', index: 5, label: 'Room shape', short: 'Shape', hint: 'Avoid elongated rooms' },
  { key: 'balance', index: 6, label: 'Balance', short: 'Balance', hint: 'Mass centered in outline' },
];

export const DEFAULT_METRIC_ORDER: MetricKey[] = METRIC_DEFS.map(m => m.key);

export type RankingPresetId = 'balanced' | 'daylight' | 'privacy' | 'compact' | 'area';

export interface RankingPreset {
  id: RankingPresetId;
  label: string;
  hint: string;
  /** Lexicographic priority — first key wins ties */
  order: MetricKey[];
}

export const RANKING_PRESETS: RankingPreset[] = [
  {
    id: 'balanced',
    label: 'Balanced',
    hint: 'Default multi-objective order',
    order: DEFAULT_METRIC_ORDER,
  },
  {
    id: 'daylight',
    label: 'Daylight',
    hint: 'Prioritize exterior exposure',
    order: ['daylight', 'areaError', 'privacy', 'shapeQuality', 'corridorEfficiency', 'wetClustering', 'balance'],
  },
  {
    id: 'privacy',
    label: 'Privacy',
    hint: 'Quiet bedrooms first',
    order: ['privacy', 'daylight', 'areaError', 'corridorEfficiency', 'wetClustering', 'shapeQuality', 'balance'],
  },
  {
    id: 'compact',
    label: 'Compact',
    hint: 'Minimize corridor area',
    order: ['corridorEfficiency', 'wetClustering', 'areaError', 'shapeQuality', 'privacy', 'daylight', 'balance'],
  },
  {
    id: 'area',
    label: 'Area fit',
    hint: 'Match programme areas',
    order: ['areaError', 'shapeQuality', 'daylight', 'privacy', 'corridorEfficiency', 'wetClustering', 'balance'],
  },
];

export function metricDef(key: MetricKey): MetricDef {
  return METRIC_DEFS.find(m => m.key === key) ?? METRIC_DEFS[0];
}

export function metricIndex(key: MetricKey): number {
  return metricDef(key).index;
}

/** Reorder a full lexico vector so `priority` keys come first. */
export function scoresForPriority(lexico: number[], priority: MetricKey[]): number[] {
  const order = priority.length > 0 ? priority : DEFAULT_METRIC_ORDER;
  const used = new Set(order.map(metricIndex));
  const head = order.map(k => lexico[metricIndex(k)] ?? 0);
  const tail: number[] = [];
  for (let i = 0; i < lexico.length; i++) {
    if (!used.has(i)) tail.push(lexico[i] ?? 0);
  }
  return [...head, ...tail];
}

export function planPriorityScores(plan: FloorPlan, priority: MetricKey[]): number[] {
  const lex = plan.scores?.lexico ?? lexicoScores(plan);
  return scoresForPriority(lex, priority);
}

export function compareByPriority(
  a: FloorPlan,
  b: FloorPlan,
  priority: MetricKey[],
): number {
  return compareLexico(planPriorityScores(a, priority), planPriorityScores(b, priority));
}

export function sortPlansByPriority(plans: FloorPlan[], priority: MetricKey[]): FloorPlan[] {
  return [...plans].sort((a, b) => compareByPriority(a, b, priority));
}

/** Human-readable score (0–100 quality; higher better for display). */
export function metricQualityPercent(key: MetricKey, raw: number): number {
  // Raw scores are lower-better penalties in ~0–1+ range
  const clamped = Math.max(0, Math.min(1.5, raw));
  return Math.round((1 - clamped / 1.5) * 100);
}

export function formatMetricRaw(key: MetricKey, raw: number): string {
  if (key === 'areaError' || key === 'corridorEfficiency') {
    return `${(raw * 100).toFixed(0)}%`;
  }
  return raw.toFixed(2);
}

export function getMetricRaw(plan: FloorPlan, key: MetricKey): number {
  const lex = plan.scores?.lexico ?? lexicoScores(plan);
  return lex[metricIndex(key)] ?? 0;
}
