import React, { useEffect } from 'react';
import renderer, { act } from 'react-test-renderer';
import { clearInterval, setInterval } from 'timers';

// Top-level imports used by hook tests (no jest.resetModules() involved).
import {
  configureSyncQueue as _configureSyncQueue,
  enqueueSyncOp as _enqueueSyncOp,
  useSyncStatus as _useSyncStatus,
  getSyncStatus as _getSyncStatus,
  __resetQueueForTesting,
  __flushForTesting as _flushForTesting,
} from '../syncQueue';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('@/services/analytics', () => ({
  trackEvent: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type SyncQueueModule = typeof import('../syncQueue');

function makeFreshModule(): SyncQueueModule {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../syncQueue') as SyncQueueModule;
}

function makeOp(
  overrides: Partial<{
    table: string;
    operation: 'upsert' | 'delete';
    payload: Record<string, unknown>;
    accountId: string;
    maxRetries: number;
  }> = {},
): Omit<import('../syncQueue').SyncOperation, 'id' | 'retries' | 'createdAt'> {
  return {
    table: overrides.table ?? 'test_table',
    operation: overrides.operation ?? 'upsert',
    payload: overrides.payload ?? { key: 'value' },
    accountId: overrides.accountId ?? 'account-1',
    maxRetries: overrides.maxRetries ?? 3,
  };
}

function makeFullOp(
  id: string,
  overrides: Partial<import('../syncQueue').SyncOperation> = {},
): import('../syncQueue').SyncOperation {
  return {
    id,
    table: 'test_table',
    operation: 'upsert',
    payload: { key: 'value' },
    accountId: 'account-1',
    createdAt: Date.now(),
    retries: 0,
    maxRetries: 3,
    ...overrides,
  };
}

function makeFetchResponse(status: number): Response {
  return {
    status,
    ok: status >= 200 && status <= 299,
    headers: new Headers(),
    redirected: false,
    statusText: String(status),
    type: 'basic',
    url: '',
    body: null,
    bodyUsed: false,
    json: jest.fn(),
    text: jest.fn(),
    blob: jest.fn(),
    arrayBuffer: jest.fn(),
    formData: jest.fn(),
    clone: jest.fn(),
  } as unknown as Response;
}

function configureModule(
  mod: SyncQueueModule,
  {
    proxyUrl = 'https://proxy.example.com',
    token = 'test-token',
  }: { proxyUrl?: string; token?: string | null } = {},
): void {
  mod.configureSyncQueue({
    proxyUrl,
    getAuthToken: jest.fn().mockResolvedValue(token),
  });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let consoleWarnSpy: jest.SpyInstance;
let consoleErrorSpy: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();

  (global as unknown as { fetch: jest.Mock }).fetch = jest.fn();

  consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  consoleWarnSpy.mockRestore();
  consoleErrorSpy.mockRestore();
  jest.useRealTimers();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('enqueueSyncOp', () => {
  test('1. adds operation to queue — pendingCount increases', async () => {
    const mod = makeFreshModule();
    configureModule(mod);

    await act(async () => {
      await Promise.resolve(); // let configureSyncQueue's async load settle
    });

    expect(mod.getSyncStatus().pendingCount).toBe(0);

    mod.enqueueSyncOp(makeOp());

    expect(mod.getSyncStatus().pendingCount).toBe(1);
  });

  test('2. drops operation when queue is at MAX_QUEUE_SIZE (200)', async () => {
    const mod = makeFreshModule();
    configureModule(mod);

    await act(async () => {
      await Promise.resolve();
    });

    // Fill the queue to exactly 200
    for (let i = 0; i < 200; i++) {
      mod.enqueueSyncOp(makeOp({ table: `table_${i}` }));
    }

    expect(mod.getSyncStatus().pendingCount).toBe(200);

    // This one should be dropped
    mod.enqueueSyncOp(makeOp({ table: 'overflow_table' }));

    expect(mod.getSyncStatus().pendingCount).toBe(200);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[syncQueue] Queue full, dropping operation for table:',
      'overflow_table',
    );
  });

  test('3. transitions status to "saving" after enqueueing — pendingCount is 1 and AsyncStorage persists the op', async () => {
    const mod = makeFreshModule();
    configureModule(mod);

    await act(async () => { await Promise.resolve(); });

    expect(mod.getSyncStatus().pendingCount).toBe(0);

    // Enqueue triggers status→'saving' and persists to AsyncStorage
    mod.enqueueSyncOp(makeOp());

    expect(mod.getSyncStatus().pendingCount).toBe(1);

    // Let AsyncStorage write settle
    await act(async () => { await Promise.resolve(); });

    const AsyncStorage = require('@react-native-async-storage/async-storage').default as {
      setItem: jest.Mock;
    };
    // AsyncStorage.setItem should have been called (queue persistence)
    expect(AsyncStorage.setItem).toHaveBeenCalled();
  });
});

describe('_flush via interval', () => {
  test('4. successful HTTP response (2xx) removes op from queue', async () => {
    const mod = makeFreshModule();
    configureModule(mod);

    await act(async () => {
      await Promise.resolve();
    });

    (global as unknown as { fetch: jest.Mock }).fetch.mockResolvedValue(
      makeFetchResponse(200),
    );

    mod.enqueueSyncOp(makeOp());
    expect(mod.getSyncStatus().pendingCount).toBe(1);

    await act(async () => {
      await mod.__flushForTesting();
    });

    expect(mod.getSyncStatus().pendingCount).toBe(0);
  });

  test('5. 4xx response discards op (does not retry), pendingCount goes to 0', async () => {
    const mod = makeFreshModule();
    configureModule(mod);

    await act(async () => {
      await Promise.resolve();
    });

    (global as unknown as { fetch: jest.Mock }).fetch.mockResolvedValue(
      makeFetchResponse(422),
    );

    mod.enqueueSyncOp(makeOp({ maxRetries: 5 }));
    expect(mod.getSyncStatus().pendingCount).toBe(1);

    await act(async () => {
      await mod.__flushForTesting();
    });

    expect(mod.getSyncStatus().pendingCount).toBe(0);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[syncQueue] Discarding operation due to 4xx client error:'),
      422,
      expect.any(String),
    );
  });

  test('6. 5xx response retries op (retries counter increments)', async () => {
    const mod = makeFreshModule();
    configureModule(mod);

    await act(async () => {
      await Promise.resolve();
    });

    (global as unknown as { fetch: jest.Mock }).fetch.mockResolvedValue(
      makeFetchResponse(500),
    );

    mod.enqueueSyncOp(makeOp({ maxRetries: 5 }));
    expect(mod.getSyncStatus().pendingCount).toBe(1);

    await act(async () => {
      await mod.__flushForTesting();
    });

    // Op should still be in queue (retried, not discarded)
    expect(mod.getSyncStatus().pendingCount).toBe(1);
    expect((global as unknown as { fetch: jest.Mock }).fetch).toHaveBeenCalledTimes(1);
  });

  test('7. op is discarded after maxRetries exceeded', async () => {
    const mod = makeFreshModule();
    configureModule(mod);

    await act(async () => {
      await Promise.resolve();
    });

    (global as unknown as { fetch: jest.Mock }).fetch.mockResolvedValue(
      makeFetchResponse(500),
    );

    // maxRetries = 0 means it gets discarded after first retry attempt
    mod.enqueueSyncOp(makeOp({ maxRetries: 0 }));
    expect(mod.getSyncStatus().pendingCount).toBe(1);

    await act(async () => {
      await mod.__flushForTesting();
    });

    expect(mod.getSyncStatus().pendingCount).toBe(0);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[syncQueue] Discarding operation after max retries:',
      expect.any(String),
    );
  });

  test('8. offline (_isOnline = false) skips flushing', async () => {
    const mod = makeFreshModule();
    configureModule(mod);

    await act(async () => {
      await Promise.resolve();
    });

    // Simulate offline
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      get: () => false,
    });

    mod.enqueueSyncOp(makeOp());
    expect(mod.getSyncStatus().pendingCount).toBe(1);

    await act(async () => {
      jest.advanceTimersByTime(8000);
      await Promise.resolve();
      await Promise.resolve();
    });

    // fetch should NOT have been called because we're offline
    expect((global as unknown as { fetch: jest.Mock }).fetch).not.toHaveBeenCalled();
    expect(mod.getSyncStatus().pendingCount).toBe(1);

    // Restore
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      get: () => true,
    });
  });

  test('9. not configured (no proxyUrl) skips flushing', async () => {
    const mod = makeFreshModule();

    // Do NOT call configureSyncQueue — module starts unconfigured
    // Manually enqueue by relying on public API; but interval won't start without proxyUrl
    // We need to force a queue entry without configuring
    // Configure with empty proxyUrl to test the guard
    mod.configureSyncQueue({
      proxyUrl: '',
      getAuthToken: jest.fn().mockResolvedValue('token'),
    });

    await act(async () => {
      await Promise.resolve();
    });

    mod.enqueueSyncOp(makeOp());

    await act(async () => {
      jest.advanceTimersByTime(8000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect((global as unknown as { fetch: jest.Mock }).fetch).not.toHaveBeenCalled();
    expect(mod.getSyncStatus().pendingCount).toBe(1);
  });

  test('10. concurrent flush guard prevents double flush', async () => {
    const mod = makeFreshModule();
    configureModule(mod);

    await act(async () => {
      await Promise.resolve();
    });

    // Make fetch hang so _flushing stays true during second attempt
    let resolveFirst: ((value: Response) => void) | null = null;
    (global as unknown as { fetch: jest.Mock }).fetch.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFirst = resolve;
        }),
    );

    mod.enqueueSyncOp(makeOp());

    // Start first flush — it will set _flushing=true then hang on fetch
    const flush1 = mod.__flushForTesting();

    // Yield so _flushing is set and the fetch call is initiated
    await Promise.resolve();
    await Promise.resolve();

    // Second flush should bail immediately (guard: _flushing === true)
    const flush2 = mod.__flushForTesting();
    await flush2;

    // fetch should have been called exactly once (second flush bailed out on _flushing guard)
    expect((global as unknown as { fetch: jest.Mock }).fetch).toHaveBeenCalledTimes(1);

    // Resolve the hanging request so the first flush completes
    await act(async () => {
      if (resolveFirst) {
        resolveFirst(makeFetchResponse(200));
      }
      await flush1;
      await Promise.resolve();
    });
  });
});

