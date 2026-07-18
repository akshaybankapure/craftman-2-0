export const SQ_FT_TO_SQ_M = 0.09290304;
export const FT_TO_MM = 304.8;

export function sqFtToSqM(value: number): number {
  return value * SQ_FT_TO_SQ_M;
}

export function sqMToSqFt(value: number): number {
  return value / SQ_FT_TO_SQ_M;
}

export function mmToM(value: number): number {
  return value / 1000;
}

export function areaMm2ToSqM(value: number): number {
  return value / 1_000_000;
}

export function sqMToAreaMm2(value: number): number {
  return value * 1_000_000;
}

export function cellAreaSqM(cellSizeMm: number): number {
  return (cellSizeMm * cellSizeMm) / 1_000_000;
}
