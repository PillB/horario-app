/**
 * LpSolver backed by HiGHS (npm `highs`, MIT, single-threaded WebAssembly).
 *
 * The loader is injected so this file never imports the WASM package itself: the Web
 * Worker passes the browser loader (services/optimizer/solverWorker.ts), tests and the
 * benchmark pass Node's. The persistent model API is used because it reports whether a
 * time-limited run holds a feasible incumbent (`primal_solution_status`); the one-shot
 * `solve()` returns zeros either way.
 */
import type { LpSolution, LpSolver } from './shiftOptimizer';

/** The part of the `highs` module this adapter uses. */
export type HighsModule = {
  withModel<T>(
    model: { format: 'lp'; data: string },
    callback: (model: {
      options: { set(values: Record<string, string | number | boolean>): void };
      info: { get(name: string): number };
      run(): unknown;
      getModelStatus(): number;
      getSolution(): { colValue: ArrayLike<number> };
      getColName(index: number): string;
    }) => T,
  ): T;
};

/** HiGHS model status codes (HighsModelStatus) that this app reports by name. */
const MODEL_STATUS: Record<number, string> = {
  7: 'Optimal',
  8: 'Infeasible',
  13: 'Time limit reached',
  14: 'Iteration limit reached',
  15: 'Unknown',
  17: 'Interrupted',
};

/** primal_solution_status: 2 = feasible. */
const FEASIBLE = 2;

export function createHighsSolver(load: () => Promise<HighsModule>): LpSolver {
  let instance: Promise<HighsModule> | null = null;
  return async (lp, { timeLimitSeconds }): Promise<LpSolution> => {
    instance ??= load();
    let highs: HighsModule;
    try {
      highs = await instance;
    } catch (err) {
      instance = null; // let a later run retry the download
      throw err;
    }
    try {
      return highs.withModel({ format: 'lp', data: lp }, (model) => {
        model.options.set({ output_flag: false, time_limit: Math.max(0.01, timeLimitSeconds) });
        model.run();
        const code = model.getModelStatus();
        const status = MODEL_STATUS[code] ?? `HiGHS status ${code}`;
        if (model.info.get('primal_solution_status') !== FEASIBLE) return { status, values: null };
        const colValue = model.getSolution().colValue;
        const values: Record<string, number> = {};
        for (let i = 0; i < colValue.length; i++) values[model.getColName(i)] = colValue[i];
        return { status, values };
      });
    } catch (err) {
      instance = null; // an Emscripten abort leaves the module unusable
      throw err;
    }
  };
}
