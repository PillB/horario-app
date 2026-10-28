/**
 * Scheduler domain types.
 * Centralised here so utils, validators, components, and hooks
 * all share the same definitions without a circular-import risk.
 */

export type Availability = {
  day: string;
  from: string;
  to: string;
};

export type Worker = {
  id: string;
  /** Short human-readable identifier shown in the UI, e.g. "W-1". Derived from list position. */
  displayId: string;
  name: string;
  role: string;
  skills: string[];
  availability: Availability[];
  /** Labor attributes read by the compliance engine (services/labor). */
  birthDate?: string | null;
  nightWorker?: boolean;
  /** Signed opt-out from the average weekly limit (UK / EU art. 22). */
  weeklyLimitOptOut?: boolean;
  /** No fixed hours in the contract (Ireland s.17 notice). */
  noFixedHours?: boolean;
};

export type OnboardingStep = {
  key: 'workers' | 'templates' | 'forecast';
  title: string;
  description: string;
  completed: boolean;
  actionLabel: string;
  onPress: () => void;
};
