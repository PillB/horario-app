/**
 * shiftMessaging.ts — Shift-context communication primitives.
 *
 * Provides typed message structures, preset templates, and async helpers
 * for sending, retrieving, and claiming shift messages via the secure proxy
 * and Supabase directly.
 *
 * Never import server-only modules here; this runs on the client.
 */

import { trackEvent } from './analytics';

// ─── Core Types ───────────────────────────────────────────────────────────────

export type ShiftMessage = {
  id: string;
  shiftId: string;
  templateId?: string;
  date: string;
  role: string;
  type: 'broadcast' | 'coverage_request' | 'swap_request';
  body: string;
  sentBy: string;
  createdAt: number;
  status: 'sent' | 'delivered' | 'claimed';
  claimedBy?: string;
};

export type MessageTemplate = {
  id: string;
  label: string;
  body: string;
  type: ShiftMessage['type'];
};

// ─── Preset Templates ─────────────────────────────────────────────────────────

export const PRESET_TEMPLATES: readonly MessageTemplate[] = [
  {
    id: 'tpl_need_replacement',
    label: 'Need replacement [shift details]',
    body: 'We need a replacement for this shift. Please respond if you are available to cover.',
    type: 'coverage_request',
  },
  {
    id: 'tpl_shift_available',
    label: 'Shift available to pick up',
    body: 'A shift is available for pick-up. First eligible team member to respond will be assigned.',
    type: 'broadcast',
  },
  {
    id: 'tpl_urgent_coverage',
    label: 'Urgent: coverage needed today',
    body: 'Urgent: we need coverage for a shift today. Please respond immediately if you can help.',
    type: 'coverage_request',
  },
  {
    id: 'tpl_reminder_tomorrow',
    label: 'Reminder: shift tomorrow',
    body: 'This is a reminder that you have a shift scheduled for tomorrow. Please confirm your attendance.',
    type: 'broadcast',
  },
  {
    id: 'tpl_schedule_change',
    label: 'Schedule change notice',
    body: 'Please note that the schedule has been updated. Review your upcoming shifts for any changes.',
    type: 'broadcast',
  },
] as const;

// ─── Internal Helpers ─────────────────────────────────────────────────────────

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function buildAuthHeaders(authToken: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (authToken !== null && authToken.length > 0) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  return headers;
}

type ProxyErrorBody = {
  error?: string;
  message?: string;
};

async function extractErrorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as ProxyErrorBody;
    return body.error ?? body.message ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

// ─── sendShiftMessage ─────────────────────────────────────────────────────────

/**
 * POST a new shift message through the secure proxy.
 * Assigns a client-generated id, createdAt timestamp, and initial status.
 * Emits analytics based on message type.
 */
export async function sendShiftMessage(
  msg: Omit<ShiftMessage, 'id' | 'createdAt' | 'status'>,
  proxyUrl: string,
  authToken: string | null,
): Promise<ShiftMessage> {
  const now = Date.now();

  const outbound: ShiftMessage = {
    ...msg,
    id: generateId(),
    createdAt: now,
    status: 'sent',
  };

  const res = await fetch(`${proxyUrl}/shift-messages`, {
    method: 'POST',
    headers: buildAuthHeaders(authToken),
    body: JSON.stringify(outbound),
  });

  if (!res.ok) {
    const detail = await extractErrorMessage(res);
    throw new Error(`sendShiftMessage failed: ${detail}`);
  }

  // The proxy may return an enriched record (e.g. server-assigned id).
  // We accept it if the shape is valid, otherwise fall back to the outbound record.
  let confirmed: ShiftMessage = outbound;
  try {
    const body = (await res.json()) as Partial<ShiftMessage>;
    if (
      typeof body.id === 'string' &&
      typeof body.shiftId === 'string' &&
      typeof body.createdAt === 'number'
    ) {
      confirmed = {
        ...outbound,
        ...body,
      } as ShiftMessage;
    }
  } catch {
    // Proxy returned no body or non-JSON — use outbound record as source of truth.
  }

  // ── Analytics ──
  if (confirmed.type === 'broadcast') {
    await trackEvent('schedule_published');
  }

  return confirmed;
}

// ─── getShiftMessages ─────────────────────────────────────────────────────────

type SupabaseRow = {
  id: string;
  shift_id: string;
  template_id?: string | null;
  date: string;
  role: string;
  type: string;
  body: string;
  sent_by: string;
  created_at: string | number;
  status: string;
  claimed_by?: string | null;
};

type SupabaseErrorBody = {
  message?: string;
  error?: string;
  hint?: string;
};

function rowToMessage(row: SupabaseRow): ShiftMessage {
  return {
    id: row.id,
    shiftId: row.shift_id,
    templateId: row.template_id ?? undefined,
    date: row.date,
    role: row.role,
    type: row.type as ShiftMessage['type'],
    body: row.body,
    sentBy: row.sent_by,
    createdAt:
      typeof row.created_at === 'number'
        ? row.created_at
        : new Date(row.created_at).getTime(),
    status: row.status as ShiftMessage['status'],
    claimedBy: row.claimed_by ?? undefined,
  };
}

/**
 * Fetch all messages for a given shift directly from Supabase REST API.
 * Results are ordered oldest-first (ascending createdAt).
 */
export async function getShiftMessages(
  shiftId: string,
  supabaseUrl: string,
  anonKey: string,
): Promise<ShiftMessage[]> {
  const url = new URL(`${supabaseUrl}/rest/v1/shift_messages`);
  url.searchParams.set('shift_id', `eq.${shiftId}`);
  url.searchParams.set('order', 'created_at.asc');

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as SupabaseErrorBody;
      detail = body.message ?? body.error ?? detail;
    } catch {
      // Non-JSON error body — use status code only.
    }
    throw new Error(`getShiftMessages failed: ${detail}`);
  }

  const rows = (await res.json()) as SupabaseRow[];
  return rows.map(rowToMessage);
}

// ─── claimCoverage ────────────────────────────────────────────────────────────

/**
 * Claim an open coverage/swap request via the secure proxy.
 * Emits a `shift_assigned` analytics event on success.
 */
export async function claimCoverage(
  messageId: string,
  workerId: string,
  proxyUrl: string,
  authToken: string | null,
): Promise<void> {
  const res = await fetch(`${proxyUrl}/shift-messages/${encodeURIComponent(messageId)}/claim`, {
    method: 'POST',
    headers: buildAuthHeaders(authToken),
    body: JSON.stringify({ workerId }),
  });

  if (!res.ok) {
    const detail = await extractErrorMessage(res);
    throw new Error(`claimCoverage failed: ${detail}`);
  }

  // ── Analytics ──
  await trackEvent('shift_assigned');
}