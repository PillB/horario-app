/**
 * TourStep — a minimal layout-measurement wrapper used by the welcome tour.
 *
 * Wraps any child in a View with collapsable={false} so the native node is
 * preserved for measurement, then forwards each layout event to the tour
 * context via registerLayout(target, layout).
 */

import React, { useCallback } from 'react';
import { View, type LayoutChangeEvent, type ViewStyle } from 'react-native';
import { useWelcomeTour } from '@/contexts/WelcomeTourContext';

type Props = {
  /** Matches a tour step's target string (e.g. "workers-section"). */
  target: string;
  children: React.ReactNode;
  style?: ViewStyle;
};

export function TourStep({ target, children, style }: Props) {
  const { registerLayout } = useWelcomeTour();

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      registerLayout(target, event.nativeEvent.layout);
    },
    [target, registerLayout],
  );

  return (
    <View
      collapsable={false}
      onLayout={handleLayout}
      style={style}
      // importantForAccessibility="no" prevents this wrapper from becoming
      // an accessibility node, so screen readers address children directly.
      importantForAccessibility="no"
      accessible={false}
    >
      {children}
    </View>
  );
}