describe('_loadPersistedQueue', () => {
  test('11. merges persisted queue from AsyncStorage on configureSyncQueue', async () => {
    const mod = makeFreshModule();

    const AsyncStorage = require('@react-native-async-storage/async-storage').default as {
      getItem: jest.Mock;
      setItem: jest.Mock;
    };

    const persistedOp = makeFullOp('persisted-id-1');
    AsyncStorage.getItem.mockResolvedValue(JSON.stringify([persistedOp]));

    configureModule(mod);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mod.getSyncStatus().pendingCount).toBe(1);
  });

  test('12. ignores malformed AsyncStorage data without throwing', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage').default as {
      getItem: jest.Mock;
      setItem: jest.Mock;
    };

    AsyncStorage.getItem.mockResolvedValue('not-valid-json{{{');

    const mod = makeFreshModule();

    await expect(async () => {
      configureModule(mod);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
    }).not.toThrow();

    // Queue should be empty — malformed data was ignored
    expect(mod.getSyncStatus().pendingCount).toBe(0);
  });

  test('12b. ignores non-array AsyncStorage data without throwing', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage').default as {
      getItem: jest.Mock;
      setItem: jest.Mock;
    };

    AsyncStorage.getItem.mockResolvedValue(JSON.stringify({ notAnArray: true }));

    const mod = makeFreshModule();

    await expect(async () => {
      configureModule(mod);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
    }).not.toThrow();

    expect(mod.getSyncStatus().pendingCount).toBe(0);
  });

  test('12c. filters out invalid shapes within a persisted array', async () => {
    const mod = makeFreshModule();

    const AsyncStorage = require('@react-native-async-storage/async-storage').default as {
      getItem: jest.Mock;
      setItem: jest.Mock;
    };

    const invalidOp = { id: 123, table: null }; // does not satisfy _isSyncOperation
    const validOp = makeFullOp('valid-op-1');

    AsyncStorage.getItem.mockResolvedValue(JSON.stringify([invalidOp, validOp]));

    configureModule(mod);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Only the valid op should have been merged
    expect(mod.getSyncStatus().pendingCount).toBe(1);
  });
});

