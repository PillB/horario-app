import { findCoveringAvailability, getWeekdayFromDate, ShiftTemplate, Worker } from '../scheduler';

describe('getWeekdayFromDate', () => {
  it('derives weekday using a supplied timezone offset to account for local boundaries', () => {
    const backwardTimezoneOffsetMinutes = -720; // UTC-12
    expect(getWeekdayFromDate('2024-06-01', backwardTimezoneOffsetMinutes)).toBe('Fri');
  });
});

describe('findCoveringAvailability', () => {
  const template: ShiftTemplate = {
    id: 'morning',
    name: 'Morning Coverage',
    role: 'Support',
    start: '08:00',
    end: '12:00',
    coverage: 1,
  };

  const worker: Worker = {
    id: 'W-UTC12',
    name: 'Pacific Ops',
    role: 'Support',
    skills: [],
    availability: [{ day: 'Fri', from: '07:00', to: '16:00' }],
  };

  it('acknowledges coverage when the timezone-adjusted weekday matches availability', () => {
    const { coveringSlot, weekdayLabel } = findCoveringAvailability(
      worker,
      template,
      '2024-06-01',
      -720 // UTC-12 pushes the label to the prior weekday
    );

    expect(weekdayLabel).toBe('Fri');
    expect(coveringSlot).toEqual(worker.availability[0]);
  });
});
