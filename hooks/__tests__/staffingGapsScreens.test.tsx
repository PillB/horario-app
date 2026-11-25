/**
 * Home and Analytics read the same stored rows and must agree on the gaps
 * (CHG-109, D1). The Scheduler's side is in schedulerHandlersState.test.tsx.
 * One fake proxy serves both hooks; the expected numbers are counted by hand.
 */
import { useAnalytics } from '../useAnalytics';
import { useLiveRosterSummary } from '../useLiveRosterSummary';
import { addDaysToKey, todayKey } from '@/utils/dateKeys';
import { installFakeProxy, renderHook } from '../testUtils/fakeProxy';

const D1 = addDaysToKey(todayKey(), 1);
const D2 = addDaysToKey(todayKey(), 2);

const TEMPLATE = { id: 't1', accountId: 'acc', name: 'Morning', role: 'Support', startTime: '08:00', endTime: '16:00', coverage: 3 };
const row = (id: string, date: string, status: 'Draft' | 'Published') => ({
  id, accountId: 'acc', date, workerId: 'w1', templateId: 't1', location: '', status, notified: false,
});

beforeEach(() => {
  installFakeProxy((body) => {
    switch (body.action) {
      case 'listShiftTemplates':
        return { body: { templates: [TEMPLATE], hasMore: false } };
      case 'listWorkers':
        return { body: { workers: [{ id: 'w1', accountId: 'acc', name: 'Ana', role: 'Support', skills: [] }], hasMore: false } };
      case 'listRoster':
        return { body: { shifts: [row('s1', D1, 'Published'), row('s2', D1, 'Draft'), row('s3', D2, 'Published')], hasMore: false } };
      case 'loadTargets':
        return {
          body: {
            targets: [
              { date: D1, role: 'Support', required: 3, source: 'override' },
              { date: D2, role: 'Support', required: 1, source: 'override' },
            ],
            hasMore: false,
          },
        };
      default:
        return { body: {} };
    }
  });
});

describe('staffing gaps on Home and Analytics (D1)', () => {
  it('count the same open positions from the same rows', async () => {
    const home = await renderHook(({ id }: { id: string }) => useLiveRosterSummary(id), { id: 'acc' });
    const analytics = await renderHook(({ id }: { id: string }) => useAnalytics(id), { id: 'acc' });

    // D1: 3 needed, 1 published (the draft and template coverage 3 do not count) → 2 open.
    // D2: 1 needed, 1 published → covered.
    expect(home.result.error).toBeNull();
    expect(home.result.staffingGaps.map(({ date, scheduled, gap }) => ({ date, scheduled, gap }))).toEqual([
      { date: D1, scheduled: 1, gap: 2 },
    ]);
    // Analytics: filled 1 + 1 of 4 required = 50 %, the same 2 open positions.
    expect(analytics.result.error).toBeNull();
    expect(analytics.result.coverageRate).toBe(50);
    const openOnHome = home.result.staffingGaps.reduce((sum, g) => sum + g.gap, 0);
    expect(4 - Math.round((analytics.result.coverageRate / 100) * 4)).toBe(openOnHome);
    home.unmount();
    analytics.unmount();
  });
});
