/**
 * TourStep — marks a view as a tour target.
 *
 * Registers a ref with the tour context so <TourSpotlight> can scroll the view
 * into sight and measure where it is on screen. `collapsable={false}` keeps
 * the native node so it can be measured.
 */

import React, { useEffect, useRef } from 'react';
import { View, type ViewStyle } from 'react-native';
import { useWelcomeTour } from '@/contexts/WelcomeTourContext';

type Props = {
  /** Matches a tour step's target string (e.g. "workers-section"). */
  target: string;
  children: React.ReactNode;
  style?: ViewStyle;
};

export function TourStep({ target, children, style }: Props) {
  const { registerTarget } = useWelcomeTour();
  const ref = useRef<View>(null);

  useEffect(() => {
    registerTarget(target, ref);
    return () => registerTarget(target, null);
  }, [target, registerTarget]);

  return (
    <View
      ref={ref}
      collapsable={false}
      style={style}
      // Not an accessibility node of its own: screen readers address the children.
      importantForAccessibility="no"
      accessible={false}
    >
      {children}
    </View>
  );
}
