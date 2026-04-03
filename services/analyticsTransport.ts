import { clearInterval, setInterval } from 'timers';

export type TransportEvent = {
  id: string;
  event: string;
  props?: Record<string, string | number | boolean>;
  ts: number;
  account_id?: string;
  user_id?: string;
};

export type TransportConfig = {
  endpointUrl: string;
  batchSize?: number;
  flushIntervalMs?: number;
  maxRetries?: number;
  headers?: Record<string, string>;
};

type BatchInFlight = {
  events: TransportEvent[];
  retries: number;
};

const MAX_QUEUE_SIZE = 500;
const MAX_DELIVERED_IDS = 1000;
const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_FLUSH_INTERVAL_MS = 5000;
const DEFAULT_MAX_RETRIES = 3;

let _endpointUrl: string = '';
let _batchSize: number = DEFAULT_BATCH_SIZE;
let _flushIntervalMs: number = DEFAULT_FLUSH_INTERVAL_MS;
let _maxRetries: number = DEFAULT_MAX_RETRIES;
let _headers: Record<string, string> = {};

let _queue: TransportEvent[] = [];
let _deliveredIds: string[] = [];
let _deliveredIdSet: Set<string> = new Set();
let _intervalHandle: ReturnType<typeof setInterval> | null = null;
let _flushing: boolean = false;

function _addDeliveredId(id: string): void {
  if (_deliveredIdSet.has(id)) {
    return;
  }
  if (_deliveredIds.length >= MAX_DELIVERED_IDS) {
    const evicted = _deliveredIds.shift();
    if (evicted !== undefined) {
      _deliveredIdSet.delete(evicted);
    }
  }
  _deliveredIds.push(id);
  _deliveredIdSet.add(id);
}

function _isOnline(): boolean {
  try {
    if (typeof navigator !== 'undefined' && 'onLine' in navigator) {
      return navigator.onLine;
    }
  } catch (_e) {
    // best-effort
  }
  return true;
}

function _prependToQueue(events: TransportEvent[]): void {
  const available = MAX_QUEUE_SIZE - _queue.length;
  if (available <= 0) {
    return;
  }
  const toRequeue = events.slice(0, available);
  _queue = [...toRequeue, ..._queue];
}

async function _attemptDeliver(batch: BatchInFlight): Promise<void> {
  const { events, retries } = batch;

  const deduplicated = events.filter((evt) => !_deliveredIdSet.has(evt.id));

  if (deduplicated.length === 0) {
    return;
  }

  let response: Response;

  try {
    response = await fetch(_endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ..._headers,
      },
      body: JSON.stringify({ events: deduplicated }),
    });
  } catch (_networkError) {
    if (retries < _maxRetries) {
      _prependToQueue(deduplicated);
    } else {
      console.warn(
        '[analyticsTransport] Discarding batch after max retries (network error):',
        deduplicated.map((e) => e.id),
      );
    }
    return;
  }

  const status = response.status;

  if (status >= 200 && status <= 299) {
    for (const evt of deduplicated) {
      _addDeliveredId(evt.id);
    }
    return;
  }

  if (status >= 400 && status <= 499) {
    console.warn(
      '[analyticsTransport] Discarding batch due to 4xx client error:',
      status,
      deduplicated.map((e) => e.id),
    );
    return;
  }

  if (status >= 500 || status === 429) {
    if (retries < _maxRetries) {
      _prependToQueue(deduplicated);
    } else {
      console.warn(
        '[analyticsTransport] Discarding batch after max retries (server error):',
        status,
        deduplicated.map((e) => e.id),
      );
    }
    return;
  }

  console.warn(
    '[analyticsTransport] Unexpected HTTP status, discarding batch:',
    status,
  );
}

