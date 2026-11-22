/**
 * Structural checks of every real rule pack (CHG-103), so a reform added in
 * a hurry cannot silently pick the wrong value, and every pack is shown to
 * evaluate on every date its rules change and far into the future.
 *
 * These tests do not say the law is right (only the golden-file oracles and
 * a person reading the source can); they say the data is usable as law
 * data: real dates in order, cites a person can follow, a review record for
 * the drift monitor, and an engine that gives sane findings on every phase.
 */
import { addDaysToKey, isDateKey } from '@/utils/dateKeys';
import { zoneFitsCountry } from '@/utils/locationValidation';
import { zonedShiftSpan } from '@/utils/zonedTime';
import { evaluateShifts, resolvePack } from '../engine';
import { getJurisdiction, JURISDICTIONS } from '../jurisdictions';
import { PACKS } from '../packs';
import { citeProblems, datedProblems, walkPack } from '../sourceDrift';
import { PACK_REVIEWS } from '../sourceReview';
import type { Finding, LaborShift } from '../types';

const CODES = Object.keys(PACKS);

/**
 * High-confidence cites that have no link yet (2026-11-21). A link is how the
 * drift monitor notices a moved or replaced law, so the list may only shrink:
 * a new high-confidence cite needs a url.
 */
const UNLINKED_HIGH_CONFIDENCE = new Set([
  'US-WA-SEATTLE › fairWorkweek.notice.cite', 'US-PA-PHILADELPHIA › fairWorkweek.notice.cite', 'US-CA-LA › fairWorkweek.notice.cite',
  'US-CA-BERKELEY › fairWorkweek.notice.cite', 'US-CA-EMERYVILLE › fairWorkweek.notice.cite',
  'CA › breaks.cite', 'CA › weeklyMax.cite', 'CA › overtimePay.cite', 'CA › notice.cite', 'CA › weeklyRest.cite',
  'CA-ON › breaks.cite', 'CA-ON › weeklyMax.cite', 'CA-ON › overtimePay.cite', 'CA-ON › weeklyRest.cite',
  'PE › dailyOrdinaryMax.cite', 'PE › weeklyOrdinaryMax.cite', 'MX › dailyTotalMax.cite', 'MX › breaks.cite', 'MX › weeklyRest.cite',
  'CL › breaks.cite', 'BR › dailyOrdinaryMax.cite', 'BR › dailyOvertimeMax.cite', 'BR › breaks.cite', 'BR › night.cite', 'BR › weeklyRest.cite',
  'FR › weeklyOrdinaryMax.cite', 'PL › dailyOrdinaryMax.cite', 'PL › weeklyOrdinaryMax.cite', 'PL › weeklyRest.cite', 'PL › breaks.cite',
  'PL › notice.cite', 'PL › minors[0].cite',
]);

