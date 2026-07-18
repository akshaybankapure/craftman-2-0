/** Internal geometry & budgets stay in SI (metres / m²). Display can mix units. */

export type AreaUnitMode = 'm2' | 'sqft' | 'both';

export const M2_TO_SQFT = 10.76391041671;
export const M_TO_FT = 3.280839895;

export function m2ToSqft(m2: number): number {
  return m2 * M2_TO_SQFT;
}

export function sqftToM2(sqft: number): number {
  return sqft / M2_TO_SQFT;
}

export function mToFt(m: number): number {
  return m * M_TO_FT;
}

export function ftToM(ft: number): number {
  return ft / M_TO_FT;
}

export function formatArea(m2: number, mode: AreaUnitMode, digits = 0): string {
  const a = m2ToSqft(m2);
  if (mode === 'm2') return `${m2.toFixed(digits)} m²`;
  if (mode === 'sqft') return `${a.toFixed(digits)} sq.ft.`;
  return `${m2.toFixed(digits)} m² · ${a.toFixed(digits)} sq.ft.`;
}

export function formatLength(m: number, mode: AreaUnitMode, digits = 1): string {
  const ft = mToFt(m);
  if (mode === 'm2') return `${m.toFixed(digits)} m`;
  if (mode === 'sqft') return `${ft.toFixed(digits)} ft`;
  return `${m.toFixed(digits)} m · ${ft.toFixed(digits)} ft`;
}

export function formatOutline(wM: number, hM: number, mode: AreaUnitMode): string {
  if (mode === 'm2') return `${wM.toFixed(1)} × ${hM.toFixed(1)} m`;
  if (mode === 'sqft') return `${mToFt(wM).toFixed(1)} × ${mToFt(hM).toFixed(1)} ft`;
  return `${wM.toFixed(1)} × ${hM.toFixed(1)} m  (${mToFt(wM).toFixed(1)} × ${mToFt(hM).toFixed(1)} ft)`;
}

/** Compact labels for room stamps on the plan (limited space). */
export function formatAreaCompact(m2: number, mode: AreaUnitMode): string {
  if (mode === 'm2') return `${m2.toFixed(1)} m²`;
  if (mode === 'sqft') return `${m2ToSqft(m2).toFixed(0)} sq.ft.`;
  return `${m2.toFixed(1)} m² (${m2ToSqft(m2).toFixed(0)})`;
}

export function formatDimsCompact(wM: number, hM: number, mode: AreaUnitMode): string {
  if (mode === 'm2') return `${wM.toFixed(1)} × ${hM.toFixed(1)} m`;
  if (mode === 'sqft') return `${mToFt(wM).toFixed(1)} × ${mToFt(hM).toFixed(1)} ft`;
  return `${wM.toFixed(1)}×${hM.toFixed(1)} m · ${mToFt(wM).toFixed(0)}×${mToFt(hM).toFixed(0)} ft`;
}

export function unitModeLabel(mode: AreaUnitMode): string {
  if (mode === 'm2') return 'm² / m';
  if (mode === 'sqft') return 'sq.ft. / ft';
  return 'm² + sq.ft.';
}

export const AREA_UNIT_OPTIONS: { id: AreaUnitMode; label: string }[] = [
  { id: 'm2', label: 'm²' },
  { id: 'sqft', label: 'sq.ft.' },
  { id: 'both', label: 'Both' },
];
