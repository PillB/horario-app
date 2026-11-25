/**
 * Shift templates, loaded from and saved through the secure proxy. Writes are
 * optimistic and roll back, returning the server's error, when the proxy
 * refuses them (CHG-088).
 */
import { useCallback } from 'react';

import { log } from '@/services/logger';
import {
  deleteShiftTemplate,
  fetchShiftTemplates,
  upsertShiftTemplate,
  type DbShiftTemplate,
  type MutationResult,
  type UpsertTemplateResult,
} from '@/services/rosterService';
import type { ShiftTemplate } from '@/utils/schedulerMetrics';
import { newUuid, validateShiftTemplateInput } from '@/utils/schedulingValidation';
import { judgeRefusedEdit, removeById, restoreAt, upsertById, usePersistedList, type LoadResult } from './usePersistedList';

const dbToTemplate = (db: Pick<DbShiftTemplate, 'id' | 'name' | 'role' | 'startTime' | 'endTime' | 'coverage' | 'updatedAt'>): ShiftTemplate => ({
  id: db.id,
  name: db.name,
  role: db.role,
  start: db.startTime,
  end: db.endTime,
  coverage: db.coverage,
  ...(db.updatedAt ? { updatedAt: db.updatedAt } : {}),
});

const loadTemplates = async (): Promise<LoadResult<ShiftTemplate>> => {
  const result = await fetchShiftTemplates();
  if (!result.ok) return result;
  log.debug('TEMPLATE', 'Templates loaded', { count: result.data.length });
  return { ok: true, data: result.data.map(dbToTemplate), truncated: result.truncated };
};

export type ShiftTemplateChanges = { name: string; role: string; startTime: string; endTime: string; coverage: number };

/** An edit's outcome; see UpdateWorkerResult in useWorkers. */
export type UpdateTemplateResult =
  | { success: true; alreadySaved?: boolean; error?: never }
  | { success: false; error: string; conflictUpdatedAt?: string };

/** `accountId` only names the tenant (a new one reloads); the proxy takes it from the session. */
export const useShiftTemplates = (accountId: string) => {
  const list = usePersistedList<ShiftTemplate>(accountId, loadTemplates);
  const { items, write, refresh, getItems } = list;

  const saveTemplate = useCallback(
    async (id: string, changes: ShiftTemplateChanges, isNew: boolean, ifUpdatedAt?: string): Promise<UpsertTemplateResult> => {
      const checked = validateShiftTemplateInput({ ...changes, id });
      if (!checked.ok) return { success: false, error: checked.error };
      const input = { ...checked.value, id, accountId };
      const index = items.findIndex((t) => t.id === id);
      const previous = index === -1 ? null : items[index];
      const result = await write({
        id,
        apply: (prev) => upsertById(prev, dbToTemplate({ ...input, updatedAt: previous?.updatedAt })),
        // An edit saves only while the stored row is still the one this list read.
        commit: () => upsertShiftTemplate(input, ifUpdatedAt ?? previous?.updatedAt),
        rollback: (prev) => (previous ? prev.map((t) => (t.id === id ? previous : t)) : removeById(prev, id)),
        reconcile: (prev, r) => (r.success ? upsertById(prev, dbToTemplate(r.template)) : prev),
        // An edit reloads below, awaited, to judge the refusal; a new template reloads as usual.
        reloadOnFailure: isNew,
      });
      if (result.success) log.info('TEMPLATE', isNew ? 'Template added' : 'Template updated', { templateId: id });
      else log.warn('TEMPLATE', 'Template save rolled back', { templateId: id, reason: result.error });
      return result;
    },
    [accountId, items, write],
  );

  const addShiftTemplate = useCallback(
    (name: string, role: string, startTime: string, endTime: string, coverage: number): Promise<UpsertTemplateResult> =>
      saveTemplate(newUuid(), { name, role, startTime, endTime, coverage }, true),
    [saveTemplate],
  );

  /** `ifUpdatedAt`: the row's `updatedAt` as the edit form read it (see useWorkers.updateWorker). */
  const updateShiftTemplate = useCallback(
    async (id: string, changes: ShiftTemplateChanges, ifUpdatedAt?: string): Promise<UpdateTemplateResult> => {
      if (!items.some((t) => t.id === id)) return { success: false, error: 'Template not found' };
      const result = await saveTemplate(id, changes, false, ifUpdatedAt);
      if (result.success) return { success: true };
      const { id: _id, ...wanted } = dbToTemplate({ ...changes, id });
      const outcome = judgeRefusedEdit(await refresh(), getItems(), id, wanted, result.status);
      if (outcome.kind === 'saved') return { success: true, alreadySaved: true };
      if (outcome.kind === 'conflict') return { success: false, error: result.error, conflictUpdatedAt: outcome.row.updatedAt };
      return { success: false, error: result.error };
    },
    [getItems, items, refresh, saveTemplate],
  );

  /** The proxy refuses (409) while roster shifts use the template. */
  const removeShiftTemplate = useCallback(
    async (id: string): Promise<MutationResult> => {
      const index = items.findIndex((t) => t.id === id);
      if (index === -1) return { success: false, error: 'Template not found' };
      const previous = items[index];
      const result = await write({
        id,
        apply: (prev) => removeById(prev, id),
        commit: () => deleteShiftTemplate(id),
        rollback: (prev) => restoreAt(prev, previous, index),
      });
      if (!result.success) log.warn('TEMPLATE', 'Template delete rolled back', { templateId: id, reason: result.error });
      return result;
    },
    [items, write],
  );

  return {
    shiftTemplates: items,
    loading: list.loading,
    loaded: list.loaded,
    error: list.error,
    truncated: list.truncated,
    addShiftTemplate,
    updateShiftTemplate,
    removeShiftTemplate,
    refresh: list.refresh,
  };
};
