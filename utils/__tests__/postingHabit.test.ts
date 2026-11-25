import {
  bestRunOf,
  computePostingHabit,
  countPostedBy,
  currentRun,
  weekVerdict,
  habitWindow,
  mondayOf,
  noticeGoalFor,
  type HabitShift,
} from '@/utils/postingHabit';

// 2026-11-18 is a Wednesday; its week starts Monday 2026-11-16.
const TODAY = '2026-11-18';
const TZ = 'UTC';

/** `n` shifts on `date`, published on `publishedOn` (YYYY-MM-DD, noon UTC), or drafts. */
const shifts = (date: string, n: number, publishedOn: string | null): HabitShift[] =>
  Array.from({ length: n }, () => (publishedOn
    ? { date, status: 'Published' as const, publishedAt: `${publishedOn}T12:00:00.000Z` }
    : { date, status: 'Draft' as const, publishedAt: null }));

describe('mondayOf / habitWindow', () => {
  it('finds the Monday of a week, Sunday included', () => {
    expect(mondayOf('2026-11-16')).toBe('2026-11-16');
    expect(mondayOf('2026-11-22')).toBe('2026-11-16');
    expect(mondayOf('2026-11-23')).toBe('2026-11-23');
  });

  it('loads eight weeks back and the weeks still open', () => {
    expect(habitWindow(TODAY, 7)).toEqual({ fromDate: '2026-09-28', toDate: '2026-12-06' });
  });
});

describe('computePostingHabit', () => {
  it('counts a week posted by its deadline and not one posted after', () => {
    const habit = computePostingHabit([
      ...shifts('2026-11-09', 10, '2026-11-01'), // deadline 11-02: ahead
      ...shifts('2026-11-16', 10, '2026-11-12'), // deadline 11-09: late
    ], { today: TODAY, noticeDays: 7, timeZone: TZ });
    const byWeek = Object.fromEntries(habit.weeks.map((w) => [w.weekStart, w.verdict]));
    expect(byWeek['2026-11-09']).toBe('ahead');
    expect(byWeek['2026-11-16']).toBe('late');
    expect(habit.run).toBe(0);
    expect(habit.aheadWeeks).toBe(1);
    expect(habit.decidedWeeks).toBe(2);
  });

  it('publishing on the deadline day itself still counts', () => {
    const habit = computePostingHabit(shifts('2026-11-16', 3, '2026-11-09'), { today: TODAY, noticeDays: 7, timeZone: TZ });
    expect(habit.weeks.find((w) => w.weekStart === '2026-11-16')?.verdict).toBe('ahead');
  });

  it('a late addition after posting does not undo the week (90% rule)', () => {
    const habit = computePostingHabit([
      ...shifts('2026-11-16', 9, '2026-11-02'),
      ...shifts('2026-11-18', 1, '2026-11-17'),
    ], { today: TODAY, noticeDays: 7, timeZone: TZ });
    expect(habit.weeks.find((w) => w.weekStart === '2026-11-16')?.verdict).toBe('ahead');
  });

  it('drafts do not count as posted', () => {
    const habit = computePostingHabit([
      ...shifts('2026-11-16', 5, '2026-11-02'),
      ...shifts('2026-11-17', 5, null),
    ], { today: TODAY, noticeDays: 7, timeZone: TZ });
    const week = habit.weeks.find((w) => w.weekStart === '2026-11-16');
    expect(week).toMatchObject({ verdict: 'late', shifts: 10, postedByDeadline: 5 });
  });

  it('skips weeks with no shifts: they neither count nor break the run', () => {
    const habit = computePostingHabit([
      ...shifts('2026-10-26', 4, '2026-10-01'),
      // 2026-11-02: closed, no shifts
      ...shifts('2026-11-09', 4, '2026-10-20'),
      ...shifts('2026-11-16', 4, '2026-11-01'),
    ], { today: TODAY, noticeDays: 7, timeZone: TZ });
    expect(habit.weeks.find((w) => w.weekStart === '2026-11-02')?.verdict).toBe('empty');
    expect(habit.run).toBe(3);
    expect(habit.bestRun).toBe(3);
  });

  it('the next week is open until its deadline, and already ahead if posted early', () => {
    const notYet = computePostingHabit([], { today: TODAY, noticeDays: 7, timeZone: TZ });
    const open = notYet.weeks.filter((w) => w.verdict === 'open');
    // Week of 11-23 has its deadline on 11-16 (passed); 11-30 has 11-23 (open).
    expect(open.map((w) => w.weekStart)).toEqual(['2026-11-30']);
    expect(notYet.weeks.find((w) => w.weekStart === '2026-11-23')?.verdict).toBe('empty');

    const early = computePostingHabit(shifts('2026-12-01', 2, '2026-11-18'), { today: TODAY, noticeDays: 7, timeZone: TZ });
    expect(early.weeks.find((w) => w.weekStart === '2026-11-30')?.verdict).toBe('ahead');
    expect(early.run).toBe(1);
  });

  it('an open week does not break the run', () => {
    const habit = computePostingHabit([
      ...shifts('2026-11-16', 2, '2026-11-01'),
      ...shifts('2026-11-23', 2, '2026-11-10'),
      ...shifts('2026-12-01', 2, null),
    ], { today: TODAY, noticeDays: 7, timeZone: TZ });
    expect(habit.run).toBe(2);
  });

  it('reads the publish day in the business time zone', () => {
    // 2026-11-10 03:00 UTC is still 2026-11-09 in Lima (UTC-5): on the deadline.
    const habit = computePostingHabit(
      [{ date: '2026-11-16', status: 'Published', publishedAt: '2026-11-10T03:00:00.000Z' }],
      { today: TODAY, noticeDays: 7, timeZone: 'America/Lima' },
    );
    expect(habit.weeks.find((w) => w.weekStart === '2026-11-16')?.verdict).toBe('ahead');
    const utc = computePostingHabit(
      [{ date: '2026-11-16', status: 'Published', publishedAt: '2026-11-10T03:00:00.000Z' }],
      { today: TODAY, noticeDays: 7, timeZone: 'UTC' },
    );
    expect(utc.weeks.find((w) => w.weekStart === '2026-11-16')?.verdict).toBe('late');
  });

  it('a 14-day goal moves the deadline', () => {
    const habit = computePostingHabit(shifts('2026-11-16', 2, '2026-11-05'), { today: TODAY, noticeDays: 14, timeZone: TZ });
    const week = habit.weeks.find((w) => w.weekStart === '2026-11-16');
    expect(week?.deadline).toBe('2026-11-02');
    expect(week?.verdict).toBe('late');
  });

  it('ignores a malformed publish time instead of throwing', () => {
    const habit = computePostingHabit(
      [{ date: '2026-11-16', status: 'Published', publishedAt: 'not a date' }],
      { today: TODAY, noticeDays: 7, timeZone: TZ },
    );
    expect(habit.weeks.find((w) => w.weekStart === '2026-11-16')?.verdict).toBe('late');
  });
});

