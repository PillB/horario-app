/**
 * rosterService.ts
 *
 * Client-side service for workers, availability, shift templates and roster
 * shifts. Every call goes through the secure proxy (app/api/secure-proxy+api.ts),
 * which takes the tenant from the signed-in session and scopes every
 * statement by it; the `accountId` arguments only exist for older callers.
 *
 * Lists are paged by the proxy (LIST_PAGE_SIZE rows, `hasMore`); the
 * `fetch*` functions read every page up to LIST_MAX_PAGES and say whether
 * rows were left out. They return `{ ok: false, error }` instead of an empty
 * list when the request fails, so a screen can tell "nothing saved yet" from
 * "could not load". The older `list*` functions keep returning [] on failure.
 */

import { getSessionToken } from '@/services/authToken';

const SECURE_PROXY_URL = process.env.EXPO_PUBLIC_SECURE_PROXY_URL ?? '/api/secure-proxy';

/** Must match LIST_MAX_PAGES in the proxy. */
export const LIST_MAX_PAGES = 20;

// ─── Domain types (DB-aligned) ────────────────────────────────────────────────

export type DayOfWeek = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';

export type DbWorker = {
  id: string;
  accountId: string;
  name: string;
  role: string;
  skills: string[];
  /** Labor attributes (CHG-082); absent on rows from an older proxy. */
  birthDate?: string | null;
  nightWorker?: boolean;
  weeklyLimitOptOut?: boolean;
  noFixedHours?: boolean;
  createdAt?: string;
  /** As the server sent it; passed back unchanged as `ifUpdatedAt` by an edit. */
  updatedAt?: string;
};

export type DbAvailability = {
  id: string;
  accountId: string;
  workerId: string;
  dayOfWeek: DayOfWeek;
  fromTime: string;
  toTime: string;
};

export type DbShiftTemplate = {
  id: string;
  accountId: string;
  name: string;
  role: string;
  startTime: string;
  endTime: string;
  coverage: number;
  createdAt?: string;
  /** As the server sent it; passed back unchanged as `ifUpdatedAt` by an edit. */
  updatedAt?: string;
};

export type DbRosterShift = {
  id: string;
  accountId: string;
  date: string;
  workerId: string;
  templateId: string;
  location: string;
  status: 'Draft' | 'Published';
  notified: boolean;
  createdAt?: string;
  updatedAt?: string;
};

// ─── Result types ─────────────────────────────────────────────────────────────

export type ListResult<T> =
  | { ok: true; data: T[]; truncated: boolean; error?: never }
  | { ok: false; data?: never; truncated?: never; error: string };

export type UpsertWorkerResult =
  | { success: true; worker: DbWorker; error?: never }
  | { success: false; worker?: never; error: string };

export type UpsertAvailabilityResult =
  | { success: true; availability: DbAvailability; error?: never }
  | { success: false; availability?: never; error: string };

export type UpsertTemplateResult =
  | { success: true; template: DbShiftTemplate; error?: never }
  | { success: false; template?: never; error: string };

export type UpsertRosterShiftResult =
  | { success: true; shift: DbRosterShift; error?: never }
  | { success: false; shift?: never; error: string };

export type MutationResult =
  | { success: true; error?: never }
  | { success: false; error: string };

/** Status / notified changes return the stored shift (absent from an older proxy). */
export type ShiftUpdateResult =
  | { success: true; shift?: DbRosterShift; error?: never }
  | { success: false; shift?: never; error: string };

// ─── Internal helpers ─────────────────────────────────────────────────────────

const proxyPost = async <T>(body: Record<string, unknown>): Promise<T> => {
  const token = await getSessionToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const response = await fetch(SECURE_PROXY_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    if (payload?.error) throw new Error(payload.error);
    // No JSON body: the route itself is missing (not deployed, or no migrations).
    if (response.status === 404) {
      throw new Error('Service unavailable. Please check your connection or run database migrations.');
    }
    throw new Error(`Server error (${response.status})`);
  }

  return (await response.json()) as T;
};

