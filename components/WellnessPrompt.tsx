import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { Colors, brand } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { ThemedText } from './ThemedText';
import { ThemedView } from './ThemedView';
import { useT } from '@/contexts/LocaleContext';

type WellnessPromptProps = {
  visible: boolean;
  minutesActive: number;
  onDismiss: () => void;
  onTakeBreak: () => void;
};

export const WellnessPrompt = ({ visible, minutesActive, onDismiss, onTakeBreak }: WellnessPromptProps) => {
  const colorScheme = useColorScheme();
  const styles = makeStyles(colorScheme ?? 'light');
  const { t } = useT();

  if (!visible) return null;

  const roundedMinutes = Math.max(0, minutesActive);
  const plural = roundedMinutes === 1 ? '' : 's';

  return (
    <ThemedView style={styles.wrapper} accessibilityRole="alert" accessibilityLabel={t('wellness.a11yRole')}>
      <View style={styles.copy}>
        <ThemedText type="subtitle" style={{ color: '#FFFFFF' }}>{t('wellness.heading')}</ThemedText>
        <ThemedText style={styles.bodyText}>
          {t('wellness.body', { minutes: String(roundedMinutes), plural })}
        </ThemedText>
      </View>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          onPress={onDismiss}
          style={({ pressed }) => [styles.button, styles.secondary, pressed && { opacity: 0.75 }]}
          accessibilityLabel={t('wellness.notNowA11y')}
        >
          <ThemedText style={styles.secondaryText}>{t('wellness.notNow')}</ThemedText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onTakeBreak}
          style={({ pressed }) => [styles.button, styles.primary, pressed && { opacity: 0.75 }]}
          accessibilityLabel={t('wellness.takeBreakA11y')}
        >
          <ThemedText style={styles.primaryText}>{t('wellness.takeBreak')}</ThemedText>
        </Pressable>
      </View>
    </ThemedView>
  );
};

const makeStyles = (colorScheme: 'light' | 'dark') => {
  const cardBackground = colorScheme === 'dark' ? brand.proDark : brand.pro;
  const shadowColor = colorScheme === 'dark' ? '#000000' : '#1E293B';

  return StyleSheet.create({
    wrapper: {
      borderRadius: 14,
      padding: 16,
      gap: 12,
      backgroundColor: cardBackground,
      shadowColor: shadowColor,
      shadowOpacity: Platform.OS === 'ios' ? 0.12 : 0.2,
      shadowOffset: { width: 0, height: 6 },
      shadowRadius: 12,
      elevation: 5,
      marginBottom: 16,
    },
    copy: {
      gap: 6,
    },
    bodyText: {
      color: '#FFFFFF',
      lineHeight: 24,
    },
    actions: {
      flexDirection: 'row',
      gap: 10,
      flexWrap: 'wrap',
    },
    button: {
      paddingVertical: 13,
      paddingHorizontal: 14,
      borderRadius: 10,
      minHeight: 44,
    },
    primary: {
      backgroundColor: Colors.light.surface,
    },
    primaryText: {
      color: brand.primaryDeep,
      fontWeight: '700',
    },
    secondary: {
      backgroundColor: 'rgba(255,255,255,0.15)',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.4)',
    },
    secondaryText: {
      color: '#FFFFFF',
      fontWeight: '600',
    },
  });
};