describe('noticeGoalFor', () => {
  it('defaults to a week where the law asks for less or nothing', () => {
    expect(noticeGoalFor([])).toEqual({ days: 7, lawDays: null, ifCoveredDays: null });
    expect(noticeGoalFor([{ jurisdictionCode: 'PE', industry: 'retail' }]).days).toBe(7);
  });

  it('uses a longer legal notice that applies to every covered employer', () => {
    // Seattle Secure Scheduling: 14 days, gated on coverage -> reported apart.
    const seattle = noticeGoalFor([{ jurisdictionCode: 'US-WA-SEATTLE', industry: 'food_service' }]);
    expect(seattle.days).toBe(7);
    expect(seattle.ifCoveredDays).toBe(14);
  });

  it('reports a shorter legal notice without lowering the one-week goal', () => {
    // NYC retail: 72 h of notice for every covered retailer.
    expect(noticeGoalFor([{ jurisdictionCode: 'US-NY-NYC', industry: 'retail' }]))
      .toEqual({ days: 7, lawDays: 3, ifCoveredDays: null });
    // The same city's fast-food rule (14 days) depends on coverage.
    expect(noticeGoalFor([{ jurisdictionCode: 'US-NY-NYC', industry: 'fast_food' }]))
      .toEqual({ days: 7, lawDays: null, ifCoveredDays: 14 });
  });

  it('with several locations the strictest wins', () => {
    const goal = noticeGoalFor([
      { jurisdictionCode: 'PE', industry: 'retail' },
      { jurisdictionCode: 'US-WA-SEATTLE', industry: 'retail' },
    ]);
    expect(goal.ifCoveredDays).toBe(14);
  });

  it('ignores an unknown jurisdiction', () => {
    expect(noticeGoalFor([{ jurisdictionCode: 'XX-NOPE', industry: 'retail' }]).days).toBe(7);
  });
});

describe('postingHabit helpers', () => {
  const week = (verdict: 'ahead' | 'late' | 'open' | 'empty') =>
    ({ weekStart: '2026-11-02', deadline: '2026-10-26', shifts: 1, postedByDeadline: 0, verdict });

  it('weekVerdict: 9 of 10 is ahead, 8 of 10 is late once decided and open before', () => {
    expect(weekVerdict(10, 9, true)).toBe('ahead');
    expect(weekVerdict(10, 8, true)).toBe('late');
    expect(weekVerdict(10, 8, false)).toBe('open');
    expect(weekVerdict(0, 0, true)).toBe('empty');
    expect(weekVerdict(0, 0, false)).toBe('open');
  });

  it('countPostedBy: drafts, missing times and later days do not count', () => {
    expect(countPostedBy([
      { date: '2026-11-16', status: 'Published', publishedAt: '2026-11-09T12:00:00Z' },
      { date: '2026-11-16', status: 'Published', publishedAt: '2026-11-10T12:00:00Z' },
      { date: '2026-11-16', status: 'Published', publishedAt: null },
      { date: '2026-11-16', status: 'Draft', publishedAt: '2026-11-01T12:00:00Z' },
    ], '2026-11-09', 'UTC')).toBe(1);
  });

  it('currentRun stops at the newest late week; bestRunOf keeps the longest', () => {
    const weeks = ['ahead', 'ahead', 'ahead', 'late', 'empty', 'ahead', 'open'].map((v) => week(v as never));
    expect(currentRun(weeks)).toBe(1);
    expect(bestRunOf(weeks)).toBe(3);
    expect(currentRun([])).toBe(0);
  });
});
