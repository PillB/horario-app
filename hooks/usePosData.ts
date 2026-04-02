import { useCallback, useEffect, useState } from 'react';

import { getSessionToken } from '@/services/authToken';
import type { PosSalesRow } from '@/services/forecastEngine';

const SECURE_PROXY_URL =
  process.env.EXPO_PUBLIC_SECURE_PROXY_URL ?? '/api/secure-proxy';

type ProxyResponse = {
  rows: Array<{ date: string; revenue: number; covers: number | null }>;
};

type UsePosDataResult = {
  sales: PosSalesRow[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
};

export const usePosData = (
  accountId: string,
  limit = 365,
): UsePosDataResult => {
  const [sales, setSales] = useState<PosSalesRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const token = await getSessionToken();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(SECURE_PROXY_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'listPosSales', accountId, limit }),
      });

      if (!response.ok) {
        const payload = await response
          .json()
          .catch(() => ({ error: `Server error (${response.status})` }));
        const message =
          (payload as { error?: string }).error ??
          `Proxy responded with ${response.status}`;
        setError(message);
        setSales([]);
        return;
      }

      const data = (await response.json()) as ProxyResponse;
      const rows: PosSalesRow[] = (data.rows ?? []).map((r) => ({
        date: r.date,
        revenue: r.revenue,
        covers: r.covers,
      }));

      setSales(rows);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to load POS data';
      // Do not log the message itself — it may embed PII from response bodies
      setError('Unable to load sales data. Please try again.');
      setSales([]);
      // Suppress — callers observe the error state
      void message;
    } finally {
      setLoading(false);
    }
  }, [accountId, limit]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { sales, loading, error, refresh };
};