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
  name: string;
  role: string;
  skills: string[];
  availability: Availability[];
};

export type OnboardingStep = {
  key: 'workers' | 'templates' | 'forecast';
  title: string;
  description: string;
  completed: boolean;
  actionLabel: string;
  onPress: () => void;
};