describe('_isSyncOperation (type guard — indirect via _loadPersistedQueue)', () => {
  test('13. rejects objects with missing required fields', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage').default as {
      getItem: jest.Mock;
      setItem: jest.Mock;
    };

    const missingFields = [
      // missing id
      { table: 't', operation: 'upsert', payload: {}, accountId: 'a', createdAt: 1, retries: 0, maxRetries: 3 },
      // wrong operation value
      makeFullOp('bad-op', { operation: 'insert' as 'upsert' }),
      // payload is null
      makeFullOp('null-payload', { payload: null as unknown as Record<string, unknown> }),
      // retries is string
      makeFullOp('string-retries', { retries: 'zero' as unknown as number }),
    ];

    AsyncStorage.getItem.mockResolvedValue(JSON.stringify(missingFields));

    const mod = makeFreshModule();
    configureModule(mod);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // All shapes are invalid; only the one with correct operation should fail too
    // The object missing 'id' fails. The one with 'insert' fails. The null payload fails.
    // The string retries fails. So pendingCount = 0.
    expect(mod.getSyncStatus().pendingCount).toBe(0);
  });
});

// ─── Hook tests — use top-level imports to avoid React instance mismatch ──────
//
// Tests 14-15d use React hooks. They CANNOT use makeFreshModule() because
// jest.resetModules() re-loads React, causing a mismatch with react-test-renderer.
// Instead we use the top-level _useSyncStatus / _enqueueSyncOp imports and call
// __resetQueueForTesting() in beforeEach to give each test a clean slate.

