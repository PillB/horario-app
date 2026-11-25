/* eslint-disable import/first */
const mockFetchRoster = jest.fn();
jest.mock('@/services/rosterService', () => ({ fetchRoster: (...args: unknown[]) => mockFetchRoster(...args) }));

import React, { useEffect } from 'react';
import renderer, { act } from 'react-test-renderer';

import { usePostingHabit, type PostingHabitState } from '../usePostingHabit';

const LOCATIONS = [{ jurisdictionCode: 'US-WA-SEATTLE', industry: 'retail' as const, timeZone: 'America/Los_Angeles' }];

function Probe({ onState, locations = LOCATIONS }: { onState: (s: PostingHabitState) => void; locations?: typeof LOCATIONS }) {
  const state = usePostingHabit('acct', locations, '2026-11-18');
  useEffect(() => { onState(state); });
  return null;
}

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe('usePostingHabit', () => {
  beforeEach(() => mockFetchRoster.mockReset());

  it('loads the habit window and computes the weeks from publish times', async () => {
    mockFetchRoster.mockResolvedValue({
      ok: true, truncated: false,
      data: [{ id: '1', accountId: 'acct', date: '2026-11-16', workerId: 'w', templateId: 't', location: '', status: 'Published', notified: false, publishedAt: '2026-11-02T18:00:00.000Z' }],
    });
    let last: PostingHabitState | null = null;
    await act(async () => { renderer.create(<Probe onState={(s) => { last = s; }} />); });
    await flush();
    expect(mockFetchRoster).toHaveBeenCalledWith({ fromDate: '2026-09-28', toDate: '2026-12-06' });
    expect(last!.loading).toBe(false);
    expect(last!.goal).toEqual({ days: 7, lawDays: null, ifCoveredDays: 14 });
    expect(last!.habit?.weeks.find((w) => w.weekStart === '2026-11-16')?.verdict).toBe('ahead');
  });

  it('reports a failed load instead of an empty habit', async () => {
    mockFetchRoster.mockResolvedValue({ ok: false, error: 'Network down' });
    let last: PostingHabitState | null = null;
    await act(async () => { renderer.create(<Probe onState={(s) => { last = s; }} />); });
    await flush();
    expect(last!.habit).toBeNull();
    expect(last!.error).toBe('Network down');
  });
});
