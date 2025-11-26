import { computeNextStreak } from '../useStreak';
import { pickRewardTier } from '../useEthicalReward';
import { rankPersonalizedFeed } from '../usePersonalizedFeed';

describe('computeNextStreak', () => {
  const baseDate = new Date('2024-01-01T12:00:00Z');

  it('starts a new streak when there is no history', () => {
    const next = computeNextStreak(null, baseDate);
    expect(next.count).toBe(1);
    expect(next.longest).toBe(1);
    expect(next.lastActionDate).toBe('2024-01-01');
  });

  it('increments streak on consecutive days', () => {
    const previous = { count: 2, longest: 2, lastActionDate: '2024-01-01' };
    const next = computeNextStreak(previous, new Date('2024-01-02T10:00:00Z'));
    expect(next.count).toBe(3);
    expect(next.longest).toBe(3);
  });

  it('resets streak when a day is skipped', () => {
    const previous = { count: 4, longest: 5, lastActionDate: '2024-01-01' };
    const next = computeNextStreak(previous, new Date('2024-01-03T10:00:00Z'));
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
    const ranked = rankPersonalizedFeed(
      { focus: 'availability' },
      [
        { id: 'f1', title: 'A', summary: '', category: 'forecast', impactScore: 0.4 },
        { id: 'f2', title: 'B', summary: '', category: 'availability', impactScore: 0.3 },
      ]
    );

    expect(ranked[0].id).toBe('f2');
  });
});
