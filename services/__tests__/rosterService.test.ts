import {
  listWorkers,
  upsertWorker,
  deleteWorker,
  listWorkerAvailability,
  upsertAvailability,
  deleteAvailability,
  listShiftTemplates,
  upsertShiftTemplate,
  deleteShiftTemplate,
  listRoster,
  upsertRosterShift,
  updateShiftStatus,
  markShiftNotified,
  deleteRosterShift,
  type DbWorker,
  type DbAvailability,
  type DbShiftTemplate,
  type DbRosterShift,
} from '../rosterService';
import { onPlanRefusal } from '../planSignal';

// ─── helpers ─────────────────────────────────────────────────────────────────

const mockFetch = (body: unknown, ok = true, status = 200) => {
  (global as unknown as { fetch: jest.Mock }).fetch = jest.fn().mockResolvedValue({
    ok,
    status,
    json: jest.fn().mockResolvedValue(body),
  });
};

const mockFetchReject = (message: string) => {
  (global as unknown as { fetch: jest.Mock }).fetch = jest.fn().mockRejectedValue(
    new Error(message)
  );
};

const worker: DbWorker = {
  id: 'w-1',
  accountId: 'acc-1',
  name: 'Alice',
  role: 'Support',
  skills: ['Chat'],
};

const availability: DbAvailability = {
  id: 'av-1',
  accountId: 'acc-1',
  workerId: 'w-1',
  dayOfWeek: 'Mon',
  fromTime: '09:00',
  toTime: '17:00',
};

const template: DbShiftTemplate = {
  id: 'tmpl-1',
  accountId: 'acc-1',
  name: 'Morning Shift',
  role: 'Support',
  startTime: '09:00',
  endTime: '17:00',
  coverage: 2,
};

const shift: DbRosterShift = {
  id: 'shift-1',
  accountId: 'acc-1',
  date: '2026-04-01',
  workerId: 'w-1',
  templateId: 'tmpl-1',
  location: 'HQ',
  status: 'Draft',
  notified: false,
};

// ─── workers ─────────────────────────────────────────────────────────────────

describe('listWorkers', () => {
  it('returns workers from a successful proxy response', async () => {
    mockFetch({ workers: [worker] });
    const result = await listWorkers('acc-1');
    expect(result).toEqual([worker]);
    expect((global as unknown as { fetch: jest.Mock }).fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ action: 'listWorkers', page: 0 }),
      })
    );
  });

  it('returns empty array and warns on proxy error', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockFetch({ error: 'DB error' }, false, 500);
    const result = await listWorkers('acc-1');
    expect(result).toEqual([]);
    warn.mockRestore();
  });

  it('returns empty array and warns on network failure', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockFetchReject('Network error');
    const result = await listWorkers('acc-1');
    expect(result).toEqual([]);
    warn.mockRestore();
  });
});

describe('upsertWorker', () => {
  it('returns success and the upserted worker', async () => {
    mockFetch({ success: true, worker });
    const result = await upsertWorker(worker);
    expect(result.success).toBe(true);
    expect(result.worker).toEqual(worker);
  });

  it('returns failure with error message on proxy error', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockFetch({ success: false, error: 'Validation failed' }, false, 400);
    const result = await upsertWorker(worker);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Validation failed');
    warn.mockRestore();
  });

  it('returns failure on network error', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockFetchReject('timeout');
    const result = await upsertWorker(worker);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/timeout/);
    warn.mockRestore();
  });
});

describe('deleteWorker', () => {
  it('returns success on 200', async () => {
    mockFetch({ success: true });
    const result = await deleteWorker('w-1');
    expect(result.success).toBe(true);
  });

  it('returns failure when proxy reports error', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockFetch({ success: false, error: 'Worker has active shifts' }, false, 409);
    const result = await deleteWorker('w-1');
    expect(result.success).toBe(false);
    warn.mockRestore();
  });
});

// ─── availability ─────────────────────────────────────────────────────────────

describe('listWorkerAvailability', () => {
  it('returns availabilities from a successful response', async () => {
    mockFetch({ availabilities: [availability] });
    const result = await listWorkerAvailability('acc-1');
    expect(result).toEqual([availability]);
  });

  it('returns empty array on error', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockFetchReject('Network error');
    const result = await listWorkerAvailability('acc-1');
    expect(result).toEqual([]);
    warn.mockRestore();
  });
});

describe('upsertAvailability', () => {
  it('returns success with availability record', async () => {
    mockFetch({ success: true, availability });
    const result = await upsertAvailability(availability);
    expect(result.success).toBe(true);
    expect(result.availability).toEqual(availability);
  });

  it('returns failure on bad request', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockFetch({ success: false, error: 'Overlap detected' }, false, 400);
    const result = await upsertAvailability(availability);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Overlap detected');
    warn.mockRestore();
  });
});

describe('deleteAvailability', () => {
  it('returns success on 200', async () => {
    mockFetch({ success: true });
    const result = await deleteAvailability('av-1');
    expect(result.success).toBe(true);
  });
});

