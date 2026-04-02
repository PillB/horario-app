import { useCallback, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import { log, type LogEntry } from '@/services/logger';

// Platform-safe clipboard helper (no external package required)
async function copyText(text: string): Promise<void> {
  if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
    await navigator.clipboard.writeText(text);
  } else {
    // On native, require Clipboard from react-native (deprecated but built-in)
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Clipboard } = require('react-native');
    Clipboard.setString(text);
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UseAuditLogResult {
  /** Snapshot of the in-memory ring buffer at last refresh. */
  entries: LogEntry[];
  /**
   * Copy the full log export JSON to the device clipboard.
   * Returns `true` on success, `false` if the clipboard API is unavailable.
   */
  copyToClipboard: () => Promise<boolean>;
  /** Clear the in-memory buffer and trigger a re-render. */
  clear: () => void;
  /** Manually refresh the entries snapshot (e.g. after new events). */
  refresh: () => void;
  /** ISO-8601 timestamp of the last refresh, or null before first refresh. */
  lastRefreshedAt: string | null;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * `useAuditLog` — surface the structured log ring buffer in a React component.
 *
 * Designed for a "Support Diagnostics" screen where a user or admin can
 * inspect recent activity and copy it to the clipboard for sharing.
 *
 * ### Example
 * ```tsx
 * const { entries, copyToClipboard, clear } = useAuditLog();
 *
 * return (
 *   <>
 *     <FlatList data={entries} keyExtractor={(e) => e.timestamp + e.message} … />
 *     <Button title={t('copyLogs')} onPress={copyToClipboard} />
 *     <Button title={t('clearLogs')} onPress={clear} />
 *   </>
 * );
 *
 *
 * ### Privacy
 * All entries have already been sanitised by the logger — no PII or tokens
 * will appear in the copied payload.
 */
export function useAuditLog(): UseAuditLogResult {
  // A simple counter drives re-renders without storing the full buffer in state
  // (which would cause a stale copy on every new log write).
  const [version, setVersion] = useState(0);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);

  /** Bump version → causes `entries` memo to recompute from live buffer. */
  const refresh = useCallback(() => {
    setVersion((v) => v + 1);
    setLastRefreshedAt(new Date().toISOString());
  }, []);

  /**
   * Snapshot of the ring buffer.
   * Recomputed whenever `version` changes (i.e. after refresh() or clear()).
   * `version` is referenced inside the memo so ESLint dep-array is satisfied.
   */
  const entries = useMemo<LogEntry[]>(
    () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      version; // declare dependency
      return log.getEntries();
    },
    [version], // re-read live buffer when version changes
  );

  /**
   * Copy the full sanitised log export (JSON) to the clipboard.
   * Shows a structured payload including platform, dev mode, and all entries.
   */
  const copyToClipboard = useCallback(async (): Promise<boolean> => {
    try {
      const payload = log.export();
      await copyText(payload);
      log.info('UI', 'Audit log copied to clipboard', {
        entryCount: entries.length,
      });
      return true;
    } catch (err) {
      log.warn('UI', 'Failed to copy audit log to clipboard', {
        errorMessage:
          err instanceof Error ? err.message : 'unknown error',
      });
      return false;
    }
  }, [entries.length]);

  /** Clear the ring buffer and re-render with an empty snapshot. */
  const clear = useCallback((): void => {
    log.clear();
    setLastRefreshedAt(new Date().toISOString());
    setVersion((v) => v + 1);
  }, []);

  return {
    entries,
    copyToClipboard,
    clear,
    refresh,
    lastRefreshedAt,
  };
}