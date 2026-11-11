/**
 * CHG-097: days off stored by the team step keep a worker out of auto-assign
 * on that date. `workersOffOn` reads the same storage the days-off card writes.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { workersOffOn } from '@/hooks/useAvailabilityGrid';

jest.mock('@/services/logger', () => ({ log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

const key = (workerId: string) => `@horario/availability_exceptions/${workerId}`;

describe('workersOffOn', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('returns only the workers with a day off on that date', async () => {
    await AsyncStorage.setItem(key('w1'), JSON.stringify([{ date: '2026-12-24', reason: 'Holiday', createdAt: 'x' }]));
    await AsyncStorage.setItem(key('w2'), JSON.stringify([{ date: '2026-12-25', reason: '', createdAt: 'x' }]));

    expect([...(await workersOffOn(['w1', 'w2', 'w3'], '2026-12-24'))]).toEqual(['w1']);
    expect([...(await workersOffOn(['w1', 'w2', 'w3'], '2026-12-26'))]).toEqual([]);
  });

  it('treats unreadable storage as no days off', async () => {
    await AsyncStorage.setItem(key('w1'), '{not json');
    expect((await workersOffOn(['w1'], '2026-12-24')).size).toBe(0);
  });
});