const messageOf = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

/** Runs a write; a thrown error or `success: false` becomes `{ success: false, error }`. */
const mutate = async <T extends Record<string, unknown>>(
  body: Record<string, unknown>,
  fallback: string,
): Promise<({ success: true } & T) | { success: false; error: string }> => {
  try {
    const result = await proxyPost<{ success?: boolean; error?: string } & T>(body);
    if (!result.success) return { success: false, error: result.error ?? fallback };
    return { ...result, success: true };
  } catch (err) {
    console.warn(fallback, err);
    return { success: false, error: messageOf(err, fallback) };
  }
};

type Page<T> = { hasMore?: boolean } & Record<string, unknown> & { [key: string]: T[] | unknown };

/** Reads pages 0, 1, … of a list action until `hasMore` is false or LIST_MAX_PAGES is reached. */
const fetchAllPages = async <T>(
  action: string,
  key: string,
  extra: Record<string, unknown> = {},
): Promise<ListResult<T>> => {
  const rows: T[] = [];
  try {
    for (let page = 0; page < LIST_MAX_PAGES; page += 1) {
      const result = await proxyPost<Page<T>>({ action, ...extra, page });
      const pageRows = result[key];
      rows.push(...(Array.isArray(pageRows) ? (pageRows as T[]) : []));
      if (result.hasMore !== true) return { ok: true, data: rows, truncated: false };
    }
    return { ok: true, data: rows, truncated: true };
  } catch (err) {
    console.warn(`Unable to ${action}`, err);
    return { ok: false, error: messageOf(err, `Unable to ${action}`) };
  }
};

const orEmpty = <T>(result: ListResult<T>): T[] => (result.ok ? result.data : []);

// ─── Workers ─────────────────────────────────────────────────────────────────

export const fetchWorkers = (): Promise<ListResult<DbWorker>> => fetchAllPages<DbWorker>('listWorkers', 'workers');

/** @deprecated returns [] on failure; use fetchWorkers. */
export const listWorkers = async (_accountId?: string): Promise<DbWorker[]> => orEmpty(await fetchWorkers());

/**
 * `ifUpdatedAt` is the row's `updatedAt` as it was read: the server then saves
 * only while the row is still that (409 when someone changed it, 404 when it
 * was deleted).
 */
export const upsertWorker = async (worker: Partial<DbWorker> & Pick<DbWorker, 'name' | 'role'>, ifUpdatedAt?: string): Promise<UpsertWorkerResult> => {
  const { id, name, role, skills, birthDate, nightWorker, weeklyLimitOptOut, noFixedHours } = worker;
  const result = await mutate<{ worker: DbWorker }>(
    { action: 'upsertWorker', worker: { id, name, role, skills, birthDate, nightWorker, weeklyLimitOptOut, noFixedHours }, ...(ifUpdatedAt ? { ifUpdatedAt } : {}) },
    'Unable to save worker',
  );
  return result.success ? { success: true, worker: result.worker } : result;
};

/**
 * Adds several people in one request: all of them or none. Each carries its
 * own id, and the server leaves a person whose id is already stored as is, so
 * the same import can be sent again safely.
 */
export const importWorkers = async (
  workers: (Pick<DbWorker, 'id' | 'name' | 'role'> & { skills: string[] })[],
): Promise<{ success: true; added: number; workers: DbWorker[] } | { success: false; error: string }> => {
  const result = await mutate<{ added?: number; workers?: DbWorker[] }>({ action: 'importWorkers', workers }, 'Unable to import the team');
  return result.success ? { success: true, added: result.added ?? 0, workers: result.workers ?? [] } : result;
};

export const deleteWorker = async (id: string): Promise<MutationResult> => {
  const result = await mutate({ action: 'deleteWorker', id }, 'Unable to delete worker');
  return result.success ? { success: true } : result;
};

// ─── Worker Availability ──────────────────────────────────────────────────────