async function _flush(): Promise<void> {
  if (_flushing) {
    return;
  }

  if (_queue.length === 0) {
    return;
  }

  if (!_isOnline()) {
    return;
  }

  if (_endpointUrl === '') {
    return;
  }

  _flushing = true;

  try {
    while (_queue.length > 0) {
      if (!_isOnline()) {
        break;
      }

      const batch = _queue.splice(0, _batchSize);
      const inFlight: BatchInFlight = { events: batch, retries: 0 };

      let delivered = false;
      let currentRetries = 0;

      while (!delivered && currentRetries <= _maxRetries) {
        const deduplicated = inFlight.events.filter(
          (evt) => !_deliveredIdSet.has(evt.id),
        );

        if (deduplicated.length === 0) {
          delivered = true;
          break;
        }

        if (!_isOnline()) {
          _prependToQueue(deduplicated);
          delivered = true;
          break;
        }

        let response: Response | null = null;
        let networkFailed = false;

        try {
          response = await fetch(_endpointUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ..._headers,
            },
            body: JSON.stringify({ events: deduplicated }),
          });
        } catch (_networkError) {
          networkFailed = true;
        }

        if (networkFailed) {
          currentRetries += 1;
          if (currentRetries > _maxRetries) {
            console.warn(
              '[analyticsTransport] Discarding batch after max retries (network error):',
              deduplicated.map((e) => e.id),
            );
            delivered = true;
          }
          continue;
        }

        if (response === null) {
          delivered = true;
          break;
        }

        const status = response.status;

        if (status >= 200 && status <= 299) {
          for (const evt of deduplicated) {
            _addDeliveredId(evt.id);
          }
          delivered = true;
          break;
        }

        if (status >= 400 && status <= 499) {
          console.warn(
            '[analyticsTransport] Discarding batch due to 4xx client error:',
            status,
            deduplicated.map((e) => e.id),
          );
          delivered = true;
          break;
        }

        if (status >= 500 || status === 429) {
          currentRetries += 1;
          if (currentRetries > _maxRetries) {
            console.warn(
              '[analyticsTransport] Discarding batch after max retries (server error):',
              status,
              deduplicated.map((e) => e.id),
            );
            delivered = true;
          }
          continue;
        }

        console.warn(
          '[analyticsTransport] Unexpected HTTP status, discarding batch:',
          status,
        );
        delivered = true;
      }
    }
  } catch (_unexpectedError) {
    // swallow all unexpected errors — analytics must never break the app
  } finally {
    _flushing = false;
  }
}

function _startInterval(): void {
  if (_intervalHandle !== null) {
    clearInterval(_intervalHandle);
  }
  _intervalHandle = setInterval(() => {
    _flush().catch(() => {
      // swallow
    });
  }, _flushIntervalMs);
}

export function configureTransport(cfg: TransportConfig): void {
  try {
    _endpointUrl = cfg.endpointUrl;
    _batchSize =
      cfg.batchSize !== undefined && cfg.batchSize > 0
        ? cfg.batchSize
        : DEFAULT_BATCH_SIZE;
    _flushIntervalMs =
      cfg.flushIntervalMs !== undefined && cfg.flushIntervalMs > 0
        ? cfg.flushIntervalMs
        : DEFAULT_FLUSH_INTERVAL_MS;
    _maxRetries =
      cfg.maxRetries !== undefined && cfg.maxRetries >= 0
        ? cfg.maxRetries
        : DEFAULT_MAX_RETRIES;
    _headers = cfg.headers !== undefined ? { ...cfg.headers } : {};

    _startInterval();
  } catch (_e) {
    // swallow
  }
}

export function enqueue(evt: TransportEvent): void {
  try {
    if (_queue.length >= MAX_QUEUE_SIZE) {
      console.warn(
        '[analyticsTransport] Queue full, dropping event:',
        evt.id,
      );
      return;
    }

    if (_deliveredIdSet.has(evt.id)) {
      return;
    }

    _queue.push(evt);

    if (_intervalHandle === null && _endpointUrl !== '') {
      _startInterval();
    }
  } catch (_e) {
    // swallow — analytics must never break the app
  }
}