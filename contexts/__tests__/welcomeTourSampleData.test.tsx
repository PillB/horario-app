/**
 * Sample rows are written into the real account, so they are offered only
 * right after a guide is finished, once (QA 2026-10-28).
 */
import React from 'react';
import renderer, { act } from 'react-test-renderer';

import { WelcomeTourProvider, useWelcomeTour } from '../WelcomeTourContext';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

type Tour = ReturnType<typeof useWelcomeTour>;

const mount = async () => {
  const ref = { current: null as unknown as Tour };
  const Probe = () => {
    ref.current = useWelcomeTour();
    return null;
  };
  await act(async () => {
    renderer.create(
      <WelcomeTourProvider>
        <Probe />
      </WelcomeTourProvider>,
    );
  });
  return ref;
};

describe('WelcomeTour sample-data offer', () => {
  it('is not offered when the guide is skipped', async () => {
    const tour = await mount();
    await act(async () => { tour.current.skipTour(); });
    expect(tour.current.hasCompleted).toBe(true);
    expect(tour.current.sampleDataOffered).toBe(false);
    let taken = true;
    act(() => { taken = tour.current.takeSampleDataOffer(); });
    expect(taken).toBe(false);
  });

  it('is offered once after the guide is finished', async () => {
    const tour = await mount();
    await act(async () => { tour.current.completeTour(); });
    expect(tour.current.sampleDataOffered).toBe(true);
    const takes: boolean[] = [];
    act(() => {
      takes.push(tour.current.takeSampleDataOffer());
      takes.push(tour.current.takeSampleDataOffer());
    });
    expect(takes).toEqual([true, false]);
    expect(tour.current.sampleDataOffered).toBe(false);
  });
});

describe('WelcomeTour guides (CHG-095)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { en } = require('@/locales/en') as { en: Record<string, unknown> };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TOUR_MODES, stepsForMode, tourReducer } = require('../WelcomeTourContext') as typeof import('../WelcomeTourContext');
  const read = (path: string) =>
    path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], en);

  it('has a title and a description for every step of every guide', () => {
    for (const mode of TOUR_MODES) {
      expect(typeof read(`tour.mode.${mode}`)).toBe('string');
      expect(typeof read(`profile.guides.${mode}`)).toBe('string');
      const steps = stepsForMode(mode);
      expect(steps.length).toBeGreaterThan(0);
      for (const step of steps) {
        expect(typeof read(`tour.${mode}.step${step.id}.title`)).toBe('string');
        expect(typeof read(`tour.${mode}.step${step.id}.desc`)).toBe('string');
      }
    }
  });

  it('never blocks: Next walks every guide to its end', async () => {
    for (const mode of TOUR_MODES) {
      const tour = await mount();
      await act(async () => { tour.current.startTourMode(mode); });
      const total = tour.current.totalSteps;
      for (let i = 0; i < total; i += 1) {
        expect(tour.current.isActive).toBe(true);
        expect(tour.current.currentStepIndex).toBe(i);
        await act(async () => { tour.current.nextStep(); });
      }
      expect(tour.current.isActive).toBe(false);
      expect(tour.current.hasCompleted).toBe(true);
    }
  });

  it('opens the picker from the help button even after a guide ran', async () => {
    const tour = await mount();
    await act(async () => { tour.current.startTourMode('analytics'); });
    await act(async () => { tour.current.skipTour(); });
    await act(async () => { tour.current.startTour(); });
    expect(tour.current.isActive).toBe(true);
    expect(tour.current.tourMode).toBeNull();
    expect(tour.current.currentStep).toBeNull();
  });

  it('moves on by itself when the step\'s action is done, and only from that step', async () => {
    jest.useFakeTimers();
    try {
      const tour = await mount();
      await act(async () => { tour.current.startTourMode('scheduler'); });
      // Not the current step's target: nothing happens.
      act(() => { tour.current.recordTourAction('shift-templates-section'); });
      act(() => { jest.advanceTimersByTime(1000); });
      expect(tour.current.currentStepIndex).toBe(0);
      // The current step's target: advances once, after the delay.
      act(() => { tour.current.recordTourAction('workers-section'); });
      expect(tour.current.currentStepIndex).toBe(0);
      act(() => { jest.advanceTimersByTime(1000); });
      expect(tour.current.currentStepIndex).toBe(1);
      // The user went back before the delay ran out: the late advance is dropped.
      act(() => { tour.current.recordTourAction('availability-section'); });
      act(() => { tour.current.prevStep(); });
      act(() => { jest.advanceTimersByTime(1000); });
      expect(tour.current.currentStepIndex).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('ignores a delayed advance for another guide', () => {
    const state = { isActive: true, currentStepIndex: 0, hasCompleted: false, sampleDataOffered: false, tourMode: 'overview' as const };
    expect(tourReducer(state, { type: 'ADVANCE_FROM', mode: 'scheduler', index: 0 })).toBe(state);
    expect(tourReducer(state, { type: 'ADVANCE_FROM', mode: 'overview', index: 0 }).currentStepIndex).toBe(1);
  });
});
