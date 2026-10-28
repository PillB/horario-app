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
