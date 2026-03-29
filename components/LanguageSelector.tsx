/**
 * LanguageSelector — compact dropdown/sheet to switch app language.
 *
 * Shows as a Pressable pill with the current language flag + code.
 * On press: opens an overlay list of all supported languages.
 * Works on web and native.
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Pressable,
  StyleSheet,
  FlatList,
  Modal,
  Platform,
} from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { brand } from '@/constants/Colors';
import { LANG_CODES } from '@/locales/index';
import type { LangCode, Translations } from '@/locales/en';

// Meta info needed to render the selector (available without loading the full locale)
const LANG_META: Record<LangCode, { flag: string; langNameNative: string; langName: string }> = {
  en: { flag: '🇺🇸', langNameNative: 'English', langName: 'English' },
  es: { flag: '🇪🇸', langNameNative: 'Español', langName: 'Spanish' },
  de: { flag: '🇩🇪', langNameNative: 'Deutsch', langName: 'German' },
  fr: { flag: '🇫🇷', langNameNative: 'Français', langName: 'French' },
  it: { flag: '🇮🇹', langNameNative: 'Italiano', langName: 'Italian' },
  zh: { flag: '🇨🇳', langNameNative: '中文', langName: 'Chinese' },
  sw: { flag: '🇰🇪', langNameNative: 'Kiswahili', langName: 'Swahili' },
  tl: { flag: '🇵🇭', langNameNative: 'Filipino', langName: 'Tagalog' },
  hi: { flag: '🇮🇳', langNameNative: 'हिंदी', langName: 'Hindi' },
};

type Props = {
  currentLang: LangCode;
  onSelect: (code: LangCode) => Promise<void>;
  locale: Translations;
};

export function LanguageSelector({ currentLang, onSelect, locale }: Props) {
  const [open, setOpen] = useState(false);
  const current = LANG_META[currentLang];

  const handleSelect = useCallback(async (code: LangCode) => {
    setOpen(false);
    await onSelect(code);
  }, [onSelect]);

  return (
    <View>
      <Pressable
        onPress={() => setOpen(true)}
        style={styles.trigger}
        accessibilityRole="button"
        accessibilityLabel={locale.language.selectorA11y}
        accessibilityHint={locale.language.selectorHint}
      >
        <ThemedText style={styles.triggerText}>{current.flag} {currentLang.toUpperCase()}</ThemedText>
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType={Platform.OS === 'web' ? 'none' : 'slide'}
        onRequestClose={() => setOpen(false)}
        statusBarTranslucent
      >
        <Pressable style={styles.overlay} onPress={() => setOpen(false)} accessibilityLabel="Close language selector">
          <ThemedView style={styles.sheet}>
            <ThemedText type="defaultSemiBold" style={styles.sheetTitle}>
              {locale.language.selectorLabel}
            </ThemedText>
            <FlatList
              data={LANG_CODES}
              keyExtractor={(item) => item}
              renderItem={({ item }) => {
                const meta = LANG_META[item];
                const isSelected = item === currentLang;
                return (
                  <Pressable
                    onPress={() => handleSelect(item)}
                    style={[styles.langRow, isSelected && styles.langRowSelected]}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: isSelected }}
                    accessibilityLabel={`${meta.langName} — ${meta.langNameNative}`}
                  >
                    <ThemedText style={styles.langFlag}>{meta.flag}</ThemedText>
                    <View style={styles.langLabels}>
                      <ThemedText style={styles.langNative}>{meta.langNameNative}</ThemedText>
                      <ThemedText style={styles.langEnglish}>{meta.langName}</ThemedText>
                    </View>
                    {isSelected && (
                      <ThemedText style={styles.checkmark}>✓</ThemedText>
                    )}
                  </Pressable>
                );
              }}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
            />
          </ThemedView>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: brand.primary + '44',
    backgroundColor: brand.primarySurface,
  },
  triggerText: {
    fontSize: 13,
    fontWeight: '600',
    color: brand.primary,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 20,
    paddingBottom: 40,
    paddingHorizontal: 16,
    maxHeight: '75%',
  },
  sheetTitle: {
    fontSize: 16,
    marginBottom: 12,
    textAlign: 'center',
  },
  langRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  langRowSelected: {
    backgroundColor: brand.primarySurface,
  },
  langFlag: {
    fontSize: 24,
    marginRight: 14,
  },
  langLabels: {
    flex: 1,
  },
  langNative: {
    fontSize: 15,
    fontWeight: '600',
  },
  langEnglish: {
    fontSize: 13,
    opacity: 0.6,
    marginTop: 1,
  },
  checkmark: {
    fontSize: 18,
    color: brand.primary,
    fontWeight: '700',
  },
  separator: {
    height: 1,
    backgroundColor: '#E2E8F0',
    marginHorizontal: 8,
  },
});
