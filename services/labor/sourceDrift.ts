/**
 * Checks that find labor-rule data likely to have drifted from the law
 * (CHG-103). Pure functions over the packs; `scripts/labor/drift.ts` runs
 * them on a schedule and the pack integrity tests run the structural ones on
 * every push.
 *
 * Why these checks: the packs went stale three times in a month (Brazil
 * EC 141/2026, Mexico's 2026 LFT reform, Canadian provinces resolving to the
 * federal code). Each time the code was internally consistent and every test
 * passed; only a person re-reading the sources noticed. The monitor cannot
 * read the law, so it asks a person to, at the moments drift is most likely:
 * when a pack has not been checked for a quarter, and just before a phased
 * value takes effect (a reform can be postponed, struck down or amended
 * between publication and its start date).
 */
import { isDateKey } from '@/utils/dateKeys';
import { PACK_REVIEWS, PHASE_CONFIRMATIONS, type PhaseConfirmation } from './sourceReview';
import type { Cite, DateKey, RulePack } from './types';

/** Re-check a pack at least once a quarter. */
export const REVIEW_MAX_AGE_DAYS = 90;
/** Ask for a confirmation this long before a dated value starts. */
export const UPCOMING_PHASE_DAYS = 60;

export type DatedEntryRef = { pack: string; path: string; index: number; from: DateKey; value: unknown };
export type CiteRef = { pack: string; path: string; cite: Cite };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A `Dated<T>` array: every element is `{ from, value }`. */
export const isDatedArray = (v: unknown): v is { from: DateKey; value: unknown }[] =>
  Array.isArray(v) && v.length > 0 && v.every((e) => isRecord(e) && 'from' in e && 'value' in e && Object.keys(e).length === 2);

const isCite = (v: unknown): v is Cite => isRecord(v) && typeof v.source === 'string' && 'confidence' in v;

/** Every dated entry and every cite in a pack, with the path to it. */
export function walkPack(code: string, pack: RulePack): { dated: DatedEntryRef[][]; cites: CiteRef[] } {
  const dated: DatedEntryRef[][] = [];
  const cites: CiteRef[] = [];
  const visit = (v: unknown, path: string) => {
    if (isDatedArray(v)) {
      dated.push(v.map((e, index) => ({ pack: code, path, index, from: e.from, value: e.value })));
      return;
    }
    if (Array.isArray(v)) return v.forEach((x, i) => visit(x, `${path}[${i}]`));
    if (!isRecord(v)) return;
    if (isCite(v)) cites.push({ pack: code, path, cite: v });
    for (const [k, x] of Object.entries(v)) visit(x, path ? `${path}.${k}` : k);
  };
  visit(pack, '');
  return { dated, cites };
}

const shapeOf = (v: unknown): string =>
  Array.isArray(v) ? `array(${v.length})` : isRecord(v) ? `object{${Object.keys(v).sort().join(',')}}` : typeof v;

/**
 * Structural problems of one dated value. `resolveDated` takes the last entry
 * whose `from` is on or before the date, so entries out of order or with an
 * impossible date silently pick the wrong value.
 */
export function datedProblems(entries: DatedEntryRef[]): string[] {
  const problems: string[] = [];
  entries.forEach((e, i) => {
    const where = `${e.pack} › ${e.path}[${i}]`;
    if (!isDateKey(e.from)) problems.push(`${where}: from "${e.from}" is not a real calendar date (YYYY-MM-DD).`);
    const prev = entries[i - 1];
    if (prev && !(prev.from < e.from)) {
      problems.push(`${where}: from ${e.from} is not after the previous entry's ${prev.from}. Keep entries in date order with one entry per date; resolveDated takes the last entry with from ≤ the date.`);
    }
    if (prev && shapeOf(prev.value) !== shapeOf(e.value)) {
      problems.push(`${where}: value has shape ${shapeOf(e.value)}, the previous entry has ${shapeOf(prev.value)}. Every phase of a rule must have the same shape.`);
    }
  });
  return problems;
}

