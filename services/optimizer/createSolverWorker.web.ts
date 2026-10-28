/**
 * Starts the auto-assign Web Worker (web). Returns null when this browser has no
 * Worker. `require.unstable_resolveWorker` makes Metro bundle solverWorker.ts as its
 * own script and returns that script's URL; unlike `new URL(…, import.meta.url)` it
 * leaves no `import.meta` in the main bundle, which is a classic (non-module) script.
 */
type WorkerRequire = { unstable_resolveWorker(path: string): string };

export const createSolverWorker = (): Worker | null => {
  if (typeof Worker === 'undefined') return null;
  const url = (require as unknown as WorkerRequire).unstable_resolveWorker('./solverWorker');
  return new Worker(url, { name: 'horario-auto-assign' });
};
