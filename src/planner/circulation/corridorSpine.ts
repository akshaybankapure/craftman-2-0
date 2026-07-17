import type { AreaBudget } from '../types.ts';
import type { CorridorSpine, EntranceDirection, Vec2 } from '../types.ts';
import { RNG } from '../rng.ts';
import { budgetFor } from '../budget/areaBudget.ts';

export interface SpineParams {
  outlineW: number;
  outlineH: number;
  entranceDir: EntranceDirection;
  corridorId: string;
  entryId: string;
  foyerId: string | null;
  budgets: AreaBudget[];
  seed: number;
  shapeVariant?: number;
}

/**
 * Create circulation geometry first: entry/foyer + corridor spine from the entrance edge.
 */
export function createCorridorSpine(params: SpineParams): {
  spine: CorridorSpine;
  entryRect: { x: number; y: number; w: number; h: number };
  foyerRect: { x: number; y: number; w: number; h: number } | null;
  corridorRects: Array<{ x: number; y: number; w: number; h: number }>;
} {
  const rng = new RNG(params.seed);
  const variant = params.shapeVariant ?? rng.int(0, 4);
  const corrBudget = budgetFor(params.budgets, params.corridorId);
  const entryBudget = budgetFor(params.budgets, params.entryId);

  const corrW = Math.min(1.2, Math.max(0.9, corrBudget.minWidth));
  const { outlineW: W, outlineH: H, entranceDir } = params;

  // Entry depth from area / wall length share
  const entryDepth = Math.min(
    2.2,
    Math.max(1.2, entryBudget.targetArea / Math.min(W, H) * 2.5)
  );
  const entryLen = Math.min(
    Math.max(1.8, entryBudget.targetArea / entryDepth),
    Math.min(W, H) * 0.45
  );

  let entryRect: { x: number; y: number; w: number; h: number };
  let foyerRect: { x: number; y: number; w: number; h: number } | null = null;
  let corridorRects: Array<{ x: number; y: number; w: number; h: number }> = [];
  let centreline: Vec2[] = [];
  let entryPoint: Vec2;
  let shape: CorridorSpine['shape'] = 'straight';

  const mid = (a: number, b: number) => (a + b) / 2;

  switch (entranceDir) {
    case 'S': {
      const ex = (W - entryLen) / 2;
      entryRect = { x: ex, y: H - entryDepth, w: entryLen, h: entryDepth };
      entryPoint = { x: mid(ex, ex + entryLen), y: H };
      let cy = H - entryDepth;
      if (params.foyerId) {
        const fd = Math.min(1.8, entryDepth);
        foyerRect = { x: ex, y: cy - fd, w: entryLen, h: fd };
        cy -= fd;
      }
      // Spine grows north
      if (variant === 0) {
        shape = 'straight';
        const cx = mid(ex, ex + entryLen) - corrW / 2;
        const ch = Math.max(corrW, cy - H * 0.25);
        corridorRects = [{ x: clamp(cx, 0, W - corrW), y: cy - ch, w: corrW, h: ch }];
        centreline = [
          { x: cx + corrW / 2, y: cy },
          { x: cx + corrW / 2, y: cy - ch },
        ];
      } else if (variant === 1) {
        shape = 'L';
        const cx = mid(ex, ex + entryLen) - corrW / 2;
        const stemH = Math.max(corrW * 2, cy * 0.45);
        const armW = Math.min(W * 0.45, W - cx);
        corridorRects = [
          { x: clamp(cx, 0, W - corrW), y: cy - stemH, w: corrW, h: stemH },
          { x: clamp(cx, 0, W - armW), y: cy - stemH - corrW, w: armW, h: corrW },
        ];
        centreline = [
          { x: cx + corrW / 2, y: cy },
          { x: cx + corrW / 2, y: cy - stemH - corrW / 2 },
          { x: cx + armW, y: cy - stemH - corrW / 2 },
        ];
      } else if (variant === 2) {
        shape = 'T';
        const cx = mid(ex, ex + entryLen) - corrW / 2;
        const stemH = Math.max(corrW * 2, cy * 0.4);
        const barW = Math.min(W * 0.7, W - 0.5);
        const barX = (W - barW) / 2;
        corridorRects = [
          { x: clamp(cx, 0, W - corrW), y: cy - stemH, w: corrW, h: stemH },
          { x: barX, y: cy - stemH - corrW, w: barW, h: corrW },
        ];
        centreline = [
          { x: cx + corrW / 2, y: cy },
          { x: cx + corrW / 2, y: cy - stemH - corrW / 2 },
          { x: barX, y: cy - stemH - corrW / 2 },
          { x: barX + barW, y: cy - stemH - corrW / 2 },
        ];
      } else {
        shape = 'branched';
        const cx = mid(ex, ex + entryLen) - corrW / 2;
        const stemH = Math.max(corrW * 2, cy * 0.5);
        corridorRects = [
          { x: clamp(cx, 0, W - corrW), y: cy - stemH, w: corrW, h: stemH },
          { x: Math.max(0, cx - W * 0.25), y: cy - stemH * 0.55, w: W * 0.25, h: corrW },
        ];
        centreline = [
          { x: cx + corrW / 2, y: cy },
          { x: cx + corrW / 2, y: cy - stemH },
        ];
      }
      break;
    }
    case 'N': {
      const ex = (W - entryLen) / 2;
      entryRect = { x: ex, y: 0, w: entryLen, h: entryDepth };
      entryPoint = { x: mid(ex, ex + entryLen), y: 0 };
      let cy = entryDepth;
      if (params.foyerId) {
        const fd = Math.min(1.8, entryDepth);
        foyerRect = { x: ex, y: cy, w: entryLen, h: fd };
        cy += fd;
      }
      shape = variant === 0 ? 'straight' : variant === 1 ? 'L' : 'T';
      const cx = mid(ex, ex + entryLen) - corrW / 2;
      const ch = Math.max(corrW, H * 0.45 - cy);
      if (shape === 'straight') {
        corridorRects = [{ x: clamp(cx, 0, W - corrW), y: cy, w: corrW, h: ch }];
        centreline = [
          { x: cx + corrW / 2, y: cy },
          { x: cx + corrW / 2, y: cy + ch },
        ];
      } else {
        const stemH = ch * 0.55;
        const armW = W * 0.4;
        corridorRects = [
          { x: clamp(cx, 0, W - corrW), y: cy, w: corrW, h: stemH },
          { x: clamp(cx, 0, W - armW), y: cy + stemH, w: armW, h: corrW },
        ];
        centreline = [
          { x: cx + corrW / 2, y: cy },
          { x: cx + corrW / 2, y: cy + stemH + corrW / 2 },
          { x: cx + armW, y: cy + stemH + corrW / 2 },
        ];
      }
      break;
    }
    case 'W': {
      const ey = (H - entryLen) / 2;
      entryRect = { x: 0, y: ey, w: entryDepth, h: entryLen };
      entryPoint = { x: 0, y: mid(ey, ey + entryLen) };
      let cx = entryDepth;
      if (params.foyerId) {
        const fd = Math.min(1.8, entryDepth);
        foyerRect = { x: cx, y: ey, w: fd, h: entryLen };
        cx += fd;
      }
      shape = variant % 2 === 0 ? 'straight' : 'L';
      const cy = mid(ey, ey + entryLen) - corrW / 2;
      const cw = Math.max(corrW, W * 0.45 - cx);
      if (shape === 'straight') {
        corridorRects = [{ x: cx, y: clamp(cy, 0, H - corrW), w: cw, h: corrW }];
        centreline = [
          { x: cx, y: cy + corrW / 2 },
          { x: cx + cw, y: cy + corrW / 2 },
        ];
      } else {
        const stemW = cw * 0.55;
        corridorRects = [
          { x: cx, y: clamp(cy, 0, H - corrW), w: stemW, h: corrW },
          { x: cx + stemW, y: clamp(cy, 0, H - H * 0.35), w: corrW, h: H * 0.35 },
        ];
        centreline = [
          { x: cx, y: cy + corrW / 2 },
          { x: cx + stemW + corrW / 2, y: cy + corrW / 2 },
          { x: cx + stemW + corrW / 2, y: cy + H * 0.3 },
        ];
      }
      break;
    }
    case 'E': {
      const ey = (H - entryLen) / 2;
      entryRect = { x: W - entryDepth, y: ey, w: entryDepth, h: entryLen };
      entryPoint = { x: W, y: mid(ey, ey + entryLen) };
      let cx = W - entryDepth;
      if (params.foyerId) {
        const fd = Math.min(1.8, entryDepth);
        foyerRect = { x: cx - fd, y: ey, w: fd, h: entryLen };
        cx -= fd;
      }
      shape = variant % 2 === 0 ? 'straight' : 'L';
      const cy = mid(ey, ey + entryLen) - corrW / 2;
      const cw = Math.max(corrW, cx - W * 0.55);
      corridorRects = [{ x: cx - cw, y: clamp(cy, 0, H - corrW), w: cw, h: corrW }];
      centreline = [
        { x: cx, y: cy + corrW / 2 },
        { x: cx - cw, y: cy + corrW / 2 },
      ];
      break;
    }
  }

  // Clamp corridor area roughly under budget max
  let corrArea = corridorRects.reduce((s, r) => s + r.w * r.h, 0);
  if (corrArea > corrBudget.maxArea && corridorRects.length > 0) {
    const scale = Math.sqrt(corrBudget.maxArea / corrArea);
    corridorRects = corridorRects.map(r => ({
      ...r,
      w: Math.max(corrW, r.w * scale),
      h: Math.max(corrW, r.h * scale),
    }));
  }

  const spine: CorridorSpine = {
    shape,
    width: corrW,
    centreline,
    polygons: corridorRects,
    entryPoint,
  };

  return { spine, entryRect, foyerRect, corridorRects };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
