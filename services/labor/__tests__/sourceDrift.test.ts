/**
 * The drift checks themselves (CHG-103), on small packs built here, so each
 * check is shown to catch the drift it exists for: a reform appended out of
 * order, an impossible start date, a phase about to start, a pack nobody
 * re-checked, a moved source page.
 */
import { citeProblems, classifyLink, datedProblems, driftReport, REVIEW_MAX_AGE_DAYS, UPCOMING_PHASE_DAYS, walkPack } from '../sourceDrift';
import { PACK_REVIEWS } from '../sourceReview';
import type { RulePack } from '../types';

const pack = (over: Partial<RulePack>): RulePack => ({ code: 'BR', currency: 'BRL', ...over });
const weekly = (entries: { from: string; value: number }[]) =>
  pack({ weeklyOrdinaryMax: { hours: entries, cite: { source: 'EC 141/2026', url: 'https://example.gov/ec141', confidence: 'high' } } });

describe('dated values', () => {
  it('finds a reform appended out of date order, which resolveDated would read wrongly', () => {
    const [entries] = walkPack('BR', weekly([{ from: '1988-10-05', value: 44 }, { from: '2027-12-16', value: 40 }, { from: '2026-12-16', value: 42 }])).dated;
    expect(datedProblems(entries)).toEqual([
      expect.stringMatching(/^BR › weeklyOrdinaryMax\.hours\[2\]: from 2026-12-16 is not after the previous entry's 2027-12-16/),
    ]);
  });

  it('finds two phases on the same date and a date that does not exist', () => {
    const [entries] = walkPack('BR', weekly([{ from: '2027-02-30', value: 44 }, { from: '2027-03-01', value: 42 }, { from: '2027-03-01', value: 40 }])).dated;
    const problems = datedProblems(entries);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain('from "2027-02-30" is not a real calendar date');
    expect(problems[1]).toContain('from 2027-03-01 is not after');
  });

  it('finds a phase whose value has another shape than the one before', () => {
    const p = pack({ night: { window: [{ from: '1970-01-01', value: ['21:00', '06:00'] }, { from: '2025-12-25', value: ['19:00'] as unknown as [string, string] }], cite: { source: 'x', confidence: 'high' } } });
    const [entries] = walkPack('CO', p).dated;
    expect(datedProblems(entries)).toEqual([expect.stringContaining('value has shape array(1), the previous entry has array(2)')]);
  });

  it('accepts phases in order', () => {
    const [entries] = walkPack('BR', weekly([{ from: '1988-10-05', value: 44 }, { from: '2026-12-16', value: 42 }])).dated;
    expect(datedProblems(entries)).toEqual([]);
  });
});

describe('cites', () => {
  const ref = (cite: Record<string, unknown>) => ({ pack: 'FR', path: 'restBetweenShifts.cite', cite: cite as never });
  it.each([
    ['a plain http link', { source: 'L3131-1', url: 'http://code.travail.gouv.fr/x', confidence: 'high' }, /is not a valid https link/],
    ['a link with a space', { source: 'L3131-1', url: 'https://code.travail.gouv.fr/a b', confidence: 'high' }, /is not a valid https link/],
    ['not a link', { source: 'L3131-1', url: 'code.travail.gouv.fr', confidence: 'high' }, /is not a valid https link/],
    ['an empty source', { source: '  ', confidence: 'low' }, /has no source text/],
    ['an unknown confidence', { source: 'L3131-1', confidence: 'certain' }, /confidence "certain"/],
  ])('rejects %s', (_label, cite, message) => {
    expect(citeProblems(ref(cite))).toEqual([expect.stringMatching(message)]);
  });
});

describe('drift report', () => {
  const PHASE = '2026-12-16';
  const br = { BR: weekly([{ from: '1988-10-05', value: 44 }, { from: PHASE, value: 42 }]) };

  it(`lists a phase from ${UPCOMING_PHASE_DAYS} days before it starts until its first day, and not outside that`, () => {
    const listed = (today: string) => driftReport(br, today, []).upcomingPhases;
    expect(listed('2026-10-16')).toEqual([]); // 61 days before
    expect(listed('2026-10-17')).toEqual([expect.stringContaining('42 from 2026-12-16 (in 60 days)')]);
    expect(listed('2026-11-21')).toEqual([expect.stringContaining('BR › weeklyOrdinaryMax.hours: 42 from 2026-12-16 (in 25 days)')]);
    expect(listed(PHASE)).toEqual([expect.stringContaining('(in 0 days)')]);
    expect(listed('2026-12-17')).toEqual([]);
  });

  it('stops asking once someone confirmed the phase close to its start, but not on an old confirmation', () => {
    const confirmed = (confirmedOn: string) =>
      driftReport(br, '2026-11-21', [{ pack: 'BR', path: 'weeklyOrdinaryMax.hours', from: PHASE, confirmedOn, record: 'qa/x.md' }]).upcomingPhases;
    expect(confirmed('2026-11-20')).toEqual([]);
    expect(confirmed('2026-10-16')).toHaveLength(1); // made before the window: the reform could have changed since
  });

  it(`flags a pack checked more than ${REVIEW_MAX_AGE_DAYS} days ago, and one with no review record`, () => {
    const reviewedOn = PACK_REVIEWS.BR.reviewedOn;
    const day = (offset: number) => new Date(Date.parse(`${reviewedOn}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
    expect(driftReport(br, day(REVIEW_MAX_AGE_DAYS), []).dueForReview).toEqual([]);
    expect(driftReport(br, day(REVIEW_MAX_AGE_DAYS + 1), []).dueForReview).toEqual([
      expect.stringContaining(`BR: last checked ${reviewedOn} (${REVIEW_MAX_AGE_DAYS + 1} days ago, limit ${REVIEW_MAX_AGE_DAYS})`),
    ]);
    expect(driftReport({ 'XX-NEW': pack({ code: 'XX-NEW' }) }, reviewedOn, []).dueForReview).toEqual([
      expect.stringContaining('XX-NEW: no entry in services/labor/sourceReview.ts'),
    ]);
  });
});

describe('link check', () => {
  it.each([
    [200, 'ok'], [301, 'ok'], [404, 'dead'], [410, 'dead'], [403, 'blocked'], [401, 'blocked'], [429, 'blocked'], [503, 'blocked'], [null, 'unreachable'],
  ] as const)('reads HTTP %s as %s (only 404 and 410 say the page is gone)', (status, kind) => {
    expect(classifyLink(status)).toBe(kind);
  });
});
