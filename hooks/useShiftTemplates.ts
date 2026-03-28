import { useCallback, useEffect, useState } from 'react';

import {
  listShiftTemplates,
  upsertShiftTemplate,
  type DbShiftTemplate,
  type UpsertTemplateResult,
} from '@/services/rosterService';
import type { ShiftTemplate } from '@/utils/schedulerMetrics';

const dbToTemplate = (db: DbShiftTemplate): ShiftTemplate => ({
  id: db.id,
  name: db.name,
  role: db.role,
  start: db.startTime,
  end: db.endTime,
  coverage: db.coverage,
});

const generateId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

export const useShiftTemplates = (accountId: string) => {
  const [shiftTemplates, setShiftTemplates] = useState<ShiftTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    setError(null);
    const templates = await listShiftTemplates(accountId);
    setShiftTemplates(templates.map(dbToTemplate));
    setLoading(false);
  }, [accountId]);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  const addShiftTemplate = useCallback(
    async (
      name: string,
      role: string,
      startTime: string,
      endTime: string,
      coverage: number
    ): Promise<UpsertTemplateResult> => {
      const newTemplate: DbShiftTemplate = {
        id: generateId(),
        accountId,
        name,
        role,
        startTime,
        endTime,
        coverage,
      };
      const result = await upsertShiftTemplate(newTemplate);
      if (result.success) {
        setShiftTemplates((prev) => [...prev, dbToTemplate(result.template)]);
      }
      return result;
    },
    [accountId]
  );

  return { shiftTemplates, loading, error, addShiftTemplate, refresh: loadTemplates };
};
