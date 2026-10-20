/** Messages between the auto-assign client and its Web Worker (CHG-085). */
import type { OptimizeInput } from './assignmentModel';
import type { OptimizedAssignmentResult } from './shiftOptimizer';

export type SolverRequest = { id: number; input: OptimizeInput; timeLimitMs: number };

export type SolverResponse =
  | { id: number; ok: true; result: OptimizedAssignmentResult }
  | { id: number; ok: false; error: string };
