import { useMemo } from 'react';

type FeedItem = {
  id: string;
  title: string;
  summary: string;
  category: 'availability' | 'forecast' | 'roster' | 'wellness';
  impactScore: number;
};

type RankedFeedItem = FeedItem & { score: number };

type Preferences = {
  focus: 'availability' | 'forecast' | 'roster';
  prefersShortTasks?: boolean;
};

const DEFAULT_ITEMS: FeedItem[] = [
  {
    id: 'feed-availability',
    title: 'Log today’s availability updates',
    summary: 'Capture new PTO and swaps to keep forecasts honest.',
    category: 'availability',
    impactScore: 0.88,
  },
  {
    id: 'feed-forecast',
    title: 'Review demand signals',
    summary: 'Compare targets with fresh signals before publishing.',
    category: 'forecast',
    impactScore: 0.76,
  },
  {
    id: 'feed-roster',
    title: 'Publish the weekend roster',
    summary: 'Nudge draft shifts into publish-ready state.',
    category: 'roster',
    impactScore: 0.71,
  },
  {
    id: 'feed-break',
    title: 'Take a stretch break',
    summary: 'Pause for a moment—well-rested planners catch more gaps.',
    category: 'wellness',
    impactScore: 0.52,
  },
];

export const rankPersonalizedFeed = (
  preferences: Preferences,
  items: FeedItem[] = DEFAULT_ITEMS
): { rankedItems: RankedFeedItem[]; scores: Record<string, number> } => {
  const scoredItems = items.map((item) => {
    const focusBoost = item.category === preferences.focus ? 0.2 : 0;
    const shortTaskBoost = preferences.prefersShortTasks && item.category !== 'forecast' ? 0.05 : 0;
    const rawScore = item.impactScore + focusBoost + shortTaskBoost;
    const score = Math.min(1, Math.max(0, rawScore));

    return { ...item, score };
  });

  const rankedItems = [...scoredItems].sort((first, second) => second.score - first.score);
  const scores = scoredItems.reduce<Record<string, number>>((acc, item) => {
    acc[item.id] = item.score;
    return acc;
  }, {});

  return { rankedItems, scores };
};

export function usePersonalizedFeed(preferences: Preferences, items: FeedItem[] = DEFAULT_ITEMS) {
  const { rankedItems, scores } = useMemo(() => rankPersonalizedFeed(preferences, items), [items, preferences]);

  return { items: rankedItems, scores } as const;
}

export type { FeedItem, Preferences, RankedFeedItem };
