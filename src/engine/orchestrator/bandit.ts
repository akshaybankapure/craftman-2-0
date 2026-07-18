/**
 * UCB1 multi-armed bandit — allocate generation budget across mission families.
 */

import type { MissionGraphFamily } from '../topology/missionTypes.ts';

export interface BanditArm {
  family: MissionGraphFamily;
  pulls: number;
  successes: number; // valid + novel candidates
}

export class FamilyBandit {
  private arms: Map<MissionGraphFamily, BanditArm>;
  private totalPulls = 0;

  constructor(families: MissionGraphFamily[]) {
    this.arms = new Map(
      families.map(f => [f, { family: f, pulls: 0, successes: 0 }]),
    );
  }

  /** Select next family (explore unpulled first, then UCB1). */
  select(): MissionGraphFamily {
    const list = [...this.arms.values()];
    const unpulled = list.find(a => a.pulls === 0);
    if (unpulled) return unpulled.family;

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
    return best.family;
  }

  record(family: MissionGraphFamily, success: boolean): void {
    const arm = this.arms.get(family);
    if (!arm) return;
    arm.pulls++;
    if (success) arm.successes++;
    this.totalPulls++;
  }

  stats(): BanditArm[] {
    return [...this.arms.values()];
  }
}
