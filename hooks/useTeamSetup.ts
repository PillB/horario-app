import { useCallback } from 'react';

import { log } from '@/services/logger';
import type { DbShiftTemplate } from '@/services/rosterService';
import type { ShiftTemplate } from '@/utils/schedulerMetrics';
import { useWorkers, type WorkerWithAvailability } from '@/hooks/useWorkers';

// ─── Types ────────────────────────────────────────────────────────────────────

export type BulkImportResult = {
  imported: number;
  errors: string[];
};

export type TeamSetupHook = ReturnType<typeof useTeamSetup>;

// ─── CSV helpers ──────────────────────────────────────────────────────────────

/**
 * Parses a single CSV row into cells, respecting double-quoted fields that may
 * contain commas.  Returns null if the row is blank or a header sentinel.
 */
const parseCSVRow = (
  raw: string,
): string[] | null => {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const cells: string[] = [];
  let current = '';
  let insideQuotes = false;

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];

    if (ch === '"') {
      if (insideQuotes && trimmed[i + 1] === '"') {
        // escaped quote
        current += '"';
        i++;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (ch === ',' && !insideQuotes) {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
};

/**
 * Escapes a single CSV cell value.  Wraps in quotes if the value contains
 * a comma, double-quote, or newline character.
 */
const escapeCSVCell = (value: string): string => {
  if (/[,"\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * useTeamSetup
 *
 * Wraps `useWorkers` and layers on:
 *  - `bulkImportWorkers`              — CSV → workers
 *  - `validateWorkerAgainstTemplates` — role-guard check
 *  - `exportWorkersCSV`               — dump current workers as CSV
 */
export const useTeamSetup = (accountId: string) => {
  const workersHook = useWorkers(accountId);
  const { workers, addWorker } = workersHook;

  // ── bulkImportWorkers ───────────────────────────────────────────────────────

  /**
   * Parses a CSV string whose columns are: name, role, skills
   * (skills is a pipe-separated list, e.g. "opening|closing|barista").
   *
   * A header row is detected by checking whether the first non-blank row's
   * first cell matches /^name$/i.  If so, it is skipped.
   *
   * Returns the number of successfully imported workers and any per-row error
   * messages so the caller can surface them to the user.
   */
  const bulkImportWorkers = useCallback(
    async (csv: string): Promise<BulkImportResult> => {
      const lines = csv.split(/\r?\n/);
      const errors: string[] = [];
      let imported = 0;

      // Determine whether a header row is present
      let startIndex = 0;
      const firstRow = parseCSVRow(lines[0] ?? '');
      if (firstRow && /^name$/i.test(firstRow[0] ?? '')) {
        startIndex = 1;
      }

      for (let i = startIndex; i < lines.length; i++) {
        const rawLine = lines[i];
        if (rawLine === undefined) continue;

        const cells = parseCSVRow(rawLine);
        if (cells === null) continue; // blank row

        const humanIndex = i + 1; // 1-based for error messages

        const name = cells[0] ?? '';
        const role = cells[1] ?? '';
        const skillsRaw = cells[2] ?? '';

        if (!name) {
          errors.push(`Row ${humanIndex}: "name" is required.`);
          continue;
        }
        if (!role) {
          errors.push(`Row ${humanIndex}: "role" is required for worker "${name}".`);
          continue;
        }

        const skills = skillsRaw
          ? skillsRaw
              .split('|')
              .map((s) => s.trim())
              .filter(Boolean)
          : [];

        try {
          const result = await addWorker(name, role, skills);
          if (result.success) {
            imported++;
            log.info('UI', 'Bulk-imported worker', { name, role });
          } else {
            errors.push(`Row ${humanIndex}: Failed to save "${name}" — ${result.error}`);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          errors.push(`Row ${humanIndex}: Unexpected error for "${name}" — ${message}`);
        }
      }

      log.info('UI', 'Bulk import complete', { imported, errorCount: errors.length });
      return { imported, errors };
    },
    [addWorker],
  );

  // ── validateWorkerAgainstTemplates ──────────────────────────────────────────

  /**
   * Returns a human-readable error string when no template in `templates`
   * matches the worker's role, or `null` when the worker is valid.
   *
   * Accepts either `ShiftTemplate` (UI layer) or `DbShiftTemplate` (DB layer)
   * so callers are not forced to convert.
   */
  const validateWorkerAgainstTemplates = useCallback(
    (
      worker: Pick<WorkerWithAvailability, 'name' | 'role'>,
      templates: Array<ShiftTemplate | DbShiftTemplate>,
    ): string | null => {
      if (templates.length === 0) {
        // No templates exist yet — warn but do not block
        return null;
      }

      const matchingTemplate = templates.find((t) => {
        const templateRole =
          'role' in t ? t.role : (t as DbShiftTemplate).role;
        return templateRole.trim().toLowerCase() === worker.role.trim().toLowerCase();
      });

      if (!matchingTemplate) {
        const knownRoles = [
          ...new Set(
            templates.map((t) => ('role' in t ? t.role : (t as DbShiftTemplate).role)),
          ),
        ].join(', ');
        return (
          `Worker "${worker.name}" has role "${worker.role}" which does not match ` +
          `any shift template. Known roles: ${knownRoles || 'none'}.`
        );
      }

      return null;
    },
    [],
  );

  // ── exportWorkersCSV ────────────────────────────────────────────────────────

  /**
   * Serialises the current in-memory worker list to a CSV string.
   *
   * Columns: name, role, skills (pipe-separated)
   *
   * The first row is always the header: name,role,skills
   */
  const exportWorkersCSV = useCallback((): string => {
    const header = 'name,role,skills';

    const rows = workers.map((w) => {
      const skillsCell = w.skills.join('|');
      return [
        escapeCSVCell(w.name),
        escapeCSVCell(w.role),
        escapeCSVCell(skillsCell),
      ].join(',');
    });

    return [header, ...rows].join('\n');
  }, [workers]);

  // ── Public surface ──────────────────────────────────────────────────────────

  return {
    ...workersHook,
    bulkImportWorkers,
    validateWorkerAgainstTemplates,
    exportWorkersCSV,
  };
};