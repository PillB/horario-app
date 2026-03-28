/**
 * rosterService.ts
 *
 * Client-side service for all roster-related CRUD operations.
 * All writes are routed through the secure proxy (app/api/secure-proxy/route.ts)
 * which uses the Supabase service-role key. Reads use the same proxy so that
 * account_id scoping is enforced server-side.
 *
 * Pattern mirrors services/demandForecast.ts.
 */

const SECURE_PROXY_URL = process.env.EXPO_PUBLIC_SECURE_PROXY_URL ?? '/api/secure-proxy';

// ─── Domain types (DB-aligned) ────────────────────────────────────────────────

export type DayOfWeek = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';

export type DbWorker = {
  id: string;
  accountId: string;
  name: string;
  role: string;
  skills: string[];
  createdAt?: string;
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

// ─── Internal helpers ─────────────────────────────────────────────────────────

const proxyPost = async <T>(body: Record<string, unknown>): Promise<T> => {
  const response = await fetch(SECURE_PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error((payload as { error?: string }).error ?? `Proxy responded with ${response.status}`);
  }

  return (await response.json()) as T;
};

// ─── Workers ─────────────────────────────────────────────────────────────────

export const listWorkers = async (accountId: string): Promise<DbWorker[]> => {
  try {
    const result = await proxyPost<{ workers: DbWorker[] }>({ action: 'listWorkers', accountId });
    return result.workers ?? [];
  } catch (err) {
    console.warn('Unable to list workers', err);
    return [];
  }
};

export const upsertWorker = async (worker: DbWorker): Promise<UpsertWorkerResult> => {
  try {
    const result = await proxyPost<{ success: boolean; worker: DbWorker; error?: string }>(
      { action: 'upsertWorker', worker }
    );
    if (!result.success) {
      return { success: false, error: result.error ?? 'Unable to save worker' };
    }
    return { success: true, worker: result.worker };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unable to save worker';
    console.warn('Unable to upsert worker', err);
    return { success: false, error };
  }
};

export const deleteWorker = async (id: string): Promise<MutationResult> => {
  try {
    const result = await proxyPost<{ success: boolean; error?: string }>(
      { action: 'deleteWorker', id }
    );
    if (!result.success) {
      return { success: false, error: result.error ?? 'Unable to delete worker' };
    }
    return { success: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unable to delete worker';
    console.warn('Unable to delete worker', err);
    return { success: false, error };
  }
};

// ─── Worker Availability ──────────────────────────────────────────────────────

export const listWorkerAvailability = async (accountId: string): Promise<DbAvailability[]> => {
  try {
    const result = await proxyPost<{ availabilities: DbAvailability[] }>({
      action: 'listWorkerAvailability',
      accountId,
    });
    return result.availabilities ?? [];
  } catch (err) {
    console.warn('Unable to list worker availability', err);
    return [];
  }
};

export const upsertAvailability = async (availability: DbAvailability): Promise<UpsertAvailabilityResult> => {
  try {
    const result = await proxyPost<{ success: boolean; availability: DbAvailability; error?: string }>(
      { action: 'upsertAvailability', availability }
    );
    if (!result.success) {
      return { success: false, error: result.error ?? 'Unable to save availability' };
    }
    return { success: true, availability: result.availability };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unable to save availability';
    console.warn('Unable to upsert availability', err);
    return { success: false, error };
  }
};

export const deleteAvailability = async (id: string): Promise<MutationResult> => {
  try {
    const result = await proxyPost<{ success: boolean; error?: string }>(
      { action: 'deleteAvailability', id }
    );
    if (!result.success) {
      return { success: false, error: result.error ?? 'Unable to delete availability' };
    }
    return { success: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unable to delete availability';
    console.warn('Unable to delete availability', err);
    return { success: false, error };
  }
};

// ─── Shift Templates ──────────────────────────────────────────────────────────

export const listShiftTemplates = async (accountId: string): Promise<DbShiftTemplate[]> => {
  try {
    const result = await proxyPost<{ templates: DbShiftTemplate[] }>(
      { action: 'listShiftTemplates', accountId }
    );
    return result.templates ?? [];
  } catch (err) {
    console.warn('Unable to list shift templates', err);
    return [];
  }
};

export const upsertShiftTemplate = async (template: DbShiftTemplate): Promise<UpsertTemplateResult> => {
  try {
    const result = await proxyPost<{ success: boolean; template: DbShiftTemplate; error?: string }>(
      { action: 'upsertShiftTemplate', template }
    );
    if (!result.success) {
      return { success: false, error: result.error ?? 'Unable to save template' };
    }
    return { success: true, template: result.template };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unable to save template';
    console.warn('Unable to upsert shift template', err);
    return { success: false, error };
  }
};

export const deleteShiftTemplate = async (id: string): Promise<MutationResult> => {
  try {
    const result = await proxyPost<{ success: boolean; error?: string }>(
      { action: 'deleteShiftTemplate', id }
    );
    if (!result.success) {
      return { success: false, error: result.error ?? 'Unable to delete template' };
    }
    return { success: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unable to delete template';
    console.warn('Unable to delete shift template', err);
    return { success: false, error };
  }
};

// ─── Roster ───────────────────────────────────────────────────────────────────

export type RosterFilters = {
  fromDate?: string;
  toDate?: string;
};

export const listRoster = async (
  accountId: string,
  filters?: RosterFilters
): Promise<DbRosterShift[]> => {
  try {
    const result = await proxyPost<{ shifts: DbRosterShift[] }>({
      action: 'listRoster',
      accountId,
      ...filters,
    });
    return result.shifts ?? [];
  } catch (err) {
    console.warn('Unable to list roster', err);
    return [];
  }
};

export const upsertRosterShift = async (shift: DbRosterShift): Promise<UpsertRosterShiftResult> => {
  try {
    const result = await proxyPost<{ success: boolean; shift: DbRosterShift; error?: string }>(
      { action: 'upsertRosterShift', shift }
    );
    if (!result.success) {
      return { success: false, error: result.error ?? 'Unable to save shift' };
    }
    return { success: true, shift: result.shift };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unable to save shift';
    console.warn('Unable to upsert roster shift', err);
    return { success: false, error };
  }
};

export const updateShiftStatus = async (
  id: string,
  status: 'Draft' | 'Published'
): Promise<MutationResult> => {
  try {
    const result = await proxyPost<{ success: boolean; error?: string }>(
      { action: 'updateShiftStatus', id, status }
    );
    if (!result.success) {
      return { success: false, error: result.error ?? 'Unable to update shift status' };
    }
    return { success: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unable to update shift status';
    console.warn('Unable to update shift status', err);
    return { success: false, error };
  }
};

export const markShiftNotified = async (id: string): Promise<MutationResult> => {
  try {
    const result = await proxyPost<{ success: boolean; error?: string }>(
      { action: 'markShiftNotified', id }
    );
    if (!result.success) {
      return { success: false, error: result.error ?? 'Unable to mark shift notified' };
    }
    return { success: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unable to mark shift notified';
    console.warn('Unable to mark shift notified', err);
    return { success: false, error };
  }
};

export const deleteRosterShift = async (id: string): Promise<MutationResult> => {
  try {
    const result = await proxyPost<{ success: boolean; error?: string }>(
      { action: 'deleteRosterShift', id }
    );
    if (!result.success) {
      return { success: false, error: result.error ?? 'Unable to delete shift' };
    }
    return { success: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unable to delete shift';
    console.warn('Unable to delete roster shift', err);
    return { success: false, error };
  }
};
