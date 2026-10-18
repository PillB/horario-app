import { computeNextStreak } from '../useStreak';
import { pickRewardTier } from '../useEthicalReward';
import { rankPersonalizedFeed } from '../usePersonalizedFeed';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
  },
}));

describe('computeNextStreak', () => {
  const baseDate = new Date(2024, 0, 1, 12); // device-local; streak days are local calendar days

  it('starts a new streak when there is no history', () => {
    const next = computeNextStreak(null, baseDate);
    expect(next.count).toBe(1);
    expect(next.longest).toBe(1);
    expect(next.lastActionDate).toBe('2024-01-01');
  });

  it('increments streak on consecutive days', () => {
    const previous = { count: 2, longest: 2, lastActionDate: '2024-01-01' };
    const next = computeNextStreak(previous, new Date(2024, 0, 2, 10));
    expect(next.count).toBe(3);
    expect(next.longest).toBe(3);
  });

  it('resets streak when a day is skipped', () => {
    const previous = { count: 4, longest: 5, lastActionDate: '2024-01-01' };
    const next = computeNextStreak(previous, new Date(2024, 0, 3, 10));
    expect(next.count).toBe(1);
    expect(next.longest).toBe(5);
  });
});

describe('pickRewardTier', () => {
  it('returns the highest eligible tier', () => {
    const tier = pickRewardTier(8);
    expect(tier.title).toMatch(/Weekly/);
  });
});

describe('rankPersonalizedFeed', () => {
  it('prioritizes focus category items', () => {
    const { rankedItems } = rankPersonalizedFeed(
      { focus: 'availability' },
      [
        { id: 'f1', title: 'A', summary: '', category: 'forecast', impactScore: 0.4 },
        { id: 'f2', title: 'B', summary: '', category: 'availability', impactScore: 0.3 },
      ]
    );

    expect(rankedItems[0].id).toBe('f2');
  });

  it('clamps boosted scores and returns score lookup', () => {
    const { rankedItems, scores } = rankPersonalizedFeed(
      { focus: 'availability', prefersShortTasks: true },
      [
        { id: 'f1', title: 'A', summary: '', category: 'availability', impactScore: 0.95 },
        { id: 'f2', title: 'B', summary: '', category: 'roster', impactScore: 0.2 },
      ]
    );

    expect(rankedItems[0].score).toBe(1);
    expect(scores.f1).toBe(rankedItems[0].score);
    expect(Math.max(...rankedItems.map((item) => item.score))).toBeLessThanOrEqual(1);
    expect(Math.min(...rankedItems.map((item) => item.score))).toBeGreaterThanOrEqual(0);
  });

  it('does not mutate inputs or cross-contaminate rankings between calls', () => {
    const baseItems = [
      { id: 'f1', title: 'A', summary: '', category: 'forecast', impactScore: 0.4 },
      { id: 'f2', title: 'B', summary: '', category: 'availability', impactScore: 0.3 },
      { id: 'f3', title: 'C', summary: '', category: 'roster', impactScore: 0.2 },
    ];

    const firstCall = rankPersonalizedFeed({ focus: 'availability' }, baseItems);
    const secondCall = rankPersonalizedFeed({ focus: 'roster', prefersShortTasks: true }, baseItems);

    expect(firstCall.rankedItems.map((item) => item.id)).toEqual(['f2', 'f1', 'f3']);
    expect(secondCall.rankedItems.map((item) => item.id)).toEqual(['f3', 'f1', 'f2']);
    expect(baseItems.map((item) => item.id)).toEqual(['f1', 'f2', 'f3']);
  });
});
