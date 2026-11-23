/**
 * Posting habit (CHG-105): how many recent weeks had their schedule out ahead.
 *
 * The habit is the one research ties to worker well-being and to sales:
 * schedules known in advance (Schneider & Harknett, ASR 2019; the Gap stable
 * scheduling experiment, Williams, Lambert & Kesavan 2018). It is measured
 * from stored data only (roster.published_at, set by the database), never from
 * a button the manager presses.
 *
 * Design choices (see Claude_changes.md CHG-105 for the red team):
 * - One unit per week, not per day: a schedule is made weekly, so a daily
 *   streak would reward opening the app, not the habit.
 * - A week counts when at least POSTED_SHARE of its shifts were published by
 *   the deadline. Later additions and swaps are normal and must not undo it.
 * - Weeks with no shifts (closed, holidays) are skipped: they neither count nor
 *   break the run.
 * - The run is shown next to "N of the last M weeks", which a single late week
 *   barely moves (broken streaks lower persistence: Silverman & Barasch, JCR 2022).
 */
import { addDaysToKey, daysBetweenKeys, toDateKey, weekdayOfKey } from '@/utils/dateKeys';
import { resolvePack } from '@/services/labor/engine';
import type { Industry } from '@/services/labor/types';

/** Default goal when the law asks for less (or nothing): one week ahead. */
export const DEFAULT_NOTICE_DAYS = 7;
/** Share of a week's shifts that must be out by the deadline. */
export const POSTED_SHARE = 0.9;
/** Weeks shown and counted. */
export const HABIT_WEEKS = 8;

export type HabitShift = {
  date: string;
  status: 'Draft' | 'Published';
  publishedAt?: string | null;
};

/**
 * ahead: posted by the deadline (or already, before it).
 * late: the deadline passed without it.
 * open: the deadline has not passed and it is not posted yet.
 * empty: no shifts that week (skipped).
 */
export type WeekVerdict = 'ahead' | 'late' | 'open' | 'empty';

export type HabitWeek = {
  /** Monday of the week (YYYY-MM-DD). */
  weekStart: string;
  /** Last day on which publishing still counts as ahead. */
  deadline: string;
  shifts: number;
  postedByDeadline: number;
  verdict: WeekVerdict;
};

export type PostingHabit = {
  noticeDays: number;
  /** Oldest first; the last entries can be open. */
  weeks: HabitWeek[];
  /** Consecutive ahead weeks, newest decided week backwards (open and empty skipped). */
  run: number;
  /** Longest run inside the shown weeks. */
  bestRun: number;
  aheadWeeks: number;
  /** Weeks that are decided and not empty. */
  decidedWeeks: number;
};

/** Monday on or before the date. */
export const mondayOf = (key: string): string => addDaysToKey(key, -((weekdayOfKey(key) + 6) % 7));

/** Roster dates to load for {@link computePostingHabit}. */
export const habitWindow = (today: string, noticeDays: number, weeks = HABIT_WEEKS) => {
  const thisMonday = mondayOf(today);
  return {
    fromDate: addDaysToKey(thisMonday, -7 * (weeks - 1)),
    // Every week whose deadline is today or earlier, plus the next open one.
    toDate: addDaysToKey(mondayOf(addDaysToKey(today, noticeDays)), 13),
  };
};

const publishedOn = (iso: string, timeZone?: string): string | null => {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? toDateKey(d, timeZone) : null;
};

const groupByWeek = (shifts: readonly HabitShift[], fromDate: string, toDate: string) => {
  const byWeek = new Map<string, HabitShift[]>();
  for (const s of shifts) {
    if (s.date < fromDate || s.date > toDate) continue;
    const key = mondayOf(s.date);
    const list = byWeek.get(key);
    if (list) list.push(s); else byWeek.set(key, [s]);
  }
  return byWeek;
};

/** Shifts published (status and time) on or before the deadline day, in the business zone. */
export const countPostedBy = (list: readonly HabitShift[], deadline: string, timeZone?: string): number =>
  list.filter((s) => {
    if (s.status !== 'Published' || !s.publishedAt) return false;
    const day = publishedOn(s.publishedAt, timeZone);
    return day !== null && day <= deadline;
  }).length;

/** The verdict of one week; `decided` = its deadline has passed. */
export const weekVerdict = (shifts: number, posted: number, decided: boolean): WeekVerdict => {
  if (shifts > 0 && posted / shifts >= POSTED_SHARE) return 'ahead';
  if (!decided) return 'open';
  return shifts === 0 ? 'empty' : 'late';
};

/** Consecutive ahead weeks from the newest decided week back; open and empty weeks are skipped. */
export const currentRun = (weeks: readonly HabitWeek[]): number => {
  let run = 0;
  for (let i = weeks.length - 1; i >= 0; i--) {
    const v = weeks[i].verdict;
    if (v === 'late') break;
    if (v === 'ahead') run++;
  }
  return run;
};

/** Longest run of ahead weeks; empty and open weeks do not break it. */
export const bestRunOf = (weeks: readonly HabitWeek[]): number => {
  let best = 0;
  let current = 0;
  for (const w of weeks) {
    if (w.verdict === 'ahead') best = Math.max(best, ++current);
    else if (w.verdict === 'late') current = 0;
  }
  return best;
};

export function computePostingHabit(
  shifts: readonly HabitShift[],
  opts: { today: string; noticeDays?: number; weeks?: number; timeZone?: string },
): PostingHabit {
  const noticeDays = Math.max(0, Math.round(opts.noticeDays ?? DEFAULT_NOTICE_DAYS));
  const { fromDate, toDate } = habitWindow(opts.today, noticeDays, opts.weeks ?? HABIT_WEEKS);
  const byWeek = groupByWeek(shifts, fromDate, toDate);

  const weeks: HabitWeek[] = [];
  let openShown = false;
  for (let monday = fromDate; monday <= toDate; monday = addDaysToKey(monday, 7)) {
    const deadline = addDaysToKey(monday, -noticeDays);
    const list = byWeek.get(monday) ?? [];
    const posted = countPostedBy(list, deadline, opts.timeZone);
    const verdict = weekVerdict(list.length, posted, daysBetweenKeys(deadline, opts.today) > 0);
    // Only one open week is shown: the next one to post.
    if (verdict === 'open') {
      if (openShown) break;
      openShown = true;
    }
    weeks.push({ weekStart: monday, deadline, shifts: list.length, postedByDeadline: posted, verdict });
  }

  const counted = weeks.filter((w) => w.verdict === 'ahead' || w.verdict === 'late');
  return {
    noticeDays,
    weeks,
    run: currentRun(weeks),
    bestRun: bestRunOf(weeks),
    aheadWeeks: counted.filter((w) => w.verdict === 'ahead').length,
    decidedWeeks: counted.length,
  };
}

export type NoticeGoal = {
  days: number;
  /** The law's own minimum, when one applies to every location of the account. */
  lawDays: number | null;
  /** A longer notice that applies only if a fair-workweek law covers the business. */
  ifCoveredDays: number | null;
};

const daysOf = (hours: number) => Math.ceil(hours / 24);

/**
 * The goal for the posting habit: one week, or the law's notice when longer.
 * With several locations the strictest wins. A fair-workweek notice whose
 * coverage the app cannot tell (size, chain) is reported apart, not imposed.
 */
export function noticeGoalFor(locations: readonly { jurisdictionCode: string; industry?: Industry | null }[]): NoticeGoal {
  let lawDays: number | null = null;
  let ifCoveredDays: number | null = null;
  for (const loc of locations) {
    let pack;
    try { pack = resolvePack(loc.jurisdictionCode); } catch { continue; }
    const applies = (rule?: { industries?: Industry[] }) =>
      !!rule && (!rule.industries || (!!loc.industry && rule.industries.includes(loc.industry)));
    if (pack.notice && applies(pack.notice) && !pack.notice.onlyNoFixedHours) {
      lawDays = Math.max(lawDays ?? 0, daysOf(pack.notice.hours));
    }
    const fww = pack.fairWorkweek?.notice;
    if (fww && applies(fww)) ifCoveredDays = Math.max(ifCoveredDays ?? 0, daysOf(fww.hours));
  }
  const days = Math.max(DEFAULT_NOTICE_DAYS, lawDays ?? 0);
  return { days, lawDays, ifCoveredDays: ifCoveredDays !== null && ifCoveredDays > days ? ifCoveredDays : null };
}