/** Problems of one cite: no source text, a link that is not https, an unknown confidence. */
export function citeProblems({ pack, path, cite }: CiteRef): string[] {
  const where = `${pack} › ${path}`;
  const problems: string[] = [];
  if (!cite.source.trim()) problems.push(`${where}: the cite has no source text.`);
  if (!['high', 'medium', 'low'].includes(cite.confidence)) problems.push(`${where}: confidence "${String(cite.confidence)}" is not high, medium or low.`);
  if (cite.url !== undefined) {
    let url: URL | null = null;
    try {
      url = new URL(cite.url);
    } catch {
      url = null;
    }
    if (!url || url.protocol !== 'https:' || /\s/.test(cite.url)) problems.push(`${where}: url ${JSON.stringify(cite.url)} is not a valid https link.`);
  }
  return problems;
}

const daysBetween = (a: DateKey, b: DateKey) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export type DriftReport = {
  /** Packs not re-checked within REVIEW_MAX_AGE_DAYS, or with no review record. */
  dueForReview: string[];
  /** Dated values that take effect within UPCOMING_PHASE_DAYS. */
  upcomingPhases: string[];
  /** High-confidence cites without a link: nothing for the monitor to check. */
  unlinkedHighConfidence: string[];
};

const isConfirmed = (e: DatedEntryRef, confirmations: readonly PhaseConfirmation[]) =>
  confirmations.some((c) => c.pack === e.pack && c.path === e.path && c.from === e.from &&
    daysBetween(c.confirmedOn, e.from) >= 0 && daysBetween(c.confirmedOn, e.from) <= UPCOMING_PHASE_DAYS);

/** The time-dependent part of the monitor, with `today` passed in so it is testable. */
export function driftReport(
  packs: Readonly<Record<string, RulePack>>,
  today: DateKey,
  confirmations: readonly PhaseConfirmation[] = PHASE_CONFIRMATIONS,
): DriftReport {
  const dueForReview: string[] = [];
  const upcomingPhases: string[] = [];
  const unlinkedHighConfidence: string[] = [];
  for (const [code, pack] of Object.entries(packs)) {
    const review = PACK_REVIEWS[code];
    if (!review) dueForReview.push(`${code}: no entry in services/labor/sourceReview.ts. Check its sources and add one.`);
    else {
      const age = daysBetween(review.reviewedOn, today);
      if (age > REVIEW_MAX_AGE_DAYS) dueForReview.push(`${code}: last checked ${review.reviewedOn} (${age} days ago, limit ${REVIEW_MAX_AGE_DAYS}) by ${review.record}. Re-read its primary sources and update the entry.`);
    }
    const { dated, cites } = walkPack(code, pack);
    for (const entries of dated) {
      for (const e of entries) {
        const until = daysBetween(today, e.from);
        if (until >= 0 && until <= UPCOMING_PHASE_DAYS && !isConfirmed(e, confirmations)) {
          upcomingPhases.push(`${code} › ${e.path}: ${JSON.stringify(e.value)} from ${e.from} (in ${until} days). Confirm the change is still in force as published (not postponed, suspended or amended), then add it to PHASE_CONFIRMATIONS in services/labor/sourceReview.ts.`);
        }
      }
    }
    for (const c of cites) {
      if (c.cite.confidence === 'high' && !c.cite.url) unlinkedHighConfidence.push(`${code} › ${c.path} (${c.cite.source})`);
    }
  }
  return { dueForReview, upcomingPhases, unlinkedHighConfidence };
}

export type LinkStatus = 'ok' | 'blocked' | 'dead' | 'unreachable';

/**
 * How to read a link check. Government sites often refuse automated
 * clients (401, 403, 429) or time out; that says nothing about the page, so
 * only 404 and 410 count as dead. A dead link is drift: the law moved or was
 * replaced.
 */
export const classifyLink = (status: number | null): LinkStatus => {
  if (status === null) return 'unreachable';
  if (status === 404 || status === 410) return 'dead';
  if (status >= 200 && status < 400) return 'ok';
  return 'blocked';
};