export const fetchWorkerAvailability = (): Promise<ListResult<DbAvailability>> =>
  fetchAllPages<DbAvailability>('listWorkerAvailability', 'availabilities');

/** @deprecated returns [] on failure; use fetchWorkerAvailability. */
export const listWorkerAvailability = async (_accountId?: string): Promise<DbAvailability[]> =>
  orEmpty(await fetchWorkerAvailability());

export const upsertAvailability = async (
  availability: Omit<DbAvailability, 'accountId' | 'id'> & { id?: string; accountId?: string },
): Promise<UpsertAvailabilityResult> => {
  const { id, workerId, dayOfWeek, fromTime, toTime } = availability;
  const result = await mutate<{ availability: DbAvailability }>(
    { action: 'upsertAvailability', availability: { id, workerId, dayOfWeek, fromTime, toTime } },
    'Unable to save availability',
  );
  return result.success ? { success: true, availability: result.availability } : result;
};

export const deleteAvailability = async (id: string): Promise<MutationResult> => {
  const result = await mutate({ action: 'deleteAvailability', id }, 'Unable to delete availability');
  return result.success ? { success: true } : result;
};

// ─── Days off ─────────────────────────────────────────────────────────────────

export type DbTimeOff = { id: string; accountId: string; workerId: string; date: string; reason: string; createdAt?: string };

export type UpsertTimeOffResult =
  | { success: true; timeOff: DbTimeOff; error?: never }
  | { success: false; timeOff?: never; error: string };

/** Every stored day off, or only those on `date`. */
export const fetchTimeOff = (date?: string): Promise<ListResult<DbTimeOff>> =>
  fetchAllPages<DbTimeOff>('listTimeOff', 'timeOff', date ? { date } : {});

export const upsertTimeOff = async (timeOff: { workerId: string; date: string; reason: string }): Promise<UpsertTimeOffResult> => {
  const result = await mutate<{ timeOff?: DbTimeOff }>({ action: 'upsertTimeOff', timeOff }, 'Unable to save the day off');
  if (!result.success) return result;
  return result.timeOff ? { success: true, timeOff: result.timeOff } : { success: false, error: 'Unable to save the day off' };
};

export const deleteTimeOff = async (id: string): Promise<MutationResult> => {
  const result = await mutate({ action: 'deleteTimeOff', id }, 'Unable to remove the day off');
  return result.success ? { success: true } : result;
};

// ─── Shift Templates ──────────────────────────────────────────────────────────

export const fetchShiftTemplates = (): Promise<ListResult<DbShiftTemplate>> =>
  fetchAllPages<DbShiftTemplate>('listShiftTemplates', 'templates');

/** @deprecated returns [] on failure; use fetchShiftTemplates. */
export const listShiftTemplates = async (_accountId?: string): Promise<DbShiftTemplate[]> =>
  orEmpty(await fetchShiftTemplates());

export const upsertShiftTemplate = async (
  template: Omit<DbShiftTemplate, 'accountId' | 'id'> & { id?: string; accountId?: string },
  /** See upsertWorker. */
  ifUpdatedAt?: string,
): Promise<UpsertTemplateResult> => {
  const { id, name, role, startTime, endTime, coverage } = template;
  const result = await mutate<{ template: DbShiftTemplate }>(
    { action: 'upsertShiftTemplate', template: { id, name, role, startTime, endTime, coverage }, ...(ifUpdatedAt ? { ifUpdatedAt } : {}) },
    'Unable to save template',
  );
  return result.success ? { success: true, template: result.template } : result;
};

export const deleteShiftTemplate = async (id: string): Promise<MutationResult> => {
  const result = await mutate({ action: 'deleteShiftTemplate', id }, 'Unable to delete template');
  return result.success ? { success: true } : result;
};

// ─── Roster ───────────────────────────────────────────────────────────────────

export type RosterFilters = {
  fromDate?: string;
  toDate?: string;
};

