/**
 * ErrorBoundary — catches unhandled render errors in the component subtree.
 *
 * A class component is required by React for error boundaries (no hook
 * equivalent exists). The public `ErrorBoundary` functional wrapper provides
 * a clean consumer API while keeping the class as an implementation detail.
 *
 * Usage:
 *   <ErrorBoundary onRetry={refresh}>
 *     <SomeScreen />
 *   </ErrorBoundary>
 *
 *   <ErrorBoundary fallback={<MyCustomFallback />}>
 *     <SomeSection />
 *   </ErrorBoundary>
 */
import React, { type ErrorInfo, type ReactNode } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { Colors, brand, type ThemeColors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';

// ─── Types ────────────────────────────────────────────────────────────────────

type Props = {
  children: ReactNode;
  /** Custom fallback UI; omit to use the default error screen. */
  fallback?: ReactNode;
  /** Called when the user taps "Try again"; boundary state is reset first. */
  onRetry?: () => void;
};

type State = {
  hasError: boolean;
  error: Error | null;
};

// ─── Default fallback UI ──────────────────────────────────────────────────────

function DefaultFallback({
  error,
  onRetry,
}: {
  error: Error | null;
  onRetry: () => void;
}) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const styles = makeStyles(colors);

  return (
    <ThemedView
      testID="error-boundary-fallback"
      style={styles.container}
    >
      <ThemedText
        type="subtitle"
        testID="error-boundary-title"
        style={styles.title}
      >
        Something went wrong
      </ThemedText>
      {error ? (
        <ThemedText testID="error-boundary-message" style={styles.message}>
          {error.message}
        </ThemedText>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Retry"
        accessibilityHint="Attempt to reload the section that failed"
        testID="error-boundary-retry"
        onPress={onRetry}
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
      >
        <ThemedText style={styles.buttonText}>Try again</ThemedText>
      </Pressable>
    </ThemedView>
  );
}

// ─── Class boundary (React requirement) ──────────────────────────────────────

class ErrorBoundaryInner extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(
      '[ErrorBoundary] Uncaught render error:',
      error.message,
      info.componentStack,
    );
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
    this.props.onRetry?.();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback !== undefined) {
        return this.props.fallback;
      }
      return (
        <DefaultFallback
          error={this.state.error}
          onRetry={this.handleRetry}
        />
      );
    }
    return this.props.children;
  }
}

// ─── Public functional wrapper ────────────────────────────────────────────────

export function ErrorBoundary({ children, fallback, onRetry }: Props) {
  return (
    <ErrorBoundaryInner fallback={fallback} onRetry={onRetry}>
      {children}
    </ErrorBoundaryInner>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 24,
      gap: 16,
    },
    title: {
      textAlign: 'center',
    },
    message: {
      // colors.textSecondary — 6.86:1 ✓ AA on light, 5.27:1 ✓ AA on dark
      color: colors.textSecondary,
      textAlign: 'center',
      fontSize: 14,
      lineHeight: 22, // 1.57× of 14 — meets ≥1.5× line-height guideline
    },
    button: {
      // brand.primaryDark — white text yields 9.30:1 ✓ AAA
      backgroundColor: brand.primaryDark,
      paddingVertical: 12,
      paddingHorizontal: 20,
      borderRadius: 10,
      minHeight: 44,
      justifyContent: 'center',
      alignItems: 'center',
    },
    buttonPressed: {
      opacity: 0.75,
    },
    buttonText: {
      // colors.surface resolves to #FFFFFF (light) — 9.30:1 ✓ AAA on brand.primaryDark
      color: colors.surface,
      fontWeight: '700',
    },
  });