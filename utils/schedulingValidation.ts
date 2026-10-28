/**
 * Validation for the scheduling records the secure proxy stores: workers,
 * weekly availability, shift templates, roster shifts and demand overrides.
 * Shared by the client hooks (checked before the optimistic update) and the
 * proxy (checked again before any query), like utils/workerLaborValidation.ts.
 *
 * Every validator reads named fields from the payload and returns a new,
 * explicit object: unknown fields are dropped, so a client cannot write a
 * column (account_id, created_at, …) by adding it to the body.
 */
import { isDateKey } from '@/utils/dateKeys';
import { validateWorkerLabor, type WorkerLaborAttributes } from '@/utils/workerLaborValidation';

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

export const NAME_MAX = 100;
export const ROLE_MAX = 100;
export const SKILL_MAX = 100;
export const SKILLS_MAX = 50;
export const LOCATION_MAX = 200;
export const NOTES_MAX = 500;
export const COVERAGE_MAX = 500;
export const REQUIRED_MAX = 10_000;

export const DAYS_OF_WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export type DayOfWeek = (typeof DAYS_OF_WEEK)[number];
export type ShiftStatus = 'Draft' | 'Published';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_PATTERN.test(v);

/** A random v4 UUID (crypto.randomUUID when the runtime has it). The proxy refuses other ids. */
export const newUuid = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16));
  hex[12] = '4';
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const s = hex.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
};

export const isHHMM = (v: unknown): v is string => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
export const isDayOfWeek = (v: unknown): v is DayOfWeek => DAYS_OF_WEEK.includes(v as DayOfWeek);
export const isShiftStatus = (v: unknown): v is ShiftStatus => v === 'Draft' || v === 'Published';

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim().length > 0 && v.trim().length <= max;
const fail = (error: string) => ({ ok: false as const, error });

/** `id` absent → undefined (the server inserts); present → must be a UUID. */
const readId = (raw: Record<string, unknown>): { ok: true; id: string | undefined } | { ok: false; error: string } => {
  if (raw.id === undefined) return { ok: true, id: undefined };
  return isUuid(raw.id) ? { ok: true, id: raw.id } : fail('id must be a UUID');
};

// ─── Workers ─────────────────────────────────────────────────────────────────

export type WorkerInput = { id?: string; name: string; role: string; skills: string[] } & Partial<WorkerLaborAttributes>;

export const validateWorkerInput = (raw: unknown, today?: string): ValidationResult<WorkerInput> => {
  if (!isRecord(raw)) return fail('worker is required');
  const id = readId(raw);
  if (!id.ok) return id;
  if (!isText(raw.name, NAME_MAX)) return fail(`name is required (max ${NAME_MAX} chars)`);
  if (!isText(raw.role, ROLE_MAX)) return fail(`role is required (max ${ROLE_MAX} chars)`);
  const skills = raw.skills === undefined ? [] : raw.skills;
  if (!Array.isArray(skills) || skills.length > SKILLS_MAX || !skills.every((s) => isText(s, SKILL_MAX))) {
    return fail(`skills must be up to ${SKILLS_MAX} short strings`);
  }
  // Labor attributes: absent fields stay absent (an update keeps what is stored).
  const labor = validateWorkerLabor(raw, today);
  if (!labor.ok) return fail(labor.error);
  return {
    ok: true,
    value: {
      ...(id.id !== undefined ? { id: id.id } : {}),
      name: raw.name.trim(),
      role: raw.role.trim(),
      skills: (skills as string[]).map((s) => s.trim()),
      ...labor.values,
    },
  };
};

// ─── Availability ────────────────────────────────────────────────────────────

export type AvailabilityInput = { id?: string; workerId: string; dayOfWeek: DayOfWeek; fromTime: string; toTime: string };

/** An earlier end time means the window ends the next day; equal times are refused. */
export const validateAvailabilityInput = (raw: unknown): ValidationResult<AvailabilityInput> => {
  if (!isRecord(raw)) return fail('availability is required');
  const id = readId(raw);
  if (!id.ok) return id;
  if (!isUuid(raw.workerId)) return fail('workerId must be a UUID');
  if (!isDayOfWeek(raw.dayOfWeek)) return fail('dayOfWeek must be Mon–Sun');
  if (!isHHMM(raw.fromTime)) return fail('fromTime must be HH:MM');
  if (!isHHMM(raw.toTime)) return fail('toTime must be HH:MM');
  if (raw.fromTime === raw.toTime) return fail('fromTime and toTime must differ');
  return {
    ok: true,
    value: {
      ...(id.id !== undefined ? { id: id.id } : {}),
      workerId: raw.workerId,
      dayOfWeek: raw.dayOfWeek,
      fromTime: raw.fromTime,
      toTime: raw.toTime,
    },
  };
};

// ─── Shift templates ─────────────────────────────────────────────────────────

export type ShiftTemplateInput = { id?: string; name: string; role: string; startTime: string; endTime: string; coverage: number };

