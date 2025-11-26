import { useMemo } from 'react';

type RewardTier = {
  threshold: number;
  title: string;
  message: string;
};

const rewardTiers: RewardTier[] = [
  {
    threshold: 1,
    title: 'Great start',
    message: 'Saved your first update—keep a steady pace rather than rushing.',
  },
  {
    threshold: 3,
    title: 'Momentum building',
    message: 'Three consistent updates in a row. Take a breath and review the plan.',
  },
  {
    threshold: 7,
    title: 'Weekly win',
    message: 'A full week of upkeep. Celebrate the routine and rest when needed.',
  },
  {
    threshold: 14,
    title: 'Two-week rhythm',
    message: 'Two weeks of coverage health—perfect time to delegate and rotate duties.',
  },
];

export const pickRewardTier = (progressCount: number) => {
  const eligible = rewardTiers
    .filter((tier) => progressCount >= tier.threshold)
    .sort((a, b) => b.threshold - a.threshold);
  return eligible[0] ?? rewardTiers[0];
};

export function useEthicalReward(progressCount: number) {
  const tier = useMemo(() => pickRewardTier(progressCount), [progressCount]);

  const shouldShowCelebration = progressCount > 0 && progressCount % 7 === 0;

  return { tier, shouldShowCelebration } as const;
}
