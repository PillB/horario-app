/**
 * CHG-098: days off are stored through the proxy (`worker_time_off`), and the
 * days an earlier version kept on the device are uploaded once.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import renderer, { act } from 'react-test-renderer';

import { deleteTimeOff, fetchTimeOff, upsertTimeOff } from '@/services/rosterService';
import { fetchWorkersOffOn, useTimeOff } from '../useTimeOff';

jest.mock('@/services/logger', () => ({ log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('@/services/rosterService', () => ({
  fetchTimeOff: jest.fn(),
  upsertTimeOff: jest.fn(),
  deleteTimeOff: jest.fn(),
}));

const W1 = '11111111-1111-4111-8111-111111111111';
const W2 = '22222222-2222-4222-8222-222222222222';
const row = (id: string, workerId: string, date: string, reason = '') => ({ id, accountId: 'acc', workerId, date, reason });
const deviceKey = (workerId: string) => `@horario/availability_exceptions/${workerId}`;
const flush = async () => { await act(async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); }); };

const WORKERS = [W1, W2];

function renderHook() {
  let result: ReturnType<typeof useTimeOff> | null = null;
  function Consumer() {
    result = useTimeOff('acc', WORKERS);
    return null;
  }
  let tree: renderer.ReactTestRenderer | null = null;
  act(() => { tree = renderer.create(<Consumer />); });
  return { get: () => result!, unmount: () => act(() => { tree!.unmount(); }) };
}

describe('useTimeOff', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    (fetchTimeOff as jest.Mock).mockResolvedValue({ ok: true, data: [row('a', W1, '2026-12-24', 'Holiday')], truncated: false });
  });

  it('loads the stored days off', async () => {
    const hook = renderHook();
    await flush();
    expect(hook.get().timeOff).toEqual([{ id: 'a', workerId: W1, date: '2026-12-24', reason: 'Holiday' }]);
    hook.unmount();
  });

  it('shows a new day at once and keeps the stored row when the save succeeds', async () => {
    (upsertTimeOff as jest.Mock).mockResolvedValue({ success: true, timeOff: row('b', W2, '2026-12-25') });
    const hook = renderHook();
    await flush();
    await act(async () => { await hook.get().addTimeOff(W2, '2026-12-25', ' Family '); });
    expect(upsertTimeOff).toHaveBeenCalledWith({ workerId: W2, date: '2026-12-25', reason: 'Family' });
    expect(hook.get().timeOff.map((item) => item.id)).toEqual(['a', 'b']);
    hook.unmount();
  });

  it('takes the day back out when the server refuses it', async () => {
    (upsertTimeOff as jest.Mock).mockResolvedValue({ success: false, error: 'Only an admin of this business can change the schedule' });
    const hook = renderHook();
    await flush();
    let result: Awaited<ReturnType<ReturnType<typeof useTimeOff>['addTimeOff']>> | undefined;
    await act(async () => { result = await hook.get().addTimeOff(W2, '2026-12-25', ''); });
    expect(result).toEqual({ success: false, error: 'Only an admin of this business can change the schedule' });
    expect(hook.get().timeOff.map((item) => item.id)).toEqual(['a']);
    hook.unmount();
  });

  it('refuses a date that is not a real day without calling the server', async () => {
    const hook = renderHook();
    await flush();
    let result: { success: boolean } | undefined;
    await act(async () => { result = await hook.get().addTimeOff(W1, '2026-02-31', ''); });
    expect(result?.success).toBe(false);
    expect(upsertTimeOff).not.toHaveBeenCalled();
    hook.unmount();
  });

  it('restores a removed day when the delete fails', async () => {
    (deleteTimeOff as jest.Mock).mockResolvedValue({ success: false, error: 'Server error (500)' });
    const hook = renderHook();
    await flush();
    await act(async () => { await hook.get().removeTimeOff('a'); });
    expect(hook.get().timeOff.map((item) => item.id)).toEqual(['a']);
    hook.unmount();
  });

  it('uploads the days this device stored, and clears them only once saved', async () => {
    await AsyncStorage.setItem(deviceKey(W1), JSON.stringify([{ date: '2026-12-31', reason: 'Old', createdAt: 'x' }]));
    await AsyncStorage.setItem(deviceKey(W2), JSON.stringify([{ date: '2027-01-01', reason: '', createdAt: 'x' }]));
    (upsertTimeOff as jest.Mock).mockImplementation(async ({ workerId }: { workerId: string }) =>
      workerId === W1 ? { success: true, timeOff: row('c', W1, '2026-12-31', 'Old') } : { success: false, error: 'offline' });
    const hook = renderHook();
    await flush();
    await flush();
    expect(upsertTimeOff).toHaveBeenCalledWith({ workerId: W1, date: '2026-12-31', reason: 'Old' });
    expect(await AsyncStorage.getItem(deviceKey(W1))).toBeNull();
    expect(await AsyncStorage.getItem(deviceKey(W2))).not.toBeNull();
    hook.unmount();
  });
});

describe('fetchWorkersOffOn', () => {
  it('returns the workers off on the date', async () => {
    (fetchTimeOff as jest.Mock).mockResolvedValue({ ok: true, data: [row('a', W1, '2026-12-24')], truncated: false });
    const result = await fetchWorkersOffOn('2026-12-24');
    expect(fetchTimeOff).toHaveBeenCalledWith('2026-12-24');
    expect(result.ok && [...result.workerIds]).toEqual([W1]);
  });

  it('reports a failed read instead of "nobody is off"', async () => {
    (fetchTimeOff as jest.Mock).mockResolvedValue({ ok: false, error: 'Server error (500)' });
    expect(await fetchWorkersOffOn('2026-12-24')).toEqual({ ok: false, error: 'Server error (500)' });
  });
});
