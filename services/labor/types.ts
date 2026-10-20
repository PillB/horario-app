/**
 * Types for the labor-rule engine.
 *
 * A rule pack is data: limits, premiums and windows for one jurisdiction, each
 * with its legal source and a confidence level. Packs chain from broad to
 * specific (US → US-CA → US-CA-BERKELEY); a child's sections replace the
 * parent's, so a child only states what it changes.
 *
 * Times inside packs are local wall-clock "HH:MM" in the location's IANA zone.
 * Shifts are absolute instants, so every duration is elapsed time (a night
 * shift across a DST change is 7 or 9 hours, not 8).
 */
import type { JurisdictionCode } from './jurisdictions';

/** 'YYYY-MM-DD' */
export type DateKey = string;
/** 'HH:MM' local wall clock */
export type HHMM = string;

export type Confidence = 'high' | 'medium' | 'low';

export type Cite = { source: string; url?: string; confidence: Confidence };

/** A value that changes on known dates; the last entry with from ≤ date applies. */
export type Dated<T> = T | { from: DateKey; value: T }[];

/**
 * - violation: the schedule breaks the rule; block or fix it.
 * - premium: allowed, but costs extra pay (overtime, night, clopening pay).
 * - warning: advisory (unverified or soft rule); show it, don't block.
 * - refusable: legal to post, but the employee may refuse the shift.
 * - review: the engine can't decide from the inputs; a person must check.
 */
export type Verdict = 'violation' | 'premium' | 'warning' | 'refusable' | 'review';

export type Industry =
  | 'retail' | 'food_service' | 'fast_food' | 'full_service_restaurant' | 'hospitality'
  | 'hotel' | 'warehouse' | 'manufacturing' | 'healthcare' | 'building_services' | 'other';

// ─── Rule sections ───────────────────────────────────────────────────────────

export type RestRule = {
  minHours: Dated<number>;
  /** Default 'violation'. Peru has no statutory minimum, so its rule is a warning. */
  verdict?: 'violation' | 'warning';
  /** Ontario: the 8 h rule does not apply when the two shifts total ≤ 13 h. */
  exemptIfPairTotalHoursLte?: number;
  /** Ontario: the separate 11 h-per-day rule depends on the employer's "day". */
  dailyRestReviewHours?: number;
  /** Netherlands: longer rest after a night duty that ends after a set time. */
  afterNightDuty?: { endsAfter: HHMM; minHours: number };
  cite: Cite;
};

export type ClopeningPremium =
  | { kind: 'flat'; amount: number }
  | { kind: 'hoursInsideGap'; multiplier: number }
  | { kind: 'wholeShift'; multiplier: number }
  | { kind: 'unknown' };

/** Fair-workweek "right to rest" between a closing and the next opening shift. */
export type ClopeningRule = {
  minHours: number;
  /** Working inside the window needs the employee's (written) consent. */
  consentRequired: boolean;
  premium: ClopeningPremium;
  industries?: Industry[];
  cite: Cite;
};

export type NoticeRule = {
  /** Minimum time between posting the schedule and a shift's start. */
  hours: number;
  verdict: 'violation' | 'refusable';
  /** Ireland: applies only to workers without fixed hours. */
  onlyNoFixedHours?: boolean;
  industries?: Industry[];
  cite: Cite;
};

export type ShiftKindLimits = { day: number; night: number; mixed: number };

export type DailyOrdinaryRule = {
  hours: Dated<number | ShiftKindLimits>;
  /**
   * What hours above the limit are when the employer did not mark them as
   * overtime: 'violation' (Spain, Chile: ordinary time may not exceed it) or
   * 'overtime' (they are paid as overtime and count toward overtime caps).
   */
  excess: 'violation' | 'overtime';
  cite: Cite;
};

/** Mexico (LFT 60): day / night / mixed shift by how much falls in the night window. */
export type ShiftClassification = {
  night: [HHMM, HHMM];
  /** A shift with both parts is "mixed" when its night part is under this many hours. */
  mixedIfNightHoursLt: number;
};

export type HoursCap = { hours: number; cite: Cite };

export type AverageRule = {
  hours: number;
  weeks: number;
  /** An individual written opt-out lifts the limit (UK, EU art. 22). */
  optOutAllowed?: boolean;
  cite: Cite;
};

export type NightRule = {
  window: Dated<[HHMM, HHMM]>;
  /** Premium shown on findings, e.g. 35 = +35%. */
  premiumPct?: number;
  /** Brazil: a legal night hour is 52.5 minutes, so night time counts for more. */
  hourMinutes?: number;
  cite: Cite;
};

/** Netherlands: a "nachtdienst" has more than N hours of work in the window. */
export type NightDutyRule = {
  window: [HHMM, HHMM];
  moreThanHours: number;
  maxHours?: number;
  cite: Cite;
};

export type NightWorkerRule = {
  /** Average hours per 24 h over the reference period. */
  averageDailyHours: number;
  referenceDays: number;
  /** Night limits cannot be opted out of (UK). */
  noOvertime?: boolean;
  cite: Cite;
};

export type BreakTrigger = {
  /** Required when worked hours exceed this (or reach it, when inclusive). */
  afterHours: number;
  inclusive?: boolean;
  minMinutes: number;
};

export type BreakRule = {
  triggers: BreakTrigger[];
  /** Pieces shorter than this don't count (Germany, Netherlands: 15 min). */
  minBlockMinutes?: number;
  verdict?: 'violation' | 'warning';
  cite: Cite;
};

/** California: a 30 min meal must start before the end of the 5th hour of work. */
export type MealDeadlineRule = {
  byWorkHours: number;
  minMinutes: number;
  /** A mutual waiver is valid only when the day is no longer than this. */
  waivableIfWorkHoursLte: number;
  premiumHours: number;
  cite: Cite;
};

