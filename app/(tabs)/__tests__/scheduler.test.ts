import { DemandForecast } from '@/services/demandForecast';
import { Shift, ShiftTemplate, computeUncoveredLoss } from '@/app/(tabs)/schedulerMetrics';

describe('computeUncoveredLoss', () => {
  const templates: ShiftTemplate[] = [
    { id: 'support', name: 'Support Shift', role: 'Support', start: '09:00', end: '17:00', coverage: 2 },
  ];

  const target: DemandForecast = {
    date: '2024-12-12',
    role: 'Support',
    required: 3,
  };

  it('ignores draft shifts when calculating coverage', () => {
    const roster: Shift[] = [
      {
        id: 'published-1',
        date: '2024-12-12',
        workerId: 'W-1',
        templateId: 'support',
        location: 'HQ',
        status: 'Published',
      },
      {
        id: 'draft-1',
        date: '2024-12-12',
        workerId: 'W-2',
        templateId: 'support',
        location: 'HQ',
        status: 'Draft',
      },
    ];

    const result = computeUncoveredLoss([target], roster, templates, 100);

    expect(result.totalGap).toBe(1);
    expect(result.loss).toBe(100);
  });

  it('totals coverage only from published shifts across multiple roles', () => {
    const mixedTemplates: ShiftTemplate[] = [
      { id: 'front', name: 'Front Desk', role: 'Front Desk', start: '08:00', end: '12:00', coverage: 1 },
      { id: 'support', name: 'Support Shift', role: 'Support', start: '12:00', end: '20:00', coverage: 3 },
    ];

    const roster: Shift[] = [
      {
        id: 'published-front',
        date: '2024-12-13',
        workerId: 'W-3',
        templateId: 'front',
        location: 'HQ',
        status: 'Published',
      },
      {
        id: 'draft-support',
        date: '2024-12-13',
        workerId: 'W-4',
        templateId: 'support',
        location: 'HQ',
        status: 'Draft',
      },
    ];

    const results = computeUncoveredLoss(
      [
        { date: '2024-12-13', role: 'Front Desk', required: 1 },
        { date: '2024-12-13', role: 'Support', required: 2 },
      ],
      roster,
      mixedTemplates,
      50
    );

    expect(results.totalGap).toBe(2);
    expect(results.loss).toBe(100);
  });
});
