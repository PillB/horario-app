export type DemandForecast = {
  date: string;
  role: string;
  required: number;
  notes?: string;
  confidence?: number;
  lowerBound?: number;
  upperBound?: number;
  source?: 'model' | 'override';
};

export type ForecastFilters = {
  date?: string;
  role?: string;
};

export type ForecastDataStatus = {
  hasHistorical: boolean;
  hasExternalSignals: boolean;
  hasExistingTargets: boolean;
  apiAvailable: boolean;
};

export type ForecastGenerationMetadata = ForecastDataStatus & {
  usedApi: boolean;
  usedFallback: boolean;
  apiCallFailed: boolean;
  fallbackReason?: string;
};

export type ForecastGenerationResult = {
  forecasts: DemandForecast[];
  metadata: ForecastGenerationMetadata;
};

export type UpsertDemandTargetResult = {
  success: boolean;
  target: DemandForecast;
  error?: string;
};

const SECURE_PROXY_URL = process.env.EXPO_PUBLIC_SECURE_PROXY_URL ?? '/api/secure-proxy';

const DEFAULT_FORECAST_METADATA: ForecastGenerationMetadata = {
  hasHistorical: false,
  hasExternalSignals: false,
  hasExistingTargets: false,
  apiAvailable: Boolean(process.env.EXPO_PUBLIC_FORECAST_API_URL),
  usedApi: false,
  usedFallback: true,
  apiCallFailed: true,
  fallbackReason: 'Secure forecasting service unavailable; using local estimates.',
};

const handleSecureFetch = async <T>(payload: Record<string, unknown>): Promise<T> => {
  const response = await fetch(SECURE_PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error?.error ?? `Secure proxy responded with status ${response.status}`);
  }

  return (await response.json()) as T;
};

export const getForecastDataStatus = async (filters?: ForecastFilters): Promise<ForecastDataStatus> => {
  try {
    const status = await handleSecureFetch<ForecastGenerationMetadata>({ action: 'status', filters });
    return {
      hasHistorical: status.hasHistorical,
      hasExternalSignals: status.hasExternalSignals,
      hasExistingTargets: status.hasExistingTargets,
      apiAvailable: status.apiAvailable,
    };
  } catch (error) {
    console.warn('Unable to load forecast data status', error);
    return {
      hasHistorical: DEFAULT_FORECAST_METADATA.hasHistorical,
      hasExternalSignals: DEFAULT_FORECAST_METADATA.hasExternalSignals,
      hasExistingTargets: DEFAULT_FORECAST_METADATA.hasExistingTargets,
      apiAvailable: DEFAULT_FORECAST_METADATA.apiAvailable,
    };
  }
};

export const generateDemandForecast = async (filters?: ForecastFilters): Promise<ForecastGenerationResult> => {
  try {
    const result = await handleSecureFetch<ForecastGenerationResult>({ action: 'forecast', filters });
    return result;
  } catch (error) {
    console.warn('Unable to generate forecast via secure proxy', error);
    return {
      forecasts: [],
      metadata: { ...DEFAULT_FORECAST_METADATA, fallbackReason: 'Secure forecast service unavailable.' },
    };
  }
};

export const loadDemandTargets = async (filters?: ForecastFilters): Promise<DemandForecast[]> => {
  try {
    const result = await handleSecureFetch<{ targets: DemandForecast[] }>({ action: 'loadTargets', filters });
    return (result.targets ?? []).filter((target) => target.source === 'override');
  } catch (error) {
    console.warn('Unable to load demand targets from secure proxy', error);
    return [];
  }
};

export const upsertDemandTarget = async (target: DemandForecast): Promise<UpsertDemandTargetResult> => {
  const normalized = { ...target, required: Number(target.required), source: target.source ?? 'override' };
  try {
    const result = await handleSecureFetch<{ success: boolean; targets: DemandForecast[]; error?: string }>({
      action: 'upsertTargets',
      targets: [normalized],
    });

    if (!result.success) {
      const message = result.error ?? 'Unable to save override';
      return { success: false, target: normalized, error: message };
    }

    return { success: true, target: normalized };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to save override';
    return { success: false, target: normalized, error: message };
  }
};
