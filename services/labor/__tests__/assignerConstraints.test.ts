import { legalConstraintsFor, mergeConstraints } from '../assignerConstraints';

describe('legalConstraintsFor', () => {
  it('maps hard limits only', () => {
    expect(legalConstraintsFor('ES', '2026-10-19')).toEqual({ minRestHoursBetweenShifts: 12, maxDailyHours: 9, maxWeeklyHours: undefined });
    expect(legalConstraintsFor('FR', '2026-10-19')).toEqual({ minRestHoursBetweenShifts: 11, maxDailyHours: 10, maxWeeklyHours: 48 });
    expect(legalConstraintsFor('MX', '2030-01-07')).toEqual({ minRestHoursBetweenShifts: undefined, maxDailyHours: 12, maxWeeklyHours: undefined });
  });

  it('leaves warnings out (Peru rest, generic limits)', () => {
    expect(legalConstraintsFor('PE', '2026-10-19').minRestHoursBetweenShifts).toBeUndefined();
    expect(legalConstraintsFor('GENERIC', '2026-10-19')).toEqual({ minRestHoursBetweenShifts: undefined, maxDailyHours: undefined, maxWeeklyHours: undefined });
  });
});

describe('mergeConstraints', () => {
  it('keeps the stricter value per field', () => {
    expect(mergeConstraints({ maxDailyHours: 8, minRestHoursBetweenShifts: 10 }, { maxDailyHours: 9, minRestHoursBetweenShifts: 12, maxWeeklyHours: 48 }))
      .toEqual({ maxDailyHours: 8, maxWeeklyHours: 48, minRestHoursBetweenShifts: 12 });
    expect(mergeConstraints(undefined, {})).toEqual({ maxDailyHours: undefined, maxWeeklyHours: undefined, minRestHoursBetweenShifts: undefined });
  });
});
