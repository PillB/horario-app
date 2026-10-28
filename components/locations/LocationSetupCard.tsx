/**
 * LocationSetupCard — confirm where a business location is, which labor rules
 * apply there, and its time zone.
 *
 * Law follows the work location. The country is pre-filled from the request
 * IP and the device settings when they are available; the user always
 * confirms it (and picks it first when nothing was detected). Region and city
 * pickers appear only where Horario has a more specific rule pack.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { InputField } from '@/components/scheduler/InputField';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { Colors, brand, type ThemeColors } from '@/constants/Colors';
import { ISO_COUNTRY_CODES } from '@/constants/countries';
import { useT } from '@/contexts/LocaleContext';
import { useColorScheme } from '@/hooks/useColorScheme';
import { defaultTimeZoneFor, useJurisdictionSuggestion } from '@/hooks/useJurisdictionSuggestion';
import { LANG_TO_BCP47 } from '@/hooks/useLocale';
import {
  JURISDICTIONS,
  citiesFor,
  getJurisdiction,
  jurisdictionChain,
  regionsFor,
  resolveJurisdiction,
} from '@/services/labor/jurisdictions';
import type { BusinessLocation, LocationInput, LocationResult } from '@/services/locationService';
import { INDUSTRIES, type Industry, type LocationErrorCode, validateLocationInput, zoneFitsCountry } from '@/utils/locationValidation';
import { isValidTimeZone } from '@/utils/zonedTime';

type Props = {
  /** Location to edit; omit to add a new one (detection runs only then). */
  initial?: BusinessLocation | null;
  onSave: (input: LocationInput) => Promise<LocationResult<BusinessLocation>>;
  onSaved?: (location: BusinessLocation) => void;
  onCancel?: () => void;
};

const PACK_COUNTRIES = Array.from(new Set(JURISDICTIONS.map((j) => j.country).filter(Boolean)));
const PACK_COUNTRY_SET = new Set(PACK_COUNTRIES);
const FORM_ERRORS: LocationErrorCode[] = ['NAME_INVALID', 'COUNTRY_INVALID', 'TIME_ZONE_INVALID', 'TIME_ZONE_COUNTRY_MISMATCH', 'INDUSTRY_INVALID', 'HEADCOUNT_INVALID'];

/** Localized country names; falls back to the code where Intl.DisplayNames is missing (e.g. Hermes). */
const useCountryName = (bcp47: string) =>
  useMemo(() => {
    let names: Intl.DisplayNames | null = null;
    try {
      names = new Intl.DisplayNames([bcp47], { type: 'region' });
    } catch {
      names = null;
    }
    return (code: string): string => {
      try {
        return names?.of(code) ?? code;
      } catch {
        return code;
      }
    };
  }, [bcp47]);

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function OptionChip({
  label,
  selected,
  onPress,
  hint,
  testID,
  styles,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  hint: string;
  testID: string;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="radio"
      aria-checked={selected}
      accessibilityLabel={label}
      accessibilityHint={hint}
      style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && styles.pressed]}
    >
      <ThemedText style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</ThemedText>
    </Pressable>
  );
}