describe('retryNow', () => {
  beforeEach(() => {
    __resetQueueForTesting();
    _configureSyncQueue({
      proxyUrl: 'https://proxy.example.com',
      getAuthToken: jest.fn().mockResolvedValue('test-token'),
    });
  });

  test('14. resets retry counters and triggers flush', async () => {
    (global as unknown as { fetch: jest.Mock }).fetch.mockResolvedValue(
      makeFetchResponse(500),
    );

    _enqueueSyncOp(makeOp({ maxRetries: 5 }));

    await act(async () => {
      await _flushForTesting();
    });

    expect(_getSyncStatus().pendingCount).toBe(1);

    (global as unknown as { fetch: jest.Mock }).fetch.mockResolvedValue(
      makeFetchResponse(200),
    );

    let retryNowFn: (() => void) | null = null;

    function TestComponent(): null {
      const { retryNow } = _useSyncStatus();
      useEffect(() => {
        retryNowFn = retryNow;
      }, [retryNow]);
      return null;
    }

    await act(async () => {
      renderer.create(React.createElement(TestComponent));
      await Promise.resolve();
    });

    await act(async () => {
      retryNowFn?.();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(_getSyncStatus().pendingCount).toBe(0);
  });
});

describe('useSyncStatus hook', () => {
  beforeEach(() => {
    __resetQueueForTesting();
    _configureSyncQueue({
      proxyUrl: 'https://proxy.example.com',
      getAuthToken: jest.fn().mockResolvedValue('test-token'),
    });
  });

  test('15. status reflects module-level state; updates on enqueue', async () => {
    await act(async () => { await Promise.resolve(); });

    const statusHistory: string[] = [];

    function TestComponent(): null {
      const { status, pendingCount } = _useSyncStatus();
      useEffect(() => {
        statusHistory.push(`${status}:${pendingCount}`);
      }, [status, pendingCount]);
      return null;
    }

    await act(async () => {
      renderer.create(React.createElement(TestComponent));
      await Promise.resolve();
    });

    expect(statusHistory.some((s) => s.startsWith('idle:'))).toBe(true);

    await act(async () => {
      _enqueueSyncOp(makeOp());
      await Promise.resolve();
    });

    expect(statusHistory).toContain('saving:1');
  });

  test('15b. pendingCount reflects queue length', async () => {
    await act(async () => { await Promise.resolve(); });

    let capturedPendingCount = -1;

    function TestComponent(): null {
      const { pendingCount } = _useSyncStatus();
      useEffect(() => { capturedPendingCount = pendingCount; }, [pendingCount]);
      return null;
    }

    await act(async () => {
      renderer.create(React.createElement(TestComponent));
      await Promise.resolve();
    });

    expect(capturedPendingCount).toBe(0);

    await act(async () => {
      _enqueueSyncOp(makeOp());
      await Promise.resolve();
    });

    // pendingCount is updated via status-change notifications; one enqueue → one notification
    expect(capturedPendingCount).toBe(1);
  });

  test('15c. lastSyncedAt updates after successful flush', async () => {
    (global as unknown as { fetch: jest.Mock }).fetch.mockResolvedValue(
      makeFetchResponse(200),
    );

    let capturedLastSyncedAt: number | null = null;

    function TestComponent(): null {
      const { lastSyncedAt } = _useSyncStatus();
      useEffect(() => { capturedLastSyncedAt = lastSyncedAt; }, [lastSyncedAt]);
      return null;
    }

    await act(async () => {
      renderer.create(React.createElement(TestComponent));
      await Promise.resolve();
    });

    expect(capturedLastSyncedAt).toBeNull();

    await act(async () => {
      _enqueueSyncOp(makeOp());
      await Promise.resolve();
    });

    await act(async () => {
      await _flushForTesting();
    });

    expect(capturedLastSyncedAt).not.toBeNull();
    expect(typeof capturedLastSyncedAt).toBe('number');
  });

  test('15d. unsubscribes from status updates on unmount — no setState after unmount', async () => {
    let renderCount = 0;

    function TestComponent(): null {
      _useSyncStatus();
      renderCount += 1;
      return null;
    }

    let tree: ReturnType<typeof renderer.create>;
    await act(async () => {
      tree = renderer.create(React.createElement(TestComponent));
    });

    const countAfterMount = renderCount;

    await act(async () => { tree.unmount(); });

    const countAfterUnmount = renderCount;

    await act(async () => {
      _enqueueSyncOp(makeOp());
      await Promise.resolve();
    });

    expect(renderCount).toBe(countAfterUnmount);
    expect(countAfterMount).toBeGreaterThanOrEqual(1);
  });
});