/**
 * The ILP on every fixture of the greedy's regression and time-zone suites (CHG-085).
 *
 * Those suites are loaded here with `assignShifts` wrapped to record each input (their
 * own tests run unchanged, a second time). Then each recorded input goes through the
 * ILP with real HiGHS, which must:
 *   - return a schedule whose raw solver assignments all pass the hard-constraint
 *     re-check (`dropped === 0`: the LP rows encode overlap, rest and hours exactly),
 *   - cover at least as many positions as the greedy,
 *   - report the same shortfall reason codes as the greedy when coverage is equal.
 */
import * as assigner from '../shiftAssigner';
import type { AssignmentInput } from '../shiftAssigner';
import { createHighsSolver, type HighsModule } from '../optimizer/highsSolver';
import { optimizeAssignments } from '../optimizer/shiftOptimizer';

const recorded: AssignmentInput[] = [];
const realAssign = assigner.assignShifts;
jest.spyOn(assigner, 'assignShifts').mockImplementation((input) => {
  recorded.push(input);
  return realAssign(input);
});

/* eslint-disable @typescript-eslint/no-require-imports */
require('./shiftAssigner.regression.test');
require('./shiftAssigner.timezone.test');
const highs = createHighsSolver(require('highs') as () => Promise<HighsModule>);
/* eslint-enable @typescript-eslint/no-require-imports */

describe('ILP on the greedy fixtures', () => {
  it('is feasible, never covers less and explains shortfalls the same way', async () => {
    const inputs = recorded.splice(0);
    expect(inputs.length).toBeGreaterThan(30);
    const failures: string[] = [];
    let solved = 0;
    for (const [i, input] of inputs.entries()) {
      let greedy: assigner.AssignmentResult;
      try {
        greedy = realAssign(input);
      } catch {
        continue; // invalid-zone fixtures: the ILP throws the same RangeError (checked below)
      }
      const result = await optimizeAssignments(input, { solver: highs });
      solved++;
      const label = `#${i} ${input.date} ${input.timeZone ?? 'fixed'}`;
      if (result.solver.dropped > 0) failures.push(`${label}: ${result.solver.dropped} solver assignments broke a constraint`);
      if (result.assignments.length < greedy.assignments.length) {
        failures.push(`${label}: ILP ${result.assignments.length} < greedy ${greedy.assignments.length}`);
      }
      if (result.assignments.length === greedy.assignments.length) {
        const codes = (r: assigner.AssignmentResult) => r.unassigned.map((u) => `${u.templateId}:${u.reasonCode}:${u.missing}`).sort();
        if (codes(result).join() !== codes(greedy).join()) failures.push(`${label}: ${codes(result)} vs ${codes(greedy)}`);
      }
    }
    expect(solved).toBeGreaterThan(30);
    expect(failures).toEqual([]);
  });

  it('rejects an invalid time zone like the greedy', async () => {
    await expect(
      optimizeAssignments({ date: '2026-03-30', templates: [], workers: [], existingRoster: [], timeZone: 'Nowhere/Land' }, { solver: highs }),
    ).rejects.toThrow(RangeError);
  });
});