export function LocationSetupCard({ initial, onSave, onSaved, onCancel }: Props) {
  const { t, langCode } = useT();
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const countryName = useCountryName(LANG_TO_BCP47[langCode] ?? 'en-US');

  const editing = Boolean(initial);
  const { suggestion, loading: detecting } = useJurisdictionSuggestion(!editing);

  const [name, setName] = useState(initial?.name ?? t('locations.defaultName'));
  const [country, setCountry] = useState<string | null>(initial?.countryCode ?? null);
  const [countryPicked, setCountryPicked] = useState(editing);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [region, setRegion] = useState<string | null>(initial?.regionCode ?? null);
  const [city, setCity] = useState<string | null>(initial?.cityCode ?? null);
  const [timeZone, setTimeZone] = useState(initial?.timeZone ?? '');
  const [timeZoneTouched, setTimeZoneTouched] = useState(editing);
  const [industry, setIndustry] = useState<Industry | null>(initial?.industry ?? null);
  const [headcount, setHeadcount] = useState(initial?.employerHeadcount != null ? String(initial.employerHeadcount) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pre-fill from detection until the user picks a country themselves.
  useEffect(() => {
    if (editing || !suggestion || countryPicked) return;
    setCountry(suggestion.country);
    setRegion(suggestion.region);
    setCity(null);
    if (!timeZoneTouched) setTimeZone(suggestion.timeZone ?? '');
    if (suggestion.status === 'unknown') setPickerOpen(true);
    // Only when a new suggestion arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestion]);

  const pickCountry = useCallback(
    (code: string) => {
      setCountry(code);
      setCountryPicked(true);
      setPickerOpen(false);
      setQuery('');
      setRegion(null);
      setCity(null);
      setError(null);
      if (!timeZoneTouched) {
        const zone = code === suggestion?.country && suggestion.timeZone ? suggestion.timeZone : defaultTimeZoneFor(code);
        if (zone) setTimeZone(zone);
      }
    },
    [suggestion, timeZoneTouched],
  );

  const pickRegion = useCallback(
    (code: string | null) => {
      setRegion(code);
      setCity(null);
      if (!timeZoneTouched && country && code) {
        const zone = getJurisdiction(`${country}-${code}`)?.timeZone;
        if (zone) setTimeZone(zone);
      }
    },
    [country, timeZoneTouched],
  );

  const regions = useMemo(() => (country ? regionsFor(country) : []), [country]);
  const cities = useMemo(() => (country && region ? citiesFor(country, region) : []), [country, region]);
  const jurisdictionCode = country ? resolveJurisdiction({ country, region, city }) : null;
  // Packs that are only a floor for the place (no national / provincial law encoded).
  const isBaseline = jurisdictionCode === 'GENERIC' || jurisdictionCode === 'EU' || jurisdictionCode === 'CA-OTHER';

  const rulesName = useMemo(() => {
    if (!jurisdictionCode || !country) return null;
    if (jurisdictionCode === 'GENERIC') return `${t('locations.rulesGeneric')} (${countryName(country)})`;
    if (jurisdictionCode === 'EU') return `${t('locations.rulesEu')} (${countryName(country)})`;
    return jurisdictionChain(jurisdictionCode)
      .filter((code) => code !== 'EU')
      .reverse()
      .map((code) => {
        const info = getJurisdiction(code);
        if (!info) return code;
        return info.region || info.city ? info.name : countryName(info.country);
      })
      .join(', ');
  }, [jurisdictionCode, country, countryName, t]);

  const filteredCountries = useMemo(() => {
    const q = fold(query.trim());
    const matches = (code: string) => !q || fold(code).includes(q) || fold(countryName(code)).includes(q);
    const byName = (a: string, b: string) => countryName(a).localeCompare(countryName(b));
    return {
      withRules: PACK_COUNTRIES.filter(matches).sort(byName),
      others: ISO_COUNTRY_CODES.filter((c) => !PACK_COUNTRY_SET.has(c) && matches(c)).sort(byName),
    };
  }, [query, countryName]);

  const timeZoneInvalid = timeZone.trim().length > 0 && !isValidTimeZone(timeZone.trim());
  const timeZoneMismatch = !timeZoneInvalid && timeZone.trim().length > 0 && !!country && !zoneFitsCountry(timeZone.trim(), country);

  const handleSave = useCallback(async () => {
    const input: LocationInput = {
      ...(initial ? { id: initial.id } : {}),
      name,
      countryCode: country ?? '',
      regionCode: region,
      cityCode: city,
      jurisdictionCode: jurisdictionCode ?? '',
      timeZone: timeZone.trim(),
      industry: industry as Industry,
      employerHeadcount: headcount.trim() === '' ? null : Number(headcount.trim()),
      locationsCount: initial?.locationsCount ?? null,
      detectedHint: initial ? initial.detectedHint : (suggestion?.hint ?? null),
    };
    const checked = validateLocationInput(input);
    if (!checked.ok) {
      setError(t(`locations.errors.${FORM_ERRORS.includes(checked.code) ? checked.code : 'generic'}`));
      return;
    }
    setError(null);
    setSaving(true);
    const result = await onSave(input);
    setSaving(false);
    if (result.ok) onSaved?.(result.data);
    else setError(t('locations.saveFailed', { error: result.error }));
  }, [initial, name, country, region, city, jurisdictionCode, timeZone, industry, headcount, suggestion, onSave, onSaved, t]);

  const detectionMessage = (() => {
    if (editing || countryPicked) return null;
    if (detecting) return t('locations.detecting');
    if (!suggestion || suggestion.status === 'unknown' || !suggestion.country) return t('locations.unknown');
    if (suggestion.status === 'conflict') {
      return t('locations.conflict', { ipCountry: countryName(suggestion.choices[0]), deviceCountry: countryName(suggestion.choices[1]) });
    }
    return t('locations.detected', { country: countryName(suggestion.country) });
  })();

  const showPicker = pickerOpen || !country;

  return (
    <ThemedView style={styles.card} testID="location-setup-card">
      <ThemedText type="subtitle">{editing ? t('locations.editTitle') : t('locations.setupTitle')}</ThemedText>
      <ThemedText style={styles.muted}>{t('locations.setupIntro')}</ThemedText>

      {detectionMessage ? (
        <View style={styles.notice}>
          <ThemedText style={styles.noticeText} testID="location-detect-message">{detectionMessage}</ThemedText>
          {suggestion?.status === 'conflict' && !countryPicked ? (
            <View
              style={styles.chipRow}
              accessibilityRole="radiogroup"
              accessibilityLabel={t('locations.countryLabel')}
            >
              {suggestion.choices.map((code) => (
                <OptionChip
                  key={code}
                  label={countryName(code)}
                  selected={country === code}
                  onPress={() => pickCountry(code)}
                  hint={t('locations.chooseCountryHint')}
                  testID={`choice-${code}`}
                  styles={styles}
                />
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={styles.field}>
        <ThemedText style={styles.label}>{t('locations.countryLabel')}</ThemedText>
        {country ? (
          <View style={styles.rowBetween}>
            <ThemedText type="defaultSemiBold" testID="location-country">{countryName(country)}</ThemedText>
            <Pressable
              onPress={() => setPickerOpen((open) => !open)}
              testID="location-change-country"
              accessibilityRole="button"
              accessibilityLabel={t('locations.changeCountry')}
              accessibilityHint={t('locations.changeCountryHint')}
              style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]}
            >
              <ThemedText style={styles.linkText}>{t('locations.changeCountry')}</ThemedText>
            </Pressable>
          </View>
        ) : null}

        {showPicker ? (
          <View style={styles.picker} testID="location-country-picker">
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t('locations.countrySearchPlaceholder')}
              placeholderTextColor={colors.textTertiary}
              style={styles.input}
              testID="location-country-search"
              accessibilityLabel={t('locations.countrySearchLabel')}
              accessibilityHint={t('locations.countrySearchPlaceholder')}
              autoCorrect={false}
            />
            <ScrollView
              style={styles.pickerList}
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
              accessibilityRole="radiogroup"
              accessibilityLabel={t('locations.countryLabel')}
            >
              {filteredCountries.withRules.length ? (
                <ThemedText style={styles.groupLabel}>{t('locations.countriesWithRules')}</ThemedText>
              ) : null}
              {filteredCountries.withRules.map((code) => (
                <CountryRow key={code} code={code} label={countryName(code)} selected={country === code} onPress={pickCountry} t={t} styles={styles} />
              ))}
              {filteredCountries.others.length ? (
                <ThemedText style={styles.groupLabel}>{t('locations.allCountries')}</ThemedText>
              ) : null}
              {filteredCountries.others.map((code) => (
                <CountryRow key={code} code={code} label={countryName(code)} selected={country === code} onPress={pickCountry} t={t} styles={styles} />
              ))}
              {!filteredCountries.withRules.length && !filteredCountries.others.length ? (
                <ThemedText style={styles.muted}>{t('locations.noCountryMatch', { query })}</ThemedText>
              ) : null}
            </ScrollView>
          </View>
        ) : null}
      </View>

      {country ? (
        <>
          {regions.length ? (
            <View style={styles.field}>
              <ThemedText style={styles.label}>{t('locations.regionLabel')}</ThemedText>
              <View
                style={styles.chipRow}
                accessibilityRole="radiogroup"
                accessibilityLabel={t('locations.regionLabel')}
              >
                {regions.map((r) => (
                  <OptionChip key={r.code} label={r.name} selected={region === r.region} onPress={() => pickRegion(r.region ?? null)} hint={t('locations.optionHint')} testID={`region-option-${r.region}`} styles={styles} />
                ))}
                <OptionChip label={t('locations.regionOther')} selected={region === null} onPress={() => pickRegion(null)} hint={t('locations.optionHint')} testID="region-option-other" styles={styles} />
              </View>
            </View>
          ) : null}

          {cities.length ? (
            <View style={styles.field}>
              <ThemedText style={styles.label}>{t('locations.cityLabel')}</ThemedText>
              <ThemedText style={styles.muted}>{t('locations.cityHelp')}</ThemedText>
              <View
                style={styles.chipRow}
                accessibilityRole="radiogroup"
                accessibilityLabel={t('locations.cityLabel')}
              >
                {cities.map((c) => (
                  <OptionChip key={c.code} label={c.name} selected={city === c.city} onPress={() => setCity(c.city ?? null)} hint={t('locations.optionHint')} testID={`city-option-${c.city}`} styles={styles} />
                ))}
                <OptionChip label={t('locations.cityOther')} selected={city === null} onPress={() => setCity(null)} hint={t('locations.optionHint')} testID="city-option-other" styles={styles} />
              </View>
            </View>
          ) : null}

          <InputField
            label={t('locations.nameLabel')}
            value={name}
            onChangeText={setName}
            placeholder={t('locations.namePlaceholder')}
            accessibilityHint={t('locations.namePlaceholder')}
            testID="location-name"
          />

          <View style={styles.field}>
            <InputField
              label={t('locations.timeZoneLabel')}
              value={timeZone}
              onChangeText={(value) => {
                setTimeZone(value);
                setTimeZoneTouched(true);
              }}
              placeholder={t('locations.timeZonePlaceholder')}
              accessibilityHint={t('locations.timeZoneHint')}
              testID="location-timezone"
            />
            {timeZoneInvalid ? <ThemedText style={styles.errorText}>{t('locations.errors.TIME_ZONE_INVALID')}</ThemedText> : null}
            {timeZoneMismatch ? <ThemedText style={styles.errorText}>{t('locations.errors.TIME_ZONE_COUNTRY_MISMATCH')}</ThemedText> : null}
          </View>

          <View style={styles.field}>
            <ThemedText style={styles.label}>{t('locations.industryLabel')}</ThemedText>
            <View
              style={styles.chipRow}
              accessibilityRole="radiogroup"
              accessibilityLabel={t('locations.industryLabel')}
            >
              {INDUSTRIES.map((value) => (
                <OptionChip key={value} label={t(`locations.industries.${value}`)} selected={industry === value} onPress={() => setIndustry(value)} hint={t('locations.optionHint')} testID={`industry-option-${value}`} styles={styles} />
              ))}
            </View>
          </View>

          <View style={styles.field}>
            <InputField
              label={t('locations.headcountLabel')}
              value={headcount}
              onChangeText={setHeadcount}
              placeholder={t('locations.headcountPlaceholder')}
              keyboardType="numeric"
              accessibilityHint={t('locations.headcountHelp')}
              testID="location-headcount"
            />
            <ThemedText style={styles.muted}>{t('locations.headcountHelp')}</ThemedText>
          </View>

          {rulesName ? (
            <View style={styles.rulesBox}>
              <ThemedText type="defaultSemiBold" testID="location-rules">{t('locations.rulesApplied', { name: rulesName })}</ThemedText>
              {isBaseline ? <ThemedText style={styles.muted} testID="location-baseline-note">{t('locations.baselineNote')}</ThemedText> : null}
            </View>
          ) : null}
        </>
      ) : null}

      {error ? <ThemedText style={styles.errorText} testID="location-error">{error}</ThemedText> : null}

      <View style={styles.actions}>
        {onCancel ? (
          <Pressable
            onPress={onCancel}
            accessibilityRole="button"
            accessibilityLabel={t('locations.cancel')}
            accessibilityHint={t('locations.cancelHint')}
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
          >
            <ThemedText style={styles.secondaryButtonText}>{t('locations.cancel')}</ThemedText>
          </Pressable>
        ) : null}
        <Pressable
          onPress={handleSave}
          disabled={saving || !country}
          testID="location-save"
          accessibilityRole="button"
          accessibilityState={{ disabled: saving || !country }}
          accessibilityLabel={t('locations.saveA11y')}
          accessibilityHint={t('locations.saveHint')}
          style={({ pressed }) => [styles.primaryButton, (saving || !country) && styles.disabled, pressed && styles.pressed]}
        >
          <ThemedText style={styles.primaryButtonText}>{saving ? t('locations.saving') : t('locations.save')}</ThemedText>
        </Pressable>
      </View>
    </ThemedView>
  );
}

function CountryRow({
  code,
  label,
  selected,
  onPress,
  t,
  styles,
}: {
  code: string;
  label: string;
  selected: boolean;
  onPress: (code: string) => void;
  t: ReturnType<typeof useT>['t'];
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <Pressable
      onPress={() => onPress(code)}
      testID={`country-option-${code}`}
      accessibilityRole="radio"
      aria-checked={selected}
      accessibilityLabel={t('locations.chooseCountryA11y', { country: label })}
      accessibilityHint={t('locations.chooseCountryHint')}
      style={({ pressed }) => [styles.countryRow, selected && styles.countryRowSelected, pressed && styles.pressed]}
    >
      <ThemedText>{label}</ThemedText>
      <ThemedText style={styles.muted}>{code}</ThemedText>
    </Pressable>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    card: {
      borderRadius: 14,
      padding: 18,
      gap: 14,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    muted: { fontSize: 13, lineHeight: 19, color: colors.textSecondary },
    notice: {
      gap: 8,
      padding: 12,
      borderRadius: 10,
      backgroundColor: brand.primarySurface,
      borderLeftWidth: 3,
      borderLeftColor: brand.primary,
    },
    noticeText: { fontSize: 14, lineHeight: 20, color: '#0F172A' },
    field: { gap: 8 },
    label: { fontSize: 14, fontWeight: '600' },
    rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    linkButton: { paddingVertical: 6, paddingHorizontal: 8, minHeight: 32, justifyContent: 'center' },
    linkText: { color: colors.tintText, fontWeight: '600', fontSize: 14 },
    picker: { gap: 8 },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
      color: colors.text,
      backgroundColor: colors.surface,
    },
    pickerList: { maxHeight: 280, borderWidth: 1, borderColor: colors.border, borderRadius: 8 },
    groupLabel: {
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.4,
      textTransform: 'uppercase',
      color: colors.textSecondary,
      paddingHorizontal: 12,
      paddingTop: 10,
      paddingBottom: 4,
    },
    countryRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 10,
      minHeight: 44,
    },
    countryRowSelected: { backgroundColor: colors.surfaceSecondary },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
      borderWidth: 1.5,
      borderColor: colors.border,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 8,
      minHeight: 36,
      justifyContent: 'center',
    },
    chipSelected: { borderColor: brand.primary, backgroundColor: brand.primarySurface },
    chipText: { fontSize: 14, color: colors.text },
    chipTextSelected: { color: brand.primaryDeep, fontWeight: '600' },
    rulesBox: { gap: 6, padding: 12, borderRadius: 10, backgroundColor: colors.background },
    errorText: { fontSize: 13, color: colors.error },
    actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
    primaryButton: {
      backgroundColor: brand.primaryDark,
      borderRadius: 10,
      paddingVertical: 12,
      paddingHorizontal: 18,
      minHeight: 44,
      justifyContent: 'center',
    },
    primaryButtonText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
    secondaryButton: {
      borderWidth: 1.5,
      borderColor: colors.border,
      borderRadius: 10,
      paddingVertical: 12,
      paddingHorizontal: 16,
      minHeight: 44,
      justifyContent: 'center',
    },
    secondaryButtonText: { color: colors.text, fontWeight: '600', fontSize: 15 },
    disabled: { opacity: 0.5 },
    pressed: { opacity: 0.75 },
  });
