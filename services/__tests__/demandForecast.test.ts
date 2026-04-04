import React, { useEffect } from 'react';
import renderer, { act } from 'react-test-renderer';

jest.mock('@/services/authToken', () => ({
  getSessionToken: jest.fn(),
}));

import { getSessionToken } from '@/services/authToken';
import {
  getForecastDataStatus,
  generateDemandForecast,
  loadDemandTargets,
  upsertDemandTarget,
  DemandForecast,
} from '../demandForecast';

const mockGetSessionToken = getSessionToken as jest.Mock;
const mockFetch = jest.fn();

(global as unknown as { fetch: jest.Mock }).fetch = mockFetch;

const makeOkResponse = (body: unknown) => ({
  ok: true,
  json: jest.fn().mockResolvedValue(body),
});

const makeErrorResponse = (status: number, body: unknown) => ({
  ok: false,
  status,
  json: jest.fn().mockResolvedValue(body),
});

let consoleWarnSpy: jest.SpyInstance;
let consoleErrorSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSessionToken.mockResolvedValue('mock-token');
  consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  consoleWarnSpy.mockRestore();
  consoleErrorSpy.mockRestore();
});

// ─── getForecastDataStatus ─────────────────────────────────────────────────────

describe('getForecastDataStatus', () => {
  test('happy path: proxy returns hasHistorical:true, hasExternalSignals:false → returns matching status object', async () => {
    const proxyResponse = {
      hasHistorical: true,
      hasExternalSignals: false,
      hasExistingTargets: true,
      apiAvailable: true,
    };
    mockFetch.mockResolvedValue(makeOkResponse(proxyResponse));

    const result = await getForecastDataStatus();

    expect(result).toEqual({
      hasHistorical: true,
      hasExternalSignals: false,
      hasExistingTargets: true,
      apiAvailable: true,
    });
  });

  test('fetch throws → returns all-false fallback (no throw)', async () => {
    mockFetch.mockRejectedValue(new Error('Network failure'));

    const result = await getForecastDataStatus();

    expect(result).toEqual({
      hasHistorical: false,
      hasExternalSignals: false,
      hasExistingTargets: false,
      apiAvailable: expect.any(Boolean),
    });
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'Unable to load forecast data status',
      expect.any(Error),
    );
  });

  test('includes Authorization header when getSessionToken returns a token', async () => {
    mockGetSessionToken.mockResolvedValue('mock-token');
    mockFetch.mockResolvedValue(
      makeOkResponse({
        hasHistorical: false,
        hasExternalSignals: false,
        hasExistingTargets: false,
        apiAvailable: false,
      }),
    );

    await getForecastDataStatus();

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer mock-token',
        }),
      }),
    );
  });

  test('omits Authorization header when getSessionToken returns null', async () => {
    mockGetSessionToken.mockResolvedValue(null);
    mockFetch.mockResolvedValue(
      makeOkResponse({
        hasHistorical: false,
        hasExternalSignals: false,
        hasExistingTargets: false,
        apiAvailable: false,
      }),
    );

    await getForecastDataStatus();

    const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = callArgs[1].headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
  });
});

// ─── generateDemandForecast ────────────────────────────────────────────────────

describe('generateDemandForecast', () => {
  test('happy path: returns forecasts array and metadata from proxy', async () => {
    const proxyResponse = {
      forecasts: [
        { date: '2024-01-01', role: 'nurse', required: 5, source: 'model' as const },
      ],
      metadata: {
        hasHistorical: true,
        hasExternalSignals: true,
        hasExistingTargets: false,
        apiAvailable: true,
        usedApi: true,
        usedFallback: false,
        apiCallFailed: false,
      },
    };
    mockFetch.mockResolvedValue(makeOkResponse(proxyResponse));

    const result = await generateDemandForecast();

    expect(result.forecasts).toHaveLength(1);
    expect(result.forecasts[0].role).toBe('nurse');
    expect(result.metadata.usedApi).toBe(true);
    expect(result.metadata.usedFallback).toBe(false);
  });

  test('fetch rejects → returns empty forecasts + fallback metadata (no throw)', async () => {
    mockFetch.mockRejectedValue(new Error('Connection refused'));

    const result = await generateDemandForecast();

    expect(result.forecasts).toEqual([]);
    expect(result.metadata.usedFallback).toBe(true);
    expect(result.metadata.apiCallFailed).toBe(true);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'Unable to generate forecast via secure proxy',
      expect.any(Error),
    );
  });

  test('response.ok=false → returns fallback (no throw)', async () => {
    mockFetch.mockResolvedValue(makeErrorResponse(500, { error: 'Internal Server Error' }));

    const result = await generateDemandForecast();

    expect(result.forecasts).toEqual([]);
    expect(result.metadata.usedFallback).toBe(true);
    expect(consoleWarnSpy).toHaveBeenCalled();
  });
});

// ─── loadDemandTargets ─────────────────────────────────────────────────────────

describe('loadDemandTargets', () => {
  test('filters out non-override targets (source !== "override")', async () => {
    const targets: DemandForecast[] = [
      { date: '2024-01-01', role: 'nurse', required: 3, source: 'override' },
      { date: '2024-01-02', role: 'doctor', required: 2, source: 'model' },
      { date: '2024-01-03', role: 'paramedic', required: 1, source: 'override' },
    ];
    mockFetch.mockResolvedValue(makeOkResponse({ targets }));

    const result = await loadDemandTargets();

    expect(result).toHaveLength(2);
    expect(result.every((t) => t.source === 'override')).toBe(true);
  });

  test('fetch throws → returns [] (no throw)', async () => {
    mockFetch.mockRejectedValue(new Error('Timeout'));

    const result = await loadDemandTargets();

    expect(result).toEqual([]);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'Unable to load demand targets from secure proxy',
      expect.any(Error),
    );
  });
});

// ─── upsertDemandTarget ────────────────────────────────────────────────────────

describe('upsertDemandTarget', () => {
  const sampleTarget: DemandForecast = {
    date: '2024-02-01',
    role: 'nurse',
    required: 4,
    source: 'override',
  };

  test('happy path: proxy returns success:true → {success:true, target}', async () => {
    mockFetch.mockResolvedValue(
      makeOkResponse({ success: true, targets: [sampleTarget] }),
    );

    const result = await upsertDemandTarget(sampleTarget);

    expect(result.success).toBe(true);
    expect(result.target).toMatchObject({ date: '2024-02-01', role: 'nurse' });
    expect(result.error).toBeUndefined();
  });

  test('proxy returns success:false with error → {success:false, error}', async () => {
    mockFetch.mockResolvedValue(
      makeOkResponse({ success: false, targets: [], error: 'Validation failed' }),
    );

    const result = await upsertDemandTarget(sampleTarget);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Validation failed');
  });

  test('fetch throws → {success:false, error message from Error}', async () => {
    mockFetch.mockRejectedValue(new Error('Network gone'));

    const result = await upsertDemandTarget(sampleTarget);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Network gone');
  });

  test('normalises required to Number() and defaults source to "override"', async () => {
    const targetWithStringRequired: DemandForecast = {
      date: '2024-03-01',
      role: 'doctor',
      required: '7' as unknown as number,
      source: undefined as unknown as 'override',
    };

    mockFetch.mockResolvedValue(
      makeOkResponse({ success: true, targets: [] }),
    );

    const result = await upsertDemandTarget(targetWithStringRequired);

    expect(result.target.required).toBe(7);
    expect(typeof result.target.required).toBe('number');
    expect(result.target.source).toBe('override');
  });
});