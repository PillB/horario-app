/**
 * One staffing-gap rule for Home, the Scheduler and Analytics (CHG-109, D1).
 * Expected values are counted by hand from the fixtures.
 */
import { computeStaffingGaps, coverageByTarget, publishedByDateRole } from '../staffingGaps';

const templates = [
  { id: 'am', role: 'Barista' },
  { id: 'pm', role: 'Barista' },
  { id: 'cook', role: 'Cook' },
];

const shift = (date: string, templateId: string, status: 'Draft' | 'Published' = 'Published') => ({ date, templateId, status });

describe('publishedByDateRole', () => {
  it('counts one person per published row, per date and role, across templates of the role', () => {
    const counts = publishedByDateRole(
      [shift('2026-12-01', 'am'), shift('2026-12-01', 'pm'), shift('2026-12-01', 'cook'), shift('2026-12-01', 'am', 'Draft'), shift('2026-12-02', 'am')],
      templates,
    );
    expect(Object.fromEntries(counts)).toEqual({
      '2026-12-01::Barista': 2,
      '2026-12-01::Cook': 1,
      '2026-12-02::Barista': 1,
    });
  });

  it('ignores a row whose template is unknown (deleted, or not loaded)', () => {
    expect(Object.fromEntries(publishedByDateRole([shift('2026-12-01', 'gone')], templates))).toEqual({});
  });
});

describe('computeStaffingGaps', () => {
  it('reports open positions for stored overrides only, never below zero', () => {
    const gaps = computeStaffingGaps(
      [
        { date: '2026-12-01', role: 'Barista', required: 3, source: 'override' }, // 2 published → 1 open
        { date: '2026-12-01', role: 'Cook', required: 1, source: 'override' }, // 1 published → covered
        { date: '2026-12-02', role: 'Barista', required: 0, source: 'override' }, // over-staffed → no gap, not -1
        { date: '2026-12-03', role: 'Barista', required: 5, source: 'model' }, // in-memory forecast → ignored
      ],
      [shift('2026-12-01', 'am'), shift('2026-12-01', 'pm'), shift('2026-12-01', 'cook'), shift('2026-12-02', 'am')],
      templates,
    );
    expect(gaps.map(({ date, role, scheduled, gap }) => ({ date, role, scheduled, gap }))).toEqual([
      { date: '2026-12-01', role: 'Barista', scheduled: 2, gap: 1 },
    ]);
  });

  it('does not count drafts or template coverage as people', () => {
    const gaps = computeStaffingGaps(
      [{ date: '2026-12-01', role: 'Barista', required: 2 }],
      [shift('2026-12-01', 'am', 'Draft'), shift('2026-12-01', 'am', 'Draft')],
      [{ id: 'am', role: 'Barista' }],
    );
    expect(gaps.map((g) => [g.scheduled, g.gap])).toEqual([[0, 2]]);
  });

  it('a gap on one day is not hidden by extra people on another', () => {
    const gaps = computeStaffingGaps(
      [
        { date: '2026-12-01', role: 'Barista', required: 1 },
        { date: '2026-12-02', role: 'Barista', required: 1 },
      ],
      [shift('2026-12-01', 'am'), shift('2026-12-01', 'pm')],
      templates,
    );
    expect(gaps.map((g) => g.date)).toEqual(['2026-12-02']);
  });
});

describe('coverageByTarget', () => {
  it('keeps covered targets too, so Analytics can sum filled positions (capped at required)', () => {
    const rows = coverageByTarget(
      [
        { date: '2026-12-01', role: 'Barista', required: 1 },
        { date: '2026-12-02', role: 'Barista', required: 2 },
      ],
      [shift('2026-12-01', 'am'), shift('2026-12-01', 'pm'), shift('2026-12-02', 'am')],
      templates,
    );
    // Filled: min(1, 2) + min(2, 1) = 2 of 3.
    expect(rows.reduce((sum, r) => sum + r.required - r.gap, 0)).toBe(2);
  });
});
