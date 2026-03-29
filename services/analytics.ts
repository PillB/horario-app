/**
 * analytics.ts — Lightweight client-side event tracking.
 * Stores events in AsyncStorage for local audit; ready to forward to a backend.
 * Never call this on the server (API routes).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export type AnalyticsEvent =
  | 'worker_added'
  | 'template_added'
  | 'shift_assigned'
  | 'auto_assign_used'
  | 'schedule_published'
  | 'upgrade_cta_tapped'
  | 'sign_up_started'
  | 'sign_up_completed'
  | 'onboarding_step_completed';

type EventRecord = {
  event: AnalyticsEvent;
  ts: number; // Unix ms
  props?: Record<string, string | number | boolean>;
};

const STORAGE_KEY = 'horario:analytics:events';
const MAX_EVENTS = 200;

/** Fire-and-forget — never throws, never blocks the caller. */
export async function trackEvent(
  event: AnalyticsEvent,
  props?: Record<string, string | number | boolean>
): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const existing: EventRecord[] = raw ? (JSON.parse(raw) as EventRecord[]) : [];
    const next = [...existing, { event, ts: Date.now(), props }].slice(-MAX_EVENTS);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Intentionally swallowed — analytics must never break the app.
  }
}

/** Returns stored events — useful for debug screens or future reporting. */
export async function getTrackedEvents(): Promise<EventRecord[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as EventRecord[]) : [];
  } catch {
    return [];
  }
}
