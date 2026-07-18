/**
 * Named deterministic RNG streams.
 * One root seed fans out into independent sub-streams so sub-engines
 * never interfere with each other's sequence.
 */

export class RNG {
  private state: number;

  constructor(seed: number) {
    this.state = (seed >>> 0) || 1;
  }

  next(): number {
    this.state = (Math.imul(1664525, this.state) + 1013904223) >>> 0;
    return this.state / 0x100000000;
  }

  int(min: number, maxExclusive: number): number {
    if (maxExclusive <= min) return min;
    return min + Math.floor(this.next() * (maxExclusive - min));
  }

  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error('RNG.pick on empty array');
    return arr[this.int(0, arr.length)]!;
  }

  shuffle<T>(arr: readonly T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = this.int(0, i + 1);
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  }

  bool(p = 0.5): boolean {
    return this.next() < p;
  }

  /** Sample from softmax weights with temperature T (>0). */
  softmaxPick(weights: readonly number[], temperature = 1): number {
    if (weights.length === 0) throw new Error('softmaxPick on empty');
    const T = Math.max(1e-6, temperature);
    const maxW = Math.max(...weights);
    const exps = weights.map(w => Math.exp((w - maxW) / T));
    const sum = exps.reduce((s, e) => s + e, 0);
    let r = this.next() * sum;
    for (let i = 0; i < exps.length; i++) {
      r -= exps[i]!;
      if (r <= 0) return i;
    }
    return weights.length - 1;
  }
}

/** Mix a root seed with a string name into an independent child seed. */
export function streamSeed(root: number, name: string): number {
  let h = (root >>> 0) ^ 0x9e3779b9;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) || 1;
}

export function createStream(root: number, name: string): RNG {
  return new RNG(streamSeed(root, name));
}

export type StreamBag =
  | 'topology'
  | 'zoning'
  | 'circulation'
  | 'growth'
  | 'openings'
  | 'furniture'
  | 'repair'
  | 'improve'
  | 'bandit';

export class StreamBank {
  constructor(private readonly root: number) {}

  stream(name: StreamBag | string): RNG {
    return createStream(this.root, name);
  }

  get rootSeed(): number {
    return this.root;
  }
}
