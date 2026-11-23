import { useMemo } from 'react';

/**
 * Recognition for the weekly posting habit (CHG-106): informational, not
 * controlling (self-determination theory: feedback that tells a person what
 * they did well supports competence; a reward framed as pressure lowers
 * intrinsic motivation, Deci, Koestner & Ryan 1999). Each message names the
 * benefit to the team and never asks for more work.
 * Keys are under home.habit.tiers in the locales.
 */
type RewardTier = {
  /** Weeks in a row posted ahead. */
  threshold: number;
  titleKey: string;
  messageKey: string;
};

const rewardTiers: RewardTier[] = [
  { threshold: 1, titleKey: 'home.habit.tiers.firstTitle', messageKey: 'home.habit.tiers.firstMessage' },
  { threshold: 4, titleKey: 'home.habit.tiers.monthTitle', messageKey: 'home.habit.tiers.monthMessage' },
  { threshold: 8, titleKey: 'home.habit.tiers.steadyTitle', messageKey: 'home.habit.tiers.steadyMessage' },
];

/** The highest tier reached, or null before the first week (nothing has been earned yet). */
export const pickRewardTier = (weeksInARow: number): RewardTier | null => {
  const eligible = rewardTiers
    .filter((tier) => weeksInARow >= tier.threshold)
    .sort((a, b) => b.threshold - a.threshold);
  return eligible[0] ?? null;
};

export function useEthicalReward(weeksInARow: number) {
  const tier = useMemo(() => pickRewardTier(weeksInARow), [weeksInARow]);
  return { tier } as const;
}