describe('rule packs: data integrity', () => {
  it('every pack is filed under its own code and names a known jurisdiction', () => {
    const wrong = CODES.filter((c) => PACKS[c].code !== c || !getJurisdiction(c)).map((c) => `${c} (code ${PACKS[c].code}, known: ${Boolean(getJurisdiction(c))})`);
    expect(wrong).toEqual([]);
  });

  it('every jurisdiction a user can pick resolves to a pack, and its suggested zone passes the location validator', () => {
    const problems: string[] = [];
    for (const j of JURISDICTIONS) {
      try {
        resolvePack(j.code);
      } catch (e) {
        problems.push(`${j.code}: resolvePack throws ${(e as Error).message}`);
      }
      if (j.timeZone && j.country && !zoneFitsCountry(j.timeZone, j.country)) {
        problems.push(`${j.code}: suggested zone ${j.timeZone} is refused for country ${j.country}, so the setup card would suggest a zone it cannot save`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('dated values (phased reforms) use real dates, in order, one phase per date, one shape', () => {
    const problems = CODES.flatMap((c) => walkPack(c, PACKS[c]).dated.flatMap(datedProblems));
    expect(problems).toEqual([]);
  });

  it('every cite has source text, a known confidence, and an https link when it has one', () => {
    const problems = CODES.flatMap((c) => walkPack(c, PACKS[c]).cites.flatMap(citeProblems));
    expect(problems).toEqual([]);
  });

  it('no new high-confidence cite without a link; the known gaps only shrink', () => {
    const unlinked = CODES.flatMap((c) => walkPack(c, PACKS[c]).cites.filter((r) => r.cite.confidence === 'high' && !r.cite.url).map((r) => `${r.pack} › ${r.path}`));
    const added = unlinked.filter((k) => !UNLINKED_HIGH_CONFIDENCE.has(k)).map((k) => `${k}: high confidence needs a url to the primary source`);
    const fixed = [...UNLINKED_HIGH_CONFIDENCE].filter((k) => !unlinked.includes(k)).map((k) => `${k}: has a link now (or moved); remove it from UNLINKED_HIGH_CONFIDENCE`);
    expect([...added, ...fixed]).toEqual([]);
  });

  it('every pack has a review record for the drift monitor, dated on a real day not in the future', () => {
    const today = new Date().toISOString().slice(0, 10);
    const problems = [
      ...CODES.filter((c) => !PACK_REVIEWS[c]).map((c) => `${c}: no entry in services/labor/sourceReview.ts`),
      ...Object.keys(PACK_REVIEWS).filter((c) => !PACKS[c]).map((c) => `${c}: review record for a pack that does not exist`),
      ...Object.entries(PACK_REVIEWS)
        .filter(([, r]) => !isDateKey(r.reviewedOn) || r.reviewedOn > today || !r.record.trim())
        .map(([c, r]) => `${c}: review record ${JSON.stringify(r)} needs a real past date and the name of the record`),
    ];
    expect(problems).toEqual([]);
  });
});

// ─── Every pack on every date its rules change ───────────────────────────────

const FAR_FUTURE = '2035-06-04';
const zoneOf = (code: string) => getJurisdiction(code)?.timeZone ?? (code === 'EU' ? 'Europe/Brussels' : 'America/Lima');

/** Each date a rule of the pack's chain changes, the day before it, and a date far ahead. */
const phaseDates = (code: string): string[] => {
  const resolved = resolvePack(code);
  const dates = new Set<string>([FAR_FUTURE]);
  for (const entries of walkPack(code, resolved).dated) {
    for (const e of entries.slice(1)) {
      dates.add(e.from);
      dates.add(addDaysToKey(e.from, -1));
    }
  }
  return [...dates].sort();
};

/** A heavy but ordinary week: six 9.5 h days with a short break, then a night shift. */
const week = (code: string, start: string): LaborShift[] => {
  const tz = zoneOf(code);
  const day = (i: number, from: string, to: string, br?: [string, string]): LaborShift => {
    const date = addDaysToKey(start, i);
    const span = zonedShiftSpan(date, from, to, tz);
    return { id: `${code}-${start}-${i}`, start: span.start, end: span.end, breaks: br ? [zonedShiftSpan(date, br[0], br[1], tz)] : [] };
  };
  return [0, 1, 2, 3, 4, 5].map((i) => day(i, '08:00', '17:30', ['12:00', '12:15'])).concat(day(6, '22:00', '06:00'));
};

const VERDICTS = new Set(['violation', 'premium', 'warning', 'refusable', 'review']);
const findingProblems = (f: Finding): string[] => {
  const p: string[] = [];
  if (!VERDICTS.has(f.verdict)) p.push(`unknown verdict ${f.verdict}`);
  if (typeof f.message !== 'string' || !f.message.trim()) p.push('empty message');
  else if (/\b(NaN|undefined|null|Infinity)\b|\[object Object\]/.test(f.message)) p.push(`message shows a broken value: "${f.message}"`);
  if (f.hours !== undefined && !Number.isFinite(f.hours)) p.push(`hours ${f.hours}`);
  if (f.amount && !Number.isFinite(f.amount.value)) p.push(`amount ${f.amount.value}`);
  if (f.cite && !f.cite.source.trim()) p.push('cite without source');
  return p.map((x) => `${f.rule}: ${x}`);
};

describe('rule packs: every pack evaluates on every phase date', () => {
  it.each(JURISDICTIONS.map((j) => j.code))('%s gives sane findings and pay for an adult and a 15-year-old on each date its rules change', (code) => {
    const problems: string[] = [];
    for (const date of phaseDates(code)) {
      const adultBirth = `${Number(date.slice(0, 4)) - 30}-01-15`;
      const minorBirth = `${Number(date.slice(0, 4)) - 15}-01-15`;
      for (const [who, birthDate] of [['adult', adultBirth], ['minor', minorBirth]] as const) {
        try {
          const r = evaluateShifts({ jurisdiction: code, timeZone: zoneOf(code), fairWorkweekCovered: true }, { id: 'w', birthDate }, week(code, date));
          for (const f of r.findings) for (const p of findingProblems(f)) problems.push(`${date} ${who}: ${p}`);
          const hours = [r.pay.regularHours, ...r.pay.overtime.map((o) => o.hours)];
          if (!hours.every((h) => Number.isFinite(h) && h >= 0)) problems.push(`${date} ${who}: pay hours ${JSON.stringify(r.pay)}`);
        } catch (e) {
          problems.push(`${date} ${who}: evaluateShifts threw ${(e as Error).stack?.split('\n').slice(0, 2).join(' ')}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