export const fetchRoster = (filters?: RosterFilters): Promise<ListResult<DbRosterShift>> =>
  fetchAllPages<DbRosterShift>('listRoster', 'shifts', {
    ...(filters?.fromDate ? { fromDate: filters.fromDate } : {}),
    ...(filters?.toDate ? { toDate: filters.toDate } : {}),
  });

/** @deprecated returns [] on failure; use fetchRoster. */
export const listRoster = async (_accountId?: string, filters?: RosterFilters): Promise<DbRosterShift[]> =>
  orEmpty(await fetchRoster(filters));

export const upsertRosterShift = async (
  shift: Omit<DbRosterShift, 'accountId' | 'id'> & { id?: string; accountId?: string },
): Promise<UpsertRosterShiftResult> => {
  const { id, date, workerId, templateId, location, status, notified } = shift;
  const result = await mutate<{ shift: DbRosterShift }>(
    { action: 'upsertRosterShift', shift: { id, date, workerId, templateId, location, status, notified } },
    'Unable to save shift',
  );
  return result.success ? { success: true, shift: result.shift } : result;
};

/** Adds several new shifts in one request: all of them or none. Each carries its own id. */
export const addRosterShifts = async (
  shifts: (Pick<DbRosterShift, 'id' | 'date' | 'workerId' | 'templateId' | 'status'> & { location?: string | null })[],
): Promise<{ success: true; shifts: DbRosterShift[] } | { success: false; error: string }> => {
  const result = await mutate<{ shifts?: DbRosterShift[] }>({ action: 'addRosterShifts', shifts }, 'Unable to save the shifts');
  return result.success ? { success: true, shifts: result.shifts ?? [] } : result;
};

/** Changing the status clears `notified` on the server too. */
export const updateShiftStatus = async (id: string, status: 'Draft' | 'Published'): Promise<ShiftUpdateResult> => {
  const result = await mutate<{ shift?: DbRosterShift }>({ action: 'updateShiftStatus', id, status }, 'Unable to update shift status');
  return result.success ? { success: true, shift: result.shift } : result;
};

/** Refused (409) unless the shift is published. */
export const markShiftNotified = async (id: string): Promise<ShiftUpdateResult> => {
  const result = await mutate<{ shift?: DbRosterShift }>({ action: 'markShiftNotified', id }, 'Unable to mark shift notified');
  return result.success ? { success: true, shift: result.shift } : result;
};

export const deleteRosterShift = async (id: string): Promise<MutationResult> => {
  const result = await mutate({ action: 'deleteRosterShift', id }, 'Unable to delete shift');
  return result.success ? { success: true } : result;
};

// ── Shift messages ────────────────────────────────────────────────────────────

/** A message stored for the worker of one roster shift. `pending` = stored, not delivered. */
export type DbShiftMessage = {
  id: string;
  shiftId: string;
  workerId: string;
  channel: string;
  body: string;
  status: 'pending' | 'sent' | 'failed' | 'delivered';
  sentAt: string | null;
  createdAt: string;
};

export type SaveShiftMessageResult = { success: true; message: DbShiftMessage } | { success: false; error: string };

/** Stores a message for a roster shift (manager only). Nothing is delivered: no channel is connected. */
export const saveShiftMessage = async (shiftId: string, body: string): Promise<SaveShiftMessageResult> => {
  const result = await mutate<{ message?: DbShiftMessage }>({ action: 'sendShiftMessage', id: shiftId, body }, 'Unable to save the message');
  if (!result.success) return result;
  return result.message ? { success: true, message: result.message } : { success: false, error: 'Unable to save the message' };
};

/** The stored messages of one roster shift, newest first. */
export const fetchShiftMessages = async (shiftId: string): Promise<ListResult<DbShiftMessage>> => {
  try {
    const result = await proxyPost<{ messages?: DbShiftMessage[] }>({ action: 'listShiftMessages', id: shiftId });
    return { ok: true, data: result.messages ?? [], truncated: false };
  } catch (err) {
    return { ok: false, error: messageOf(err, 'Unable to load messages') };
  }
};
