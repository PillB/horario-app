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
import { removeById, restoreAt, upsertById, usePersistedList, type LoadResult } from './usePersistedList';

const dbToTemplate = (db: Pick<DbShiftTemplate, 'id' | 'name' | 'role' | 'startTime' | 'endTime' | 'coverage'>): ShiftTemplate => ({
  id: db.id,
  name: db.name,
  role: db.role,
  start: db.startTime,
  end: db.endTime,
  coverage: db.coverage,
});

const loadTemplates = async (): Promise<LoadResult<ShiftTemplate>> => {
  const result = await fetchShiftTemplates();
  if (!result.ok) return result;
  log.debug('TEMPLATE', 'Templates loaded', { count: result.data.length });
  return { ok: true, data: result.data.map(dbToTemplate), truncated: result.truncated };
};

export type ShiftTemplateChanges = { name: string; role: string; startTime: string; endTime: string; coverage: number };

/** `accountId` only names the tenant (a new one reloads); the proxy takes it from the session. */
export const useShiftTemplates = (accountId: string) => {
  const list = usePersistedList<ShiftTemplate>(accountId, loadTemplates);
  const { items, write } = list;

  const saveTemplate = useCallback(
    async (id: string, changes: ShiftTemplateChanges, isNew: boolean): Promise<UpsertTemplateResult> => {
      const checked = validateShiftTemplateInput({ ...changes, id });
      if (!checked.ok) return { success: false, error: checked.error };
      const input = { ...checked.value, id, accountId };
      const index = items.findIndex((t) => t.id === id);
      const previous = index === -1 ? null : items[index];
      const result = await write({
        apply: (prev) => upsertById(prev, dbToTemplate(input)),
        commit: () => upsertShiftTemplate(input),
        rollback: (prev) => (previous ? prev.map((t) => (t.id === id ? previous : t)) : removeById(prev, id)),
        reconcile: (prev, r) => (r.success ? upsertById(prev, dbToTemplate(r.template)) : prev),
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

  const updateShiftTemplate = useCallback(
    (id: string, changes: ShiftTemplateChanges): Promise<UpsertTemplateResult> =>
      items.some((t) => t.id === id) ? saveTemplate(id, changes, false) : Promise.resolve({ success: false, error: 'Template not found' }),
    [items, saveTemplate],
  );

  /** The proxy refuses (409) while roster shifts use the template. */
  const removeShiftTemplate = useCallback(
    async (id: string): Promise<MutationResult> => {
      const index = items.findIndex((t) => t.id === id);
      if (index === -1) return { success: false, error: 'Template not found' };
      const previous = items[index];
      const result = await write({
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
