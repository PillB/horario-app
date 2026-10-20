/**
 * Auto-assign client (CHG-085): worker round trip, timeout, cancellation and every
 * inline fallback. The Worker is faked at the createSolverWorker boundary; the "worker"
 * runs the real optimizer with Node's HiGHS, so the protocol is exercised end to end.
 */
import type { AssignmentInput } from '../shiftAssigner';
import { createSolverWorker } from '../optimizer/createSolverWorker';
import { createHighsSolver, type HighsModule } from '../optimizer/highsSolver';
import { optimizeAssignments } from '../optimizer/shiftOptimizer';
import { runAutoAssign, terminateSolverWorker } from '../optimizer/autoAssignClient';
import type { SolverRequest, SolverResponse } from '../optimizer/solverProtocol';
import type { ShiftTemplate } from '@/utils/schedulerMetrics';
import type { Worker as Staff } from '@/types/scheduler';

jest.mock('../optimizer/createSolverWorker', () => ({ createSolverWorker: jest.fn() }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const highs = createHighsSolver(require('highs') as () => Promise<HighsModule>);

const template = (id: string, start: string, end: string): ShiftTemplate => ({ id, name: id, role: 'Cook', start, end, coverage: 1 });
const staff = (id: string, to: string): Staff => ({
  id,
  displayId: id,
  name: id,
  role: 'Cook',
  skills: [],
  availability: [{ day: 'Mon', from: '08:00', to }],
});

// The first-fit trap from shiftOptimizer.test.ts: the greedy fills 1 of 2, the ILP 2.
const trap: AssignmentInput = {
  date: '2026-03-23',
  timeZone: 'Europe/Madrid',
  templates: [template('morning', '09:00', '17:00'), template('late', '12:00', '20:00')],
  workers: [staff('w1', '21:00'), staff('w2', '17:00')],
  existingRoster: [],
};

type Mode = 'solve' | 'silent' | 'fail' | 'crash';

class FakeWorker {
  onmessage: ((event: MessageEvent<SolverResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  received: SolverRequest[] = [];
  constructor(private mode: Mode) {}
  postMessage(request: SolverRequest): void {
    this.received.push(request);
    const reply = (response: SolverResponse) => this.onmessage?.({ data: response } as MessageEvent<SolverResponse>);
    if (this.mode === 'solve') {
      // Structured clone, as postMessage would do.
      const input = JSON.parse(JSON.stringify(request.input));
      void optimizeAssignments(input, { solver: highs, timeLimitMs: request.timeLimitMs }).then((result) =>
        reply({ id: request.id, ok: true, result }),
      );
    } else if (this.mode === 'fail') {
      setTimeout(() => reply({ id: request.id, ok: false, error: 'boom' }), 0);
    } else if (this.mode === 'crash') {
      setTimeout(() => this.onerror?.({ message: 'script error', preventDefault: () => undefined } as ErrorEvent), 0);
    }
  }
  terminate(): void {
    this.terminated = true;
  }
}

const mockCreate = createSolverWorker as jest.Mock;
const useWorker = (mode: Mode): FakeWorker => {
  const worker = new FakeWorker(mode);
  mockCreate.mockReturnValue(worker);
  return worker;
};

afterEach(() => {
  terminateSolverWorker();
  mockCreate.mockReset();
});

describe('runAutoAssign', () => {
  it('runs the ILP in the worker and returns its schedule', async () => {
    const worker = useWorker('solve');
    const result = await runAutoAssign(trap, { timeLimitMs: 3000 });
    expect(result.solver.engine).toBe('ilp');
    expect(result.assignments).toHaveLength(2);
    expect(worker.received[0]).toMatchObject({ timeLimitMs: 3000, input: { date: trap.date } });
  });

  it('reuses one worker across runs', async () => {
    useWorker('solve');
    await runAutoAssign(trap);
    await runAutoAssign(trap);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('runs the greedy inline when there is no Worker (native)', async () => {
    mockCreate.mockReturnValue(null);
    const result = await runAutoAssign(trap);
    expect(result.solver).toMatchObject({ engine: 'greedy', fallbackReason: 'no_solver' });
    expect(result.assignments).toHaveLength(1);
  });

  it('falls back when the worker cannot be created', async () => {
    mockCreate.mockImplementation(() => {
      throw new Error('SecurityError');
    });
    const result = await runAutoAssign(trap);
    expect(result.solver).toMatchObject({ engine: 'greedy', fallbackReason: 'worker_error', error: 'SecurityError' });
  });

  it('falls back when the worker reports an error', async () => {
    useWorker('fail');
    const result = await runAutoAssign(trap);
    expect(result.solver).toMatchObject({ engine: 'greedy', fallbackReason: 'worker_error', error: 'boom' });
  });

  it('falls back and drops the worker when it crashes', async () => {
    const worker = useWorker('crash');
    const result = await runAutoAssign(trap);
    expect(result.solver).toMatchObject({ engine: 'greedy', fallbackReason: 'worker_error', error: 'script error' });
    expect(worker.terminated).toBe(true);
  });

  it('times out, terminates the worker and returns the greedy', async () => {
    jest.useFakeTimers();
    try {
      const worker = useWorker('silent');
      const pending = runAutoAssign(trap, { timeLimitMs: 100, graceMs: 50 });
      jest.advanceTimersByTime(151);
      const result = await pending;
      expect(result.solver).toMatchObject({ engine: 'greedy', fallbackReason: 'timeout' });
      expect(result.assignments).toHaveLength(1);
      expect(worker.terminated).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('rejects with AbortError when cancelled, and terminates the worker', async () => {
    const worker = useWorker('silent');
    const controller = new AbortController();
    const pending = runAutoAssign(trap, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.terminated).toBe(true);

    await expect(runAutoAssign(trap, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('gives a run waiting on a cancelled worker the greedy result', async () => {
    useWorker('silent');
    const controller = new AbortController();
    const first = runAutoAssign(trap, { signal: controller.signal });
    const second = runAutoAssign(trap);
    controller.abort();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await expect(second).resolves.toMatchObject({ solver: { engine: 'greedy', fallbackReason: 'worker_error' } });
  });

  it('rejects when the input itself is invalid', async () => {
    mockCreate.mockReturnValue(null);
    await expect(runAutoAssign({ ...trap, timeZone: 'Mars/Olympus' })).rejects.toThrow(RangeError);
  });
});
