/**
 * UCB1 multi-armed bandit — allocate generation budget across string arm keys
 * (typically `missionFamily|backend`).
 */

export interface BanditArm {
  key: string;
  pulls: number;
  successes: number;
}

export class FamilyBandit {
  private arms: Map<string, BanditArm>;
  private totalPulls = 0;

  constructor(keys: string[]) {
    this.arms = new Map(keys.map(key => [key, { key, pulls: 0, successes: 0 }]));
  }

  /** Select next arm (explore unpulled first, then UCB1). */
  select(): string {
    const list = [...this.arms.values()];
    const unpulled = list.find(a => a.pulls === 0);
    if (unpulled) return unpulled.key;

    let best = list[0]!;
    let bestScore = -Infinity;
    for (const arm of list) {
      const mean = arm.successes / Math.max(1, arm.pulls);
      const bonus = Math.sqrt((2 * Math.log(Math.max(1, this.totalPulls))) / arm.pulls);
      const score = mean + bonus;
      if (score > bestScore) {
        bestScore = score;
        best = arm;
      }
    }
    return best.key;
  }

  record(key: string, success: boolean): void {
    const arm = this.arms.get(key);
    if (!arm) return;
    arm.pulls++;
    if (success) arm.successes++;
    this.totalPulls++;
  }

  stats(): BanditArm[] {
    return [...this.arms.values()];
  }
}

/** Parse `family|backend` arm keys. */
export function splitArmKey(key: string): { family: string; backend: string } {
  const idx = key.lastIndexOf('|');
  if (idx < 0) return { family: key, backend: 'regionGrowth' };
  return { family: key.slice(0, idx), backend: key.slice(idx + 1) };
}

export function makeArmKey(family: string, backend: string): string {
  return `${family}|${backend}`;
}
