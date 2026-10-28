import { getSessionToken } from '@/services/authToken';
import {
  getForecastDataStatus,
  generateDemandForecast,
  fetchForecastHistory,
  loadDemandTargets,
  upsertDemandTarget,
  DemandForecast,
} from '../demandForecast';
import { addDaysToKey, weekdayOfKey } from '@/utils/dateKeys';

jest.mock('@/services/authToken', () => ({
  getSessionToken: jest.fn(),
}));

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
  const savedApiUrl = process.env.EXPO_PUBLIC_FORECAST_API_URL;
  afterEach(() => {
    if (savedApiUrl === undefined) delete process.env.EXPO_PUBLIC_FORECAST_API_URL;
    else process.env.EXPO_PUBLIC_FORECAST_API_URL = savedApiUrl;
  });

  test('happy path: returns forecasts array and metadata from the external API via the proxy', async () => {
    process.env.EXPO_PUBLIC_FORECAST_API_URL = 'https://forecast.example.test';
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
    expect(result.metadata.method).toBe('api');
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

// ─── Statistical forecast (no external API) ───────────────────────────────────

/** Demand by weekday (0 = Sunday), keyed by the calendar date. */
const BY_WEEKDAY = [9, 3, 3, 4, 4, 6, 10];

type Body = Record<string, unknown>;
const bodyOf = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body)) as Body;

/** A fake proxy holding `days` of Cook history (one row per shift) before `end`. */
const fakeProxy = (end: string, days: number, pageSize = 1000) => {
  const rows: { date: string; role: string }[] = [];
  for (let i = days; i >= 1; i -= 1) {
    const date = addDaysToKey(end, -i);
    for (let k = 0; k < BY_WEEKDAY[weekdayOfKey(date)]; k += 1) rows.push({ date, role: 'Cook' });
  }
  rows.reverse(); // newest first, like the proxy
  return (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Body;
    if (body.action === 'forecastHistory') {
      const inWindow = rows.filter((r) => r.date >= String(body.from) && r.date < String(body.to));
      const page = Number(body.page ?? 0);
      const slice = inWindow.slice(page * pageSize, (page + 1) * pageSize);
      const sums = new Map<string, { date: string; role: string; shifts: number }>();
      slice.forEach((r) => {
        const d = sums.get(r.date) ?? { date: r.date, role: r.role, shifts: 0 };
        d.shifts += 1;
        sums.set(r.date, d);
      });
      return Promise.resolve(
        makeOkResponse({ days: [...sums.values()], page, pageSize, rows: slice.length, total: page === 0 ? inWindow.length : null }),
      );
    }
    if (body.action === 'listForecastSignals') return Promise.resolve(makeOkResponse({ signals: [] }));
    return Promise.resolve(makeErrorResponse(400, { error: 'unexpected action' }));
  };
};

