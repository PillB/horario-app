/**
 * Runs auto-assign off the main thread (CHG-085).
 *
 * On web, a shared Web Worker runs optimizeAssignments (greedy + HiGHS ILP, best of the
 * two). Each request gets the solver budget plus a grace period for loading the WASM;
 * past that the worker is terminated and the greedy runs inline. A cancelled request
 * (AbortSignal) terminates the worker too and rejects with an AbortError. Requests
 * that were waiting on a terminated or crashed worker get the inline greedy result.
 *
 * On native (no Worker, no WebAssembly in Hermes), or when the worker cannot start,
 * the greedy runs inline. Web without Worker support also gets the greedy: HiGHS on the
 * main thread would freeze the page for the whole time limit.
 */
import { createSolverWorker } from './createSolverWorker';
import type { OptimizeInput } from './assignmentModel';
import {
  DEFAULT_TIME_LIMIT_MS,
  greedyAssign,
  type FallbackReason,
  type OptimizedAssignmentResult,
} from './shiftOptimizer';
import type { SolverRequest, SolverResponse } from './solverProtocol';

export type RunAutoAssignOptions = {
  /** Solver budget in ms (default 2000). */
  timeLimitMs?: number;
  /** Extra time allowed for starting the worker and loading the WASM (default 8000). */
  graceMs?: number;
  signal?: AbortSignal;
};

export const DEFAULT_GRACE_MS = 8000;

type Settle = (response: SolverResponse | { id: number; ok: false; error: string; reason: FallbackReason }) => void;

type SharedWorker = { worker: Worker; pending: Map<number, Settle> };

let shared: SharedWorker | null = null;
let nextId = 1;

export const abortError = (): Error => Object.assign(new Error('Auto-assign was cancelled.'), { name: 'AbortError' });

/** The greedy result, run on this thread, labelled with why the ILP was not used. */
export function inlineGreedy(input: OptimizeInput, reason: FallbackReason, error?: string): OptimizedAssignmentResult {
  return {
    ...greedyAssign(input),
    solver: {
      engine: 'greedy',
      fallbackReason: reason,
      ...(error ? { error } : {}),
      stages: [],
      optimal: false,
      solveMs: 0,
      variables: 0,
      constraints: 0,
      dropped: 0,
    },
  };
}

/** Terminates the shared worker; requests still waiting on it fall back to the greedy. */
export function terminateSolverWorker(reason: FallbackReason = 'worker_error', error = 'The auto-assign worker stopped.'): void {
  const current = shared;
  shared = null;
  if (!current) return;
  current.worker.terminate();
  for (const [id, settle] of current.pending) settle({ id, ok: false, error, reason });
  current.pending.clear();
}

const getWorker = (): SharedWorker | null => {
  if (shared) return shared;
  const worker = createSolverWorker();
  if (!worker) return null;
  const handle: SharedWorker = { worker, pending: new Map() };
  worker.onmessage = (event: MessageEvent<SolverResponse>) => {
    const settle = handle.pending.get(event.data.id);
    if (!settle) return;
    handle.pending.delete(event.data.id);
    settle(event.data);
  };
  worker.onerror = (event: ErrorEvent) => {
    event.preventDefault?.();
    if (shared === handle) terminateSolverWorker('worker_error', event.message || 'The auto-assign worker failed.');
  };
  shared = handle;
  return handle;
};

export function runAutoAssign(input: OptimizeInput, options: RunAutoAssignOptions = {}): Promise<OptimizedAssignmentResult> {
  const { signal } = options;
  const timeLimitMs = options.timeLimitMs ?? DEFAULT_TIME_LIMIT_MS;
  if (signal?.aborted) return Promise.reject(abortError());

  let handle: SharedWorker | null;
  try {
    handle = getWorker();
  } catch (err) {
    return Promise.resolve(inlineGreedy(input, 'worker_error', err instanceof Error ? err.message : String(err)));
  }
  if (!handle) {
    try {
      return Promise.resolve(inlineGreedy(input, 'no_solver'));
    } catch (err) {
      return Promise.reject(err);
    }
  }
  const worker = handle;

  return new Promise<OptimizedAssignmentResult>((resolve, reject) => {
    const id = nextId++;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => {
      cleanup();
      worker.pending.delete(id);
      terminateSolverWorker('worker_error', 'Another auto-assign run was cancelled.');
      reject(abortError());
    };
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const fallback = (reason: FallbackReason, error?: string) => {
      try {
        resolve(inlineGreedy(input, reason, error));
      } catch (err) {
        reject(err);
      }
    };

    worker.pending.set(id, (response) => {
      cleanup();
      if (response.ok) resolve(response.result);
      else fallback('reason' in response ? response.reason : 'worker_error', response.error);
    });
    timer = setTimeout(() => {
      cleanup();
      worker.pending.delete(id);
      terminateSolverWorker('timeout', 'Another auto-assign run timed out.');
      fallback('timeout', `No answer within ${timeLimitMs + (options.graceMs ?? DEFAULT_GRACE_MS)} ms.`);
    }, timeLimitMs + (options.graceMs ?? DEFAULT_GRACE_MS));
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const request: SolverRequest = { id, input, timeLimitMs };
      worker.worker.postMessage(request);
    } catch (err) {
      cleanup();
      worker.pending.delete(id);
      fallback('worker_error', err instanceof Error ? err.message : String(err));
    }
  });
}