// ─── shift templates ──────────────────────────────────────────────────────────

describe('listShiftTemplates', () => {
  it('returns templates from a successful response', async () => {
    mockFetch({ templates: [template] });
    const result = await listShiftTemplates('acc-1');
    expect(result).toEqual([template]);
  });

  it('returns empty array on error', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockFetch({}, false, 500);
    const result = await listShiftTemplates('acc-1');
    expect(result).toEqual([]);
    warn.mockRestore();
  });
});

describe('upsertShiftTemplate', () => {
  it('returns success with template', async () => {
    mockFetch({ success: true, template });
    const result = await upsertShiftTemplate(template);
    expect(result.success).toBe(true);
    expect(result.template).toEqual(template);
  });
});

describe('deleteShiftTemplate', () => {
  it('returns success on 200', async () => {
    mockFetch({ success: true });
    const result = await deleteShiftTemplate('tmpl-1');
    expect(result.success).toBe(true);
  });
});

// ─── roster ───────────────────────────────────────────────────────────────────

describe('listRoster', () => {
  it('returns roster shifts from a successful response', async () => {
    mockFetch({ shifts: [shift] });
    const result = await listRoster('acc-1');
    expect(result).toEqual([shift]);
  });

  it('sends date filters when provided', async () => {
    mockFetch({ shifts: [] });
    await listRoster('acc-1', { fromDate: '2026-04-01', toDate: '2026-04-07' });
    expect((global as unknown as { fetch: jest.Mock }).fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({
          action: 'listRoster',
          fromDate: '2026-04-01',
          toDate: '2026-04-07',
          page: 0,
        }),
      })
    );
  });

  it('keeps a shift once when a later page repeats it (CHG-101)', async () => {
    const second = { ...shift, id: 'shift-2' };
    (global as unknown as { fetch: jest.Mock }).fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: jest.fn().mockResolvedValue({ shifts: [shift, second], hasMore: true }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: jest.fn().mockResolvedValue({ shifts: [second], hasMore: false }) });
    const result = await listRoster();
    expect(result.map((s) => s.id)).toEqual([shift.id, 'shift-2']);
  });

  it('returns empty array on error', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockFetchReject('Network error');
    const result = await listRoster('acc-1');
    expect(result).toEqual([]);
    warn.mockRestore();
  });
});

describe('upsertRosterShift', () => {
  it('returns success with the shift', async () => {
    mockFetch({ success: true, shift });
    const result = await upsertRosterShift(shift);
    expect(result.success).toBe(true);
    expect(result.shift).toEqual(shift);
  });

  it('returns failure on conflict', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockFetch({ success: false, error: 'Shift overlap detected' }, false, 409);
    const result = await upsertRosterShift(shift);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/overlap/i);
    warn.mockRestore();
  });
});

describe('updateShiftStatus', () => {
  it('sends the correct status to the proxy', async () => {
    mockFetch({ success: true });
    const result = await updateShiftStatus('shift-1', 'Published');
    expect(result.success).toBe(true);
    expect((global as unknown as { fetch: jest.Mock }).fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({ action: 'updateShiftStatus', id: 'shift-1', status: 'Published' }),
      })
    );
  });
});

describe('markShiftNotified', () => {
  it('sends markShiftNotified action', async () => {
    mockFetch({ success: true });
    const result = await markShiftNotified('shift-1');
    expect(result.success).toBe(true);
    expect((global as unknown as { fetch: jest.Mock }).fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({ action: 'markShiftNotified', id: 'shift-1' }),
      })
    );
  });
});

describe('deleteRosterShift', () => {
  it('returns success on 200', async () => {
    mockFetch({ success: true });
    const result = await deleteRosterShift('shift-1');
    expect(result.success).toBe(true);
  });
});

// ─── CHG-109 ─────────────────────────────────────────────────────────────────

describe('plan refusals reach the plan readers (F-3, F-10)', () => {
  it('a 402 answer is reported, and other refusals are not', async () => {
    const heard = jest.fn();
    const stop = onPlanRefusal(heard);
    mockFetch({ error: 'Your team has 14 people and the Gratis plan covers 10' }, false, 402);
    expect(await updateShiftStatus('shift-1', 'Published')).toMatchObject({ success: false });
    mockFetch({ error: 'Conflicting record' }, false, 409);
    await updateShiftStatus('shift-1', 'Published');
    stop();
    expect(heard).toHaveBeenCalledTimes(1);
  });
});

describe('deleteWorker with its shifts (F-11)', () => {
  it('sends withShifts only when asked', async () => {
    mockFetch({ success: true, removedShifts: 2 });
    await deleteWorker('w-1');
    await deleteWorker('w-1', { withShifts: true });
    const calls = (global as unknown as { fetch: jest.Mock }).fetch.mock.calls as [string, { body: string }][];
    expect(calls.map((c) => JSON.parse(c[1].body))).toEqual([
      { action: 'deleteWorker', id: 'w-1' },
      { action: 'deleteWorker', id: 'w-1', withShifts: true },
    ]);
  });
});