describe('generateDemandForecast without the external API', () => {
  beforeEach(() => {
    delete process.env.EXPO_PUBLIC_FORECAST_API_URL;
    jest.useFakeTimers({ doNotFake: ['setTimeout', 'setImmediate', 'nextTick', 'queueMicrotask'] });
    // 04:30 UTC on 8 March 2026: still the 7th in Lima, already the 8th in Tokyo.
    jest.setSystemTime(new Date('2026-03-08T04:30:00Z'));
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test('fits on the client from paged history and never calls the forecast action', async () => {
    mockFetch.mockImplementation(fakeProxy('2026-03-08', 200));
    const result = await generateDemandForecast({ date: '2026-03-10', role: 'Cook' }, { timeZone: 'Asia/Tokyo' });

    const actions = mockFetch.mock.calls.map((c) => bodyOf(c).action);
    expect(actions).not.toContain('forecast');
    expect(actions.filter((a) => a === 'forecastHistory').length).toBeGreaterThan(1);
    expect(result.metadata).toMatchObject({ method: 'statistical', usedApi: false, usedFallback: false, hasHistorical: true });
    expect(result.metadata.models?.[0]).toMatchObject({ role: 'Cook' });
    expect(result.forecasts).toEqual([
      expect.objectContaining({ date: '2026-03-10', role: 'Cook', source: 'model', required: BY_WEEKDAY[weekdayOfKey('2026-03-10')] }),
    ]);
    expect(result.metadata.fitMs).toEqual(expect.any(Number));
  });

  test('"today" is the business-local date: history ends before it', async () => {
    mockFetch.mockImplementation(fakeProxy('2026-03-08', 60));
    await generateDemandForecast({ role: 'Cook' }, { timeZone: 'America/Lima', horizonDays: 3 });
    const lima = bodyOf(mockFetch.mock.calls.find((c) => bodyOf(c).action === 'forecastHistory')!);
    expect(lima).toMatchObject({ to: '2026-03-07', from: addDaysToKey('2026-03-07', -730), role: 'Cook' });

    mockFetch.mockClear();
    const tokyo = await generateDemandForecast({ role: 'Cook' }, { timeZone: 'Asia/Tokyo', horizonDays: 3 });
    expect(bodyOf(mockFetch.mock.calls.find((c) => bodyOf(c).action === 'forecastHistory')!).to).toBe('2026-03-08');
    expect(tokyo.forecasts.map((f) => f.date)).toEqual(['2026-03-08', '2026-03-09', '2026-03-10']);
  });

  test('CHG-087: history that stopped weeks ago counts as 0 up to the window end, and the gap is reported', async () => {
    // Shifts stop on 2026-02-05; today (UTC) is 2026-03-08, so the window ends 2026-03-07.
    mockFetch.mockImplementation(fakeProxy('2026-02-06', 200));
    const result = await generateDemandForecast({ date: '2026-03-10', role: 'Cook' }, { timeZone: 'UTC' });
    expect(result.metadata.historyEndsDaysAgo).toBe(30);
    expect(result.metadata.models?.[0]).toMatchObject({ lastDataDate: '2026-02-05', historyEndsDaysAgo: 30 });
    expect(result.forecasts).toEqual([expect.objectContaining({ date: '2026-03-10', required: 0 })]);
    expect(result.metadata.signalsTruncated).toBe(false);
  });

  test('CHG-087: passes on the proxy\'s signal truncation flag', async () => {
    const proxy = fakeProxy('2026-03-08', 60);
    mockFetch.mockImplementation((url: string, init: RequestInit) =>
      bodyOf([url, init]).action === 'listForecastSignals'
        ? Promise.resolve(makeOkResponse({ signals: [], truncated: true }))
        : proxy(url, init),
    );
    const result = await generateDemandForecast({ date: '2026-03-10', role: 'Cook' }, { timeZone: 'UTC' });
    expect(result.metadata.signalsTruncated).toBe(true);
    expect(result.metadata.historyEndsDaysAgo).toBe(0);
  });

  test('says so when there is no history for the role', async () => {
    mockFetch.mockImplementation(fakeProxy('2026-03-08', 0));
    const result = await generateDemandForecast({ date: '2026-03-10', role: 'Cook' }, { timeZone: 'UTC' });
    expect(result.forecasts).toEqual([]);
    expect(result.metadata.method).toBe('none');
    expect(result.metadata.usedFallback).toBe(true);
    expect(result.metadata.fallbackReason).toMatch(/No shift history for Cook/);
  });

  test('uses the statistical forecast when the external API returns nothing', async () => {
    process.env.EXPO_PUBLIC_FORECAST_API_URL = 'https://forecast.example.test';
    const proxy = fakeProxy('2026-03-08', 120);
    mockFetch.mockImplementation((url: string, init: RequestInit) => {
      if (JSON.parse(String(init.body)).action === 'forecast') {
        return Promise.resolve(
          makeOkResponse({ forecasts: [], metadata: { usedApi: false, apiCallFailed: true, usedFallback: true } }),
        );
      }
      return proxy(url, init);
    });
    const result = await generateDemandForecast({ date: '2026-03-10', role: 'Cook' }, { timeZone: 'UTC' });
    expect(result.forecasts).toHaveLength(1);
    expect(result.metadata).toMatchObject({ method: 'statistical', apiAvailable: true, apiCallFailed: true, usedFallback: true });
    expect(result.metadata.fallbackReason).toMatch(/Forecast API request failed/);
  });
});

describe('fetchForecastHistory', () => {
  test('adds up pages and fetches them after page 0 reports the total', async () => {
    mockFetch.mockImplementation(fakeProxy('2026-03-08', 100, 50));
    const { days, truncated } = await fetchForecastHistory('2026-01-01', '2026-03-08', 'Cook');
    expect(truncated).toBe(false);
    const total = days.reduce((s, d) => s + d.shifts, 0);
    const expected = Array.from({ length: 66 }, (_, i) => BY_WEEKDAY[weekdayOfKey(addDaysToKey('2026-01-01', i))]).reduce((a, b) => a + b, 0);
    expect(total).toBe(expected);
    // Days split across two pages come back as one entry.
    days.forEach((d) => expect(d.shifts).toBe(BY_WEEKDAY[weekdayOfKey(d.date)]));
    const pages = mockFetch.mock.calls.map((c) => bodyOf(c).page);
    expect(pages[0]).toBe(0);
    expect(new Set(pages).size).toBe(Math.ceil(expected / 50));
  });

  test('stops at 40 pages, keeping the newest shifts and dropping the oldest, partial day', async () => {
    mockFetch.mockImplementation(fakeProxy('2026-03-08', 400, 10));
    const { days, truncated } = await fetchForecastHistory('2025-01-01', '2026-03-08');
    expect(truncated).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(40);
    const dates = days.map((d) => d.date).sort();
    expect(dates[dates.length - 1]).toBe('2026-03-07');
    // Every day kept is complete.
    days.forEach((d) => expect(d.shifts).toBe(BY_WEEKDAY[weekdayOfKey(d.date)]));
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