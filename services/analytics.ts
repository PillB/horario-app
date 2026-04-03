/**
 * analytics.ts — Lightweight client-side event tracking.
 * Stores events in AsyncStorage for local audit; ready to forward to a backend.
 * Never call this on the server (API routes).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { enqueue, type TransportEvent } from './analyticsTransport';

export type AnalyticsEvent =
  // Acquisition
  | 'signup_viewed'
  | 'signup_submitted'
  | 'signin_viewed'
  | 'signin_submitted'
  | 'verification_completed'
  // Onboarding funnel
  | 'onboarding_step_viewed'
  | 'onboarding_step_completed'
  | 'onboarding_target_defined'
  | 'onboarding_quick_start_opened'
  // Activation
  | 'first_shift_assigned'
  | 'first_schedule_published'
  | 'activation_reached'
  | 'activation_banner_dismissed'
  // Referral / invite
  | 'invite_sent'
  | 'invite_accepted'
  | 'share_sent'
  | 'install_attributed'
  | 'activation_attributed'
  | 'reward_issued'
  // Scheduling cycle
  | 'schedule_published'
  | 'publish_failed'
  | 'publish_retry'
  | 'worker_added'
  | 'template_added'
  | 'shift_assigned'
  | 'auto_assign_used'
  // Upgrade / monetisation
  | 'upgrade_viewed'
  | 'upgrade_started'
  | 'upgrade_completed'
  | 'upgrade_cta_tapped'
  // Friction / reliability
  | 'retry_action'
  | 'error_displayed'
  | 'form_step_abandoned';

type BaseProps = Record<string, string | number | boolean>;

type BaseEventProps = {
  account_id: string;
  user_id: string;
  role: string;
  locale: string;
  platform: string;
  source_tab: string;
  experiment_variant: string;
  timestamp: number;
};

type EventProps = {
  activation_reached: { time_to_activation_ms: number };
  onboarding_step_viewed: { step: string };
  onboarding_step_completed: { step: string };
  publish_failed: { reason: string };
  publish_retry: { attempt: number };
  retry_action: { action: string; attempt: number };
  error_displayed: { code: string; screen: string };
  form_step_abandoned: { form: string; step: string };
  share_sent: { channel: string };
  reward_issued: { reward_type: string };
  invite_sent: { channel: string };
  invite_accepted: { channel: string };
  upgrade_started: { plan: string };
  upgrade_completed: { plan: string };
};

type ConstrainedEvent = keyof EventProps;

type PropsForEvent<E extends AnalyticsEvent> = E extends ConstrainedEvent
  ? EventProps[E]
  : BaseProps | undefined;

type EventRecord = {
  event: AnalyticsEvent;
  ts: number;
  props?: BaseProps;
};

type AnalyticsProvider = {
  track: (event: string, props?: BaseProps) => void;
};

let _provider: AnalyticsProvider | null = null;

export function setAnalyticsProvider(p: AnalyticsProvider): void {
  _provider = p;
}

const defaultBaseProps: BaseEventProps = {
  account_id: 'unknown',
  user_id: 'unknown',
  role: 'unknown',
  locale: 'unknown',
  platform: Platform.OS,
  source_tab: 'unknown',
  experiment_variant: '',
  timestamp: 0,
};

let _baseProps: BaseEventProps = { ...defaultBaseProps };

export function setBaseProps(props: Partial<BaseEventProps>): void {
  _baseProps = { ..._baseProps, ...props };
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

const STORAGE_KEY = 'horario:analytics:events';
const MAX_EVENTS = 200;

export async function trackEvent<E extends AnalyticsEvent>(
  ...args: E extends ConstrainedEvent
    ? [event: E, props: EventProps[E]]
    : [event: E, props?: BaseProps]
): Promise<void> {
  const [event, props] = args;
  try {
    const now = Date.now();
    const injectedBase: BaseEventProps = {
      ..._baseProps,
      platform: Platform.OS,
      timestamp: now,
    };

    const mergedProps: BaseProps = {
      ...injectedBase,
      ...(props !== undefined ? (props as BaseProps) : {}),
    };

    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const existing: EventRecord[] = raw ? (JSON.parse(raw) as EventRecord[]) : [];
    const record: EventRecord = {
      event,
      ts: now,
      props: mergedProps,
    };
    const next = [...existing, record].slice(-MAX_EVENTS);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));

    const transportEvent: TransportEvent = {
      id: generateId(),
      event,
      props: mergedProps,
      ts: now,
    };
    enqueue(transportEvent);

    _provider?.track(event, mergedProps);
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