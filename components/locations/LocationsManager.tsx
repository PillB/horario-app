/**
 * LocationsManager — the business's locations on the profile screen: list,
 * add, edit and delete (delete is admin-only on the server), plus a read-only
 * change history (CHG-089).
 */
import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { LocationHistoryList } from '@/components/locations/LocationHistoryList';
import { LocationSetupCard } from '@/components/locations/LocationSetupCard';
import { ThemedText } from '@/components/ThemedText';
import { Colors, brand, type ThemeColors } from '@/constants/Colors';
import { useT } from '@/contexts/LocaleContext';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useLocations } from '@/hooks/useLocations';
import { getJurisdiction } from '@/services/labor/jurisdictions';
import type { BusinessLocation } from '@/services/locationService';

type Editing = { mode: 'add' } | { mode: 'edit'; location: BusinessLocation } | null;

export function LocationsManager({ accountId }: { accountId: string }) {
  const { t } = useT();
  const colorScheme = useColorScheme() ?? 'light';
  const styles = makeStyles(Colors[colorScheme]);
  const { locations, loading, loaded, error, refresh, save, remove } = useLocations(accountId);
  const [editing, setEditing] = useState<Editing>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  // Bumped after a delete so an open history reloads (an edit remounts it).
  const [historyVersion, setHistoryVersion] = useState(0);

  const handleDelete = useCallback(
    async (location: BusinessLocation) => {
      if (confirmingDelete !== location.id) {
        setConfirmingDelete(location.id);
        return;
      }
      setConfirmingDelete(null);
      const result = await remove(location.id);
      if (result.ok) setHistoryVersion((v) => v + 1);
      setMessage(result.ok ? null : t('locations.deleteFailed', { error: result.error }));
    },
    [confirmingDelete, remove, t],
  );

  if (editing) {
    return (
      <LocationSetupCard
        initial={editing.mode === 'edit' ? editing.location : null}
        onSave={save}
        onSaved={() => {
          setEditing(null);
          setMessage(t('locations.saved'));
        }}
        onCancel={() => setEditing(null)}
      />
    );
  }

  return (
    <View style={styles.container} testID="locations-manager">
      {loading && !loaded ? <ThemedText style={styles.muted}>{t('common.loading')}</ThemedText> : null}
      {error && !loaded ? (
        <View style={styles.row}>
          <ThemedText style={styles.errorText}>{t('locations.loadFailed')}</ThemedText>
          <Pressable
            onPress={() => void refresh()}
            accessibilityRole="button"
            accessibilityLabel={t('common.retry')}
            accessibilityHint={t('locations.retryHint')}
            style={({ pressed }) => [styles.smallButton, pressed && styles.pressed]}
          >
            <ThemedText style={styles.smallButtonText}>{t('common.retry')}</ThemedText>
          </Pressable>
        </View>
      ) : null}

      {loaded && locations.length === 0 ? <ThemedText style={styles.muted}>{t('locations.empty')}</ThemedText> : null}

      {locations.map((location) => (
        <View key={location.id} style={styles.locationRow} testID={`location-row-${location.id}`}>
          <View style={styles.locationInfo}>
            <ThemedText type="defaultSemiBold">{location.name}</ThemedText>
            <ThemedText style={styles.muted}>
              {getJurisdiction(location.jurisdictionCode)?.name ?? location.jurisdictionCode} · {location.timeZone}
            </ThemedText>
          </View>
          <Pressable
            onPress={() => {
              setMessage(null);
              setEditing({ mode: 'edit', location });
            }}
            accessibilityRole="button"
            accessibilityLabel={t('locations.editA11y', { name: location.name })}
            accessibilityHint={t('locations.editHint')}
            style={({ pressed }) => [styles.smallButton, pressed && styles.pressed]}
          >
            <ThemedText style={styles.smallButtonText}>{t('locations.edit')}</ThemedText>
          </Pressable>
          <Pressable
            onPress={() => void handleDelete(location)}
            testID={`location-delete-${location.id}`}
            accessibilityRole="button"
            accessibilityLabel={t('locations.deleteA11y', { name: location.name })}
            accessibilityHint={t('locations.deleteHint')}
            style={({ pressed }) => [styles.smallButton, styles.deleteButton, pressed && styles.pressed]}
          >
            <ThemedText style={styles.deleteText}>
              {confirmingDelete === location.id ? t('locations.deleteConfirm') : t('locations.delete')}
            </ThemedText>
          </Pressable>
        </View>
      ))}

      {message ? <ThemedText style={styles.muted} testID="locations-message">{message}</ThemedText> : null}

      {loaded ? (
        <Pressable
          onPress={() => {
            setMessage(null);
            setEditing({ mode: 'add' });
          }}
          testID="location-add"
          accessibilityRole="button"
          accessibilityLabel={t('locations.add')}
          accessibilityHint={t('locations.addHint')}
          style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
        >
          <ThemedText style={styles.addButtonText}>{t('locations.add')}</ThemedText>
        </Pressable>
      ) : null}

      {loaded ? (
        <Pressable
          onPress={() => setShowHistory((v) => !v)}
          testID="location-history-toggle"
          accessibilityRole="button"
          accessibilityLabel={showHistory ? t('locations.history.hide') : t('locations.history.show')}
          accessibilityHint={t('locations.history.toggleHint')}
          aria-expanded={showHistory}
          style={({ pressed }) => [styles.smallButton, styles.historyToggle, pressed && styles.pressed]}
        >
          <ThemedText style={styles.smallButtonText}>
            {showHistory ? t('locations.history.hide') : t('locations.history.show')}
          </ThemedText>
        </Pressable>
      ) : null}
      {loaded && showHistory ? <LocationHistoryList version={historyVersion} /> : null}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { gap: 10 },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    muted: { fontSize: 13, lineHeight: 19, color: colors.textSecondary },
    errorText: { fontSize: 13, color: colors.error, flexShrink: 1 },
    locationRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    locationInfo: { flex: 1, gap: 2 },
    smallButton: {
      borderWidth: 1.5,
      borderColor: colors.border,
      borderRadius: 8,
      paddingVertical: 6,
      paddingHorizontal: 10,
      minHeight: 36,
      justifyContent: 'center',
    },
    smallButtonText: { fontSize: 13, fontWeight: '600', color: colors.text },
    deleteButton: { borderColor: brand.error + '55' },
    historyToggle: { alignSelf: 'flex-start' },
    deleteText: { fontSize: 13, fontWeight: '600', color: colors.error },
    addButton: {
      borderWidth: 1.5,
      borderColor: brand.primary,
      borderRadius: 10,
      paddingVertical: 10,
      paddingHorizontal: 14,
      alignItems: 'center',
      minHeight: 44,
      justifyContent: 'center',
    },
    addButtonText: { color: colors.tintText, fontWeight: '600', fontSize: 14 },
    pressed: { opacity: 0.75 },
  });
