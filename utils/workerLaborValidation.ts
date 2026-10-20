/**
 * Validation for the labor attributes of a worker (shared by the worker form
 * and the secure proxy). The labor engine reads them as `LaborWorker`.
 */

export const MIN_WORKER_AGE = 13;
const EARLIEST_BIRTH_DATE = '1900-01-01';

export type WorkerLaborAttributes = {
  /** 'YYYY-MM-DD', or null when unknown. */
  birthDate: string | null;
  nightWorker: boolean;
  weeklyLimitOptOut: boolean;
  noFixedHours: boolean;
};

export type WorkerLaborErrorCode = 'BIRTH_DATE_INVALID' | 'BIRTH_DATE_FUTURE' | 'BIRTH_DATE_TOO_YOUNG' | 'FLAG_INVALID';

export const WORKER_LABOR_ERROR_MESSAGES: Record<WorkerLaborErrorCode, string> = {
  BIRTH_DATE_INVALID: 'birthDate must be a real date (YYYY-MM-DD)',
  BIRTH_DATE_FUTURE: 'birthDate must be in the past',
  BIRTH_DATE_TOO_YOUNG: `the worker must be at least ${MIN_WORKER_AGE} years old`,
  FLAG_INVALID: 'nightWorker, weeklyLimitOptOut and noFixedHours must be true or false',
};

/** True for a 'YYYY-MM-DD' that names a real calendar day (no 2026-02-30). */
export const isRealDateKey = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
};

/** Today's date in UTC as 'YYYY-MM-DD' (the server has no business zone for a birthday). */
const utcTodayKey = (): string => new Date().toISOString().slice(0, 10);

/**
 * Checks a birth date: a real date, before today, and at least
 * MIN_WORKER_AGE years before today. A 29 February birthday counts as reached
 * on 1 March in non-leap years.
 */
export const validateBirthDate = (value: string, today: string = utcTodayKey()): WorkerLaborErrorCode | null => {
  if (!isRealDateKey(value) || value < EARLIEST_BIRTH_DATE) return 'BIRTH_DATE_INVALID';
  if (value >= today) return 'BIRTH_DATE_FUTURE';
  const birthdayAtMinAge = `${String(Number(value.slice(0, 4)) + MIN_WORKER_AGE).padStart(4, '0')}${value.slice(4)}`;
  if (birthdayAtMinAge > today) return 'BIRTH_DATE_TOO_YOUNG';
  return null;
};

/**
 * Reads the labor attributes from a worker payload. Absent fields are left
 * out of `values` (an update keeps what is stored); `birthDate: null` or ''
 * clears the stored date.
 */
export const validateWorkerLabor = (
  worker: Record<string, unknown>,
  today?: string,
):
  | { ok: true; values: Partial<WorkerLaborAttributes> }
  | { ok: false; code: WorkerLaborErrorCode; error: string } => {
  const values: Partial<WorkerLaborAttributes> = {};
  const failWith = (code: WorkerLaborErrorCode) => ({ ok: false as const, code, error: WORKER_LABOR_ERROR_MESSAGES[code] });

  if (worker.birthDate !== undefined) {
    if (worker.birthDate === null || worker.birthDate === '') {
      values.birthDate = null;
    } else if (typeof worker.birthDate !== 'string') {
      return failWith('BIRTH_DATE_INVALID');
    } else {
      const code = validateBirthDate(worker.birthDate, today);
      if (code) return failWith(code);
      values.birthDate = worker.birthDate;
    }
  }

  for (const key of ['nightWorker', 'weeklyLimitOptOut', 'noFixedHours'] as const) {
    const flag = worker[key];
    if (flag === undefined) continue;
    if (typeof flag !== 'boolean') return failWith('FLAG_INVALID');
    values[key] = flag;
  }

  return { ok: true, values };
};
