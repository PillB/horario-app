import React, { useEffect, useMemo } from 'react';
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native';

// useNativeDriver: true causes `CSSStyleDeclaration` indexed-property errors on web.
const USE_NATIVE_DRIVER = Platform.OS !== 'web';

const PARTICLE_COUNT = 14;
const COLORS = ['#2563EB', '#22C55E', '#F59E0B', '#EC4899', '#0EA5E9'];

const createParticle = () => ({
  translateY: new Animated.Value(0),
  translateX: new Animated.Value(0),
  rotate: new Animated.Value(0),
  size: Math.random() > 0.5 ? 8 : 10,
  color: COLORS[Math.floor(Math.random() * COLORS.length)],
  startX: (Math.random() - 0.5) * 120,
});

type ConfettiBurstProps = {
  running: boolean;
  disabled?: boolean;
};

// On web, Animated.View transforms (rotate interpolation) trigger a
// CSSStyleDeclaration indexed-property error in react-native-web.
// Confetti is a mobile-first delight — skip it entirely on web.
const ConfettiBurstNative = ({ running, disabled }: ConfettiBurstProps) => {
  const particles = useMemo(() => Array.from({ length: PARTICLE_COUNT }, createParticle), []);

  useEffect(() => {
    if (!running || disabled) return;

    const animations = particles.map((particle, index) => {
      particle.translateY.setValue(0);
      particle.translateX.setValue(0);
      particle.rotate.setValue(0);

      const fallDistance = 140 + Math.random() * 60;
      const scatter = particle.startX + (Math.random() - 0.5) * 40;

      return Animated.parallel([
        Animated.timing(particle.translateY, {
          toValue: fallDistance,
          duration: 900 + index * 10,
          easing: Easing.out(Easing.quad),
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
        Animated.timing(particle.translateX, {
          toValue: scatter,
          duration: 900 + index * 10,
          easing: Easing.out(Easing.quad),
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
        Animated.timing(particle.rotate, {
          toValue: Math.random() * 540,
          duration: 1100,
          easing: Easing.linear,
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
      ]);
    });

    Animated.stagger(40, animations).start();
  }, [disabled, particles, running]);

  if (disabled) return null;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={styles.container}>
        {particles.map((particle, index) => {
          const spin = particle.rotate.interpolate({
            inputRange: [0, 360],
            outputRange: ['0deg', '360deg'],
          });

          return (
            <Animated.View
              key={index}
              style={[
                styles.particle,
                {
                  backgroundColor: particle.color,
                  width: particle.size,
                  height: particle.size,
                  transform: [
                    { translateX: particle.translateX },
                    { translateY: particle.translateY },
                    { rotate: spin },
                  ],
                },
              ]}
            />
          );
        })}
      </View>
    </View>
  );
};

const ConfettiBurst = Platform.OS === 'web'
  ? (_props: ConfettiBurstProps) => null
  : ConfettiBurstNative;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 16,
  },
  particle: {
    position: 'absolute',
    top: 0,
    borderRadius: 2,
    opacity: 0.92,
  },
});

export default ConfettiBurst;
