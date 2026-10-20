/**
 * Native (and Jest): no Web Worker and no WebAssembly in Hermes, so auto-assign runs
 * the greedy inline. The web build uses createSolverWorker.web.ts.
 */
export const createSolverWorker = (): Worker | null => null;
