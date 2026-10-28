/**
 * Web Worker entry for auto-assign (CHG-085, web only).
 *
 * Bundled by Metro as its own script: createSolverWorker.web.ts references it with
 * `require.unstable_resolveWorker`. It runs the whole optimizer (greedy, ILP model,
 * HiGHS, repair) off the main thread and loads HiGHS's WebAssembly once per worker.
 *
 * `highs` is loaded with `require` so Metro picks its CommonJS build: the ES module
 * build uses `import.meta.url`, which is a syntax error in a classic worker script.
 * The WASM file is a Metro asset (`wasm` is in assetExts); on web it resolves to its
 * URL. HiGHS here is single-threaded and needs no SharedArrayBuffer or
 * cross-origin isolation.
 */
import { createHighsSolver, type HighsModule } from './highsSolver';
import { optimizeAssignments } from './shiftOptimizer';
import type { SolverRequest, SolverResponse } from './solverProtocol';

type HighsLoader = (options: { locateFile(file: string): string }) => Promise<HighsModule>;

const resolveWasmUrl = (asset: unknown): string => {
  if (typeof asset === 'string') return asset;
  const uri = (asset as { uri?: unknown; default?: unknown } | null)?.uri ?? (asset as { default?: unknown } | null)?.default;
  if (typeof uri === 'string') return uri;
  throw new Error('HiGHS WebAssembly asset URL could not be resolved');
};

const solver = createHighsSolver(async () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const loadHighs = require('highs') as HighsLoader;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const wasmUrl = resolveWasmUrl(require('highs/runtime'));
  return loadHighs({ locateFile: () => wasmUrl });
});

type WorkerScope = {
  onmessage: ((event: MessageEvent<SolverRequest>) => void) | null;
  postMessage(message: SolverResponse): void;
};

const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  const { id, input, timeLimitMs } = event.data;
  optimizeAssignments(input, { solver, timeLimitMs }).then(
    (result) => scope.postMessage({ id, ok: true, result }),
    (err: unknown) => scope.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) }),
  );
};
