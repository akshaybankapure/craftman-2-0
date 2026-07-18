import { describe, it, expect } from 'vitest';
import { validateFurniture } from '../templates.ts';
import type { RoomRect } from '../../../planner/types.ts';

function room(partial: Partial<RoomRect> & Pick<RoomRect, 'id' | 'category' | 'w' | 'h'>): RoomRect {
  return {
    type: 'bedroom',
    x: 0,
    y: 0,
    targetArea: partial.w * partial.h,
    minDimension: 1,
    ...partial,
  };
}

describe('Furniture validation', () => {
  it('accepts a usable bedroom', () => {
    const r = validateFurniture([
      room({ id: 'b1', category: 'BEDROOM', type: 'bedroom', w: 3.2, h: 3.5 }),
    ]);
    expect(r.valid).toBe(true);
    expect(r.placements.some(p => p.kind === 'bed')).toBe(true);
  });

  it('rejects extreme bathroom strips', () => {
    const r = validateFurniture([
      room({ id: 'bath', category: 'COMMON_BATHROOM', type: 'bathroom', w: 7.0, h: 1.2 }),
    ]);
    expect(r.valid).toBe(false);
    expect(r.conflicts.some(c => c.message.includes('strip') || c.message.includes('cannot fit'))).toBe(true);
  });

  it('requires kitchen aisle clearance', () => {
    const r = validateFurniture([
      room({ id: 'k', category: 'KITCHEN', type: 'kitchen', w: 1.4, h: 1.4 }),
    ]);
    expect(r.valid).toBe(false);
  });
});
