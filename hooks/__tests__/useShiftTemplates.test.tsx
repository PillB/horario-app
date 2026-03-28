import React, { useEffect } from 'react';
import renderer, { act } from 'react-test-renderer';

import { useShiftTemplates } from '../useShiftTemplates';

// ─── helpers ─────────────────────────────────────────────────────────────────

const mockFetch = (body: unknown, ok = true) => {
  (global as unknown as { fetch: jest.Mock }).fetch = jest.fn().mockResolvedValue({
    ok,
    json: jest.fn().mockResolvedValue(body),
  });
};

const mockFetchReject = (message: string) => {
  (global as unknown as { fetch: jest.Mock }).fetch = jest
    .fn()
    .mockRejectedValue(new Error(message));
};

const dbTemplate = {
  id: 'tmpl-1',
  accountId: 'acc-1',
  name: 'Morning Shift',
  role: 'Support',
  startTime: '09:00',
  endTime: '17:00',
  coverage: 2,
};

// ─── tests ───────────────────────────────────────────────────────────────────

describe('useShiftTemplates', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('loads templates and maps startTime/endTime → start/end', async () => {
    mockFetch({ templates: [dbTemplate] });

    let hookState: ReturnType<typeof useShiftTemplates> | null = null;

    const TestComponent = () => {
      const hook = useShiftTemplates('acc-1');
      useEffect(() => { hookState = hook; }, [hook]);
      return null;
    };

    await act(async () => { renderer.create(<TestComponent />); });

    expect(hookState!.loading).toBe(false);
    expect(hookState!.shiftTemplates).toHaveLength(1);
    expect(hookState!.shiftTemplates[0]).toEqual({
      id: 'tmpl-1',
      name: 'Morning Shift',
      role: 'Support',
      start: '09:00',
      end: '17:00',
      coverage: 2,
    });
  });

  it('returns empty templates on proxy error', async () => {
    mockFetch({}, false);

    let hookState: ReturnType<typeof useShiftTemplates> | null = null;

    const TestComponent = () => {
      const hook = useShiftTemplates('acc-1');
      useEffect(() => { hookState = hook; }, [hook]);
      return null;
    };

    await act(async () => { renderer.create(<TestComponent />); });

    expect(hookState!.shiftTemplates).toEqual([]);
    expect(hookState!.loading).toBe(false);
  });

  it('returns empty templates on network failure', async () => {
    mockFetchReject('Network error');

    let hookState: ReturnType<typeof useShiftTemplates> | null = null;

    const TestComponent = () => {
      const hook = useShiftTemplates('acc-1');
      useEffect(() => { hookState = hook; }, [hook]);
      return null;
    };

    await act(async () => { renderer.create(<TestComponent />); });

    expect(hookState!.shiftTemplates).toEqual([]);
    expect(hookState!.loading).toBe(false);
  });
});
