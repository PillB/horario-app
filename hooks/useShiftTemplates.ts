import { useCallback, useEffect, useState } from 'react';

import { listShiftTemplates, type DbShiftTemplate } from '@/services/rosterService';
import type { ShiftTemplate } from '@/app/(tabs)/schedulerMetrics';

const dbToTemplate = (db: DbShiftTemplate): ShiftTemplate => ({
  id: db.id,
  name: db.name,
  role: db.role,
  start: db.startTime,
  end: db.endTime,
  coverage: db.coverage,
});

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

  return { shiftTemplates, loading, error, refresh: loadTemplates };
};
