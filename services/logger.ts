import { Platform } from 'react-native';

// ─── Types ───────────────────────────────────────────────────────────────────

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export type LogCategory =
  | 'ROSTER'
  | 'FORECAST'
  | 'WORKER'
  | 'TEMPLATE'
  | 'POS'
  | 'AUTH'
  | 'UI'
  | 'PERF';

export interface LogEntry {
  timestamp: string; // ISO-8601
  level: LogLevel;
  category: LogCategory;
  message: string;
  data?: Record<string, unknown>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const RING_BUFFER_SIZE = 100;

const LEVEL_RANK: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

/**
 * Minimum level that will be processed.
 * Production web builds suppress DEBUG + INFO to reduce noise.
 * Everything else (dev, native) logs all levels.
 */
const MIN_LEVEL: LogLevel =
  Platform.OS === 'web' && !__DEV__ ? 'WARN' : 'DEBUG';

// ─── PII / secret scrubbing ───────────────────────────────────────────────────

/**
 * Keys whose values must NEVER appear in logs.
 * Checked case-insensitively against every key in `data`.
 */
const BLOCKED_KEYS = new Set([
  'password',
  'passwd',
  'secret',
  'token',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'auth',
  'apikey',
  'api_key',
  'email',
  'name',
  'fullname',
  'full_name',
  'firstname',
  'first_name',
  'lastname',
  'last_name',
  'phone',
  'phonenumber',
  'phone_number',
  'ssn',
  'creditcard',
  'credit_card',
  'cvv',
  'pii',
]);

function isSensitiveKey(key: string): boolean {
  return BLOCKED_KEYS.has(key.toLowerCase().replace(/[-_ ]/g, ''));
}

/**
 * Recursively sanitise a data object so that sensitive keys are redacted.
 * Returns a new object — never mutates the original.
 */
function sanitise(
  value: unknown,
  depth = 0,
): Record<string, unknown> | unknown {
  if (depth > 5) return '[depth limit]';
  if (value === null || value === undefined) return value;

  if (Array.isArray(value)) {
    return value.map((item) => sanitise(item, depth + 1));
  }

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(
      value as Record<string, unknown>,
    )) {
      result[k] = isSensitiveKey(k) ? '[REDACTED]' : sanitise(v, depth + 1);
    }
    return result;
  }

  return value;
}

// ─── Ring buffer ──────────────────────────────────────────────────────────────

/**
 * Fixed-capacity circular buffer.
 * Oldest entries are silently dropped when capacity is reached.
 */
class RingBuffer<T> {
  private readonly capacity: number;
  private buf: T[] = [];

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  push(entry: T): void {
    if (this.buf.length >= this.capacity) {
      this.buf.shift(); // drop oldest
    }
    this.buf.push(entry);
  }

  toArray(): T[] {
    return [...this.buf];
  }

  clear(): void {
    this.buf = [];
  }

  get size(): number {
    return this.buf.length;
  }
}

// ─── Logger implementation ────────────────────────────────────────────────────

const buffer = new RingBuffer<LogEntry>(RING_BUFFER_SIZE);

/**
 * Core write function shared by all level helpers.
 */
function write(
  level: LogLevel,
  category: LogCategory,
  message: string,
  data?: Record<string, unknown>,
): void {
  // Level gate
  if (LEVEL_RANK[level] < LEVEL_RANK[MIN_LEVEL]) return;

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    category,
    message,
    ...(data !== undefined
      ? { data: sanitise(data) as Record<string, unknown> }
      : {}),
  };

  // Always persist to ring buffer regardless of console verbosity
  buffer.push(entry);

  // Console output — use appropriate console method for IDE highlighting
  const prefix = `[${entry.timestamp}] [${level}] [${category}]`;

  /* eslint-disable no-console */
  switch (level) {
    case 'DEBUG':
      console.debug(prefix, message, entry.data ?? '');
      break;
    case 'INFO':
      console.info(prefix, message, entry.data ?? '');
      break;
    case 'WARN':
      console.warn(prefix, message, entry.data ?? '');
      break;
    case 'ERROR':
      console.error(prefix, message, entry.data ?? '');
      break;
  }
  /* eslint-enable no-console */
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Structured logger for the Horario app.
 *
 * Usage:
 *   import { log } from '@/services/logger';
 *   log.info('ROSTER', 'Shift created', { shiftId, accountId });
 *
 * Never pass: passwords, tokens, email addresses, full names, or any PII.
 * Sensitive keys are automatically redacted, but keep payloads minimal.
 */
export const log = {
  debug(
    category: LogCategory,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    write('DEBUG', category, message, data);
  },

  info(
    category: LogCategory,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    write('INFO', category, message, data);
  },

  warn(
    category: LogCategory,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    write('WARN', category, message, data);
  },

  error(
    category: LogCategory,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    write('ERROR', category, message, data);
  },

  /**
   * Export the ring buffer as a JSON string suitable for copy-pasting to support.
   * All entries have already been sanitised at write time.
   */
  export(): string {
    return JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        platform: Platform.OS,
        dev: __DEV__,
        entryCount: buffer.size,
        entries: buffer.toArray(),
      },
      null,
      2,
    );
  },

  /**
   * Clear the in-memory ring buffer.
   * Does NOT affect any persisted data.
   */
  clear(): void {
    buffer.clear();
  },

  /**
   * Returns a snapshot of the current buffer contents.
   * Useful for in-app diagnostic displays.
   */
  getEntries(): LogEntry[] {
    return buffer.toArray();
  },
} as const;

// ─── Re-export types ──────────────────────────────────────────────────────────
// (already exported at declaration site — listed here for discoverability)
export type { LogEntry as AuditEntry };