export type OvertimeBand = { after: number; multiplier: number };

export type OvertimePayRule = {
  weekly?: OvertimeBand;
  daily?: OvertimeBand[];
  /** California: the 7th consecutive day worked in a workweek. */
  seventhDay?: { first8: number; after8: number };
  cite: Cite;
};

export type WeeklyRestRule = { minHours: number; verdict?: 'violation' | 'warning'; cite: Cite };

export type SpreadOfHoursRule = { overHours: number; premiumHours: number; cite: Cite };

export type TimeWindow = [HHMM, HHMM];

export type MinorRule = {
  ageFrom: number;
  ageTo: number;
  /** Only workers still in compulsory schooling (Quebec). */
  onlyInCompulsorySchooling?: boolean;
  maxDailyHours?: number;
  maxWeeklyHours?: number;
  schoolDayMaxHours?: number;
  nonSchoolDayMaxHours?: number;
  schoolWeekMaxHours?: number;
  nonSchoolWeekMaxHours?: number;
  /** Quebec: hours Monday to Friday in a school week. */
  schoolWeekWeekdayMaxHours?: number;
  /** Work must fall inside this window. */
  allowedWindow?: TimeWindow;
  /** FLSA: a later end from June 1 to Labor Day. */
  summerAllowedWindow?: TimeWindow;
  /** A wider window for some industries (Germany: 16+ in hospitality until 22:00). */
  industryAllowedWindows?: { industries: Industry[]; window: TimeWindow }[];
  /** Work must not touch these windows. */
  bannedWindows?: TimeWindow[];
  /** Used instead of the first banned window when the contract moves it (UK 23:00–07:00). */
  alternativeBannedWindow?: TimeWindow;
  minRestHours?: number;
  /** Consecutive hours off within each workweek (Spain: 2 days). */
  weeklyRestHours?: number;
  breaks?: BreakTrigger[];
  noOvertime?: boolean;
  cite: Cite;
};

export type RulePack = {
  code: JurisdictionCode;
  currency: string;
  /** Packs that are only a floor or a guess say so on every evaluation. */
  baselineOnly?: string;
  restBetweenShifts?: RestRule;
  /** Netherlands: shifts with a gap shorter than this are one duty (dienst). */
  dutyMergeGapHours?: number;
  dailyOrdinaryMax?: DailyOrdinaryRule;
  shiftClassification?: ShiftClassification;
  dailyOvertimeMax?: HoursCap;
  dailyTotalMax?: HoursCap & { verdict?: 'violation' | 'warning' };
  weeklyOrdinaryMax?: { hours: Dated<number>; cite: Cite };
  weeklyMax?: HoursCap & { verdict?: 'violation' | 'warning' };
  averageWeeklyMax?: AverageRule[];
  weeklyRest?: WeeklyRestRule;
  night?: NightRule;
  nightDuty?: NightDutyRule;
  nightWorker?: NightWorkerRule;
  breaks?: BreakRule;
  mealDeadline?: MealDeadlineRule;
  overtimePay?: OvertimePayRule;
  spreadOfHours?: SpreadOfHoursRule;
  notice?: NoticeRule;
  /** Gated on the location being covered (industry and size thresholds). */
  fairWorkweek?: { clopening?: ClopeningRule; notice?: NoticeRule; coverage: string };
  minors?: MinorRule[];
  /** Australia: overnight shifts across a DST change are paid by the clock. */
  payByClock?: boolean;
};

// ─── Engine inputs and outputs ───────────────────────────────────────────────

export type Interval = { start: number; end: number };

export type LaborShift = {
  id: string;
  /** Epoch ms (absolute instants). */
  start: number;
  end: number;
  /** Unpaid breaks taken inside the shift. */
  breaks?: Interval[];
  /** Hours the employer schedules as overtime rather than ordinary time. */
  overtimeHours?: number;
  /** The employee agreed (in writing where required) to a short rest before this shift. */
  restConsent?: boolean;
  /** California mutual meal waiver for this shift. */
  mealWaiver?: boolean;
};

export type LaborWorker = {
  id: string;
  birthDate?: DateKey;
  nightWorker?: boolean;
  /** Signed opt-out from the average weekly limit (UK / EU art. 22). */
  weeklyLimitOptOut?: boolean;
  /** No fixed hours in the contract (Ireland s.17 notice). */
  noFixedHours?: boolean;
  /** Contract moves the young-worker night period (UK 23:00–07:00). */
  minorAlternativeNightPeriod?: boolean;
  inCompulsorySchooling?: boolean;
};

export type EvaluationContext = {
  jurisdiction: JurisdictionCode;
  timeZone: string;
  industry?: Industry;
  /** Whether the location meets the fair-workweek coverage thresholds; undefined = unknown. */
  fairWorkweekCovered?: boolean;
  /** Local dates that are school days, for minors. */
  schoolDays?: DateKey[];
  /** When the schedule was posted to the employee (epoch ms). */
  publishedAt?: number;
  /** First day of the workweek: 0 = Sunday … 6 = Saturday. Default Monday. */
  weekStartsOn?: number;
};

export type Finding = {
  rule: string;
  verdict: Verdict;
  jurisdiction: JurisdictionCode;
  workerId: string;
  shiftIds: string[];
  message: string;
  hours?: number;
  multiplier?: number;
  amount?: { value: number; currency: string };
  cite?: Cite;
};

export type PayBreakdown = {
  regularHours: number;
  overtime: { multiplier: number; hours: number }[];
};

export type EvaluationResult = {
  findings: Finding[];
  pay: PayBreakdown;
};