/** An earlier end time is an overnight shift; equal times are refused. */
export const validateShiftTemplateInput = (raw: unknown): ValidationResult<ShiftTemplateInput> => {
  if (!isRecord(raw)) return fail('template is required');
  const id = readId(raw);
  if (!id.ok) return id;
  if (!isText(raw.name, NAME_MAX)) return fail(`name is required (max ${NAME_MAX} chars)`);
  if (!isText(raw.role, ROLE_MAX)) return fail(`role is required (max ${ROLE_MAX} chars)`);
  if (!isHHMM(raw.startTime)) return fail('startTime must be HH:MM');
  if (!isHHMM(raw.endTime)) return fail('endTime must be HH:MM');
  if (raw.startTime === raw.endTime) return fail('startTime and endTime must differ');
  if (!Number.isInteger(raw.coverage) || (raw.coverage as number) < 1 || (raw.coverage as number) > COVERAGE_MAX) {
    return fail(`coverage must be an integer between 1 and ${COVERAGE_MAX}`);
  }
  return {
    ok: true,
    value: {
      ...(id.id !== undefined ? { id: id.id } : {}),
      name: raw.name.trim(),
      role: raw.role.trim(),
      startTime: raw.startTime,
      endTime: raw.endTime,
      coverage: raw.coverage as number,
    },
  };
};

// ─── Roster shifts ───────────────────────────────────────────────────────────

export type RosterShiftInput = {
  id?: string;
  date: string;
  workerId: string;
  templateId: string;
  location: string;
  status: ShiftStatus;
  notified: boolean;
};

/**
 * A shift can only be marked notified once it is published; status and
 * notified default to Draft / false.
 */
export const validateRosterShiftInput = (raw: unknown): ValidationResult<RosterShiftInput> => {
  if (!isRecord(raw)) return fail('shift is required');
  const id = readId(raw);
  if (!id.ok) return id;
  if (typeof raw.date !== 'string' || !isDateKey(raw.date)) return fail('date must be a real YYYY-MM-DD date');
  if (!isUuid(raw.workerId)) return fail('workerId must be a UUID');
  if (!isUuid(raw.templateId)) return fail('templateId must be a UUID');
  if (raw.status !== undefined && !isShiftStatus(raw.status)) return fail('status must be Draft or Published');
  if (raw.notified !== undefined && typeof raw.notified !== 'boolean') return fail('notified must be true or false');
  if (raw.location !== undefined && raw.location !== null && typeof raw.location !== 'string') return fail('location must be a string');
  const location = typeof raw.location === 'string' ? raw.location.trim() : '';
  if (location.length > LOCATION_MAX) return fail(`location must be at most ${LOCATION_MAX} chars`);
  const status: ShiftStatus = raw.status ?? 'Draft';
  const notified = raw.notified === true;
  if (notified && status !== 'Published') return fail('only a published shift can be notified');
  return {
    ok: true,
    value: {
      ...(id.id !== undefined ? { id: id.id } : {}),
      date: raw.date,
      workerId: raw.workerId,
      templateId: raw.templateId,
      location,
      status,
      notified,
    },
  };
};

// ─── Demand overrides ────────────────────────────────────────────────────────

export type DemandTargetKey = { date: string; role: string };
export type DemandTargetInput = DemandTargetKey & {
  required: number;
  notes: string | null;
  confidence: number | null;
  lowerBound: number | null;
  upperBound: number | null;
};

export const validateDemandTargetKey = (raw: unknown): ValidationResult<DemandTargetKey> => {
  if (!isRecord(raw)) return fail('target is required');
  if (typeof raw.date !== 'string' || !isDateKey(raw.date)) return fail('date must be a real YYYY-MM-DD date');
  if (!isText(raw.role, ROLE_MAX)) return fail(`role is required (max ${ROLE_MAX} chars)`);
  return { ok: true, value: { date: raw.date, role: raw.role.trim() } };
};

const optionalNumber = (v: unknown, min: number, max: number): number | null | undefined => {
  if (v === undefined || v === null) return null;
  const n = Number(v);
  return typeof v === 'number' && Number.isFinite(n) && n >= min && n <= max ? n : undefined;
};

/** A manual demand override for one date and role (source is always 'override'). */
export const validateDemandTargetInput = (raw: unknown): ValidationResult<DemandTargetInput> => {
  const key = validateDemandTargetKey(raw);
  if (!key.ok) return key;
  const t = raw as Record<string, unknown>;
  const required = typeof t.required === 'number' ? t.required : typeof t.required === 'string' && t.required.trim() ? Number(t.required) : NaN;
  if (!Number.isFinite(required) || required < 0 || required > REQUIRED_MAX) {
    return fail(`required must be a number between 0 and ${REQUIRED_MAX}`);
  }
  if (t.notes !== undefined && t.notes !== null && typeof t.notes !== 'string') return fail('notes must be a string');
  const notes = typeof t.notes === 'string' && t.notes.trim() ? t.notes.trim() : null;
  if (notes && notes.length > NOTES_MAX) return fail(`notes must be at most ${NOTES_MAX} chars`);
  const confidence = optionalNumber(t.confidence, 0, 1);
  if (confidence === undefined) return fail('confidence must be a number from 0 to 1');
  const lowerBound = optionalNumber(t.lowerBound, 0, REQUIRED_MAX);
  const upperBound = optionalNumber(t.upperBound, 0, REQUIRED_MAX);
  if (lowerBound === undefined || upperBound === undefined) return fail(`bounds must be numbers between 0 and ${REQUIRED_MAX}`);
  if (lowerBound !== null && upperBound !== null && lowerBound > upperBound) return fail('lowerBound must not exceed upperBound');
  return { ok: true, value: { ...key.value, required: Math.round(required), notes, confidence, lowerBound, upperBound } };
};
