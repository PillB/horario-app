import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from 'react-native';

import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { Colors, brand } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useT } from '@/contexts/LocaleContext';

// ─── Public Types ─────────────────────────────────────────────────────────────

export type ShiftConstraints = {
  minRestHours: number;
  maxWeeklyHours: number;
  minShiftHours: number;
  locationMode: 'single' | 'multi';
  locations: string[];
};

// ─── Internal Types ───────────────────────────────────────────────────────────

type IndustryPresetKey = 'restaurant' | 'retail' | 'cafe' | 'hotel';

type IndustryPreset = Pick<
  ShiftConstraints,
  'minRestHours' | 'maxWeeklyHours' | 'minShiftHours'
>;

type ConstraintDraft = {
  minRestHours: string;
  maxWeeklyHours: string;
  minShiftHours: string;
};

type Action =
  | { type: 'SET_FIELD'; field: keyof ConstraintDraft; value: string }
  | { type: 'APPLY_PRESET'; preset: IndustryPreset }
  | { type: 'SET_LOCATION_MODE'; enabled: boolean }
  | { type: 'SET_LOCATIONS_RAW'; value: string };

type State = {
  draft: ConstraintDraft;
  locationMode: 'single' | 'multi';
  locationsRaw: string;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const INDUSTRY_PRESETS: Record<IndustryPresetKey, IndustryPreset> = {
  restaurant: { minRestHours: 10, maxWeeklyHours: 40, minShiftHours: 3 },
  retail: { minRestHours: 8, maxWeeklyHours: 40, minShiftHours: 4 },
  cafe: { minRestHours: 8, maxWeeklyHours: 35, minShiftHours: 2 },
  hotel: { minRestHours: 11, maxWeeklyHours: 48, minShiftHours: 6 },
};

// i18n keys for each preset — matched 1-to-1 with IndustryPresetKey
const PRESET_I18N_KEYS: Record<IndustryPresetKey, string> = {
  restaurant: 'advancedControls.presets.restaurant',
  retail: 'advancedControls.presets.retail',
  cafe: 'advancedControls.presets.cafe',
  hotel: 'advancedControls.presets.hotel',
};

const PRESET_KEYS = Object.keys(INDUSTRY_PRESETS) as IndustryPresetKey[];

const COLLAPSE_DURATION = 260;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parsePositiveInt(raw: string, fallback: number): number {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function buildConstraints(state: State): ShiftConstraints {
  return {
    minRestHours: parsePositiveInt(state.draft.minRestHours, 8),
    maxWeeklyHours: parsePositiveInt(state.draft.maxWeeklyHours, 40),
    minShiftHours: parsePositiveInt(state.draft.minShiftHours, 2),
    locationMode: state.locationMode,
    locations: state.locationsRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

function initState(initial?: Partial<ShiftConstraints>): State {
  return {
    draft: {
      minRestHours: String(initial?.minRestHours ?? 8),
      maxWeeklyHours: String(initial?.maxWeeklyHours ?? 40),
      minShiftHours: String(initial?.minShiftHours ?? 2),
    },
    locationMode: initial?.locationMode ?? 'single',
    locationsRaw: initial?.locations?.join(', ') ?? '',
  };
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'SET_FIELD':
      return {
        ...state,
        draft: { ...state.draft, [action.field]: action.value },
      };
    case 'APPLY_PRESET':
      return {
        ...state,
        draft: {
          minRestHours: String(action.preset.minRestHours),
          maxWeeklyHours: String(action.preset.maxWeeklyHours),
          minShiftHours: String(action.preset.minShiftHours),
        },
      };
    case 'SET_LOCATION_MODE':
      return { ...state, locationMode: action.enabled ? 'multi' : 'single' };
    case 'SET_LOCATIONS_RAW':
      return { ...state, locationsRaw: action.value };
    default:
      return state;
  }
}

// ─── Sub-component: Collapse Section ─────────────────────────────────────────

type CollapseSectionProps = {
  title: string;
  accessibilityHint?: string;
  children: React.ReactNode;
  initiallyOpen?: boolean;
  accentColor: string;
  borderColor: string;
  textColor: string;
  expandedLabel: string;
  collapsedLabel: string;
};

function CollapseSection({
  title,
  accessibilityHint,
  children,
  initiallyOpen = false,
  accentColor,
  borderColor,
  textColor,
  expandedLabel,
  collapsedLabel,
}: CollapseSectionProps) {
  const [open, setOpen] = useState(initiallyOpen);
  const animRef = useRef(new Animated.Value(initiallyOpen ? 1 : 0)).current;
  const rotateRef = useRef(new Animated.Value(initiallyOpen ? 1 : 0)).current;

  const toggle = useCallback(() => {
    const toValue = open ? 0 : 1;
    Animated.parallel([
      Animated.timing(animRef, {
        toValue,
        duration: COLLAPSE_DURATION,
        useNativeDriver: false,
      }),
      Animated.timing(rotateRef, {
        toValue,
        duration: COLLAPSE_DURATION,
        useNativeDriver: true,
      }),
    ]).start();
    setOpen((prev) => !prev);
  }, [animRef, open, rotateRef]);

  const maxHeight = animRef.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 600],
  });

  const rotate = rotateRef.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });

  return (
    <View style={[innerStyles.subSection, { borderColor }]}>
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityLabel={`${title} ${open ? expandedLabel : collapsedLabel}`}
        accessibilityHint={accessibilityHint}
        style={innerStyles.subHeader}
      >
        <ThemedText style={[innerStyles.subTitle, { color: textColor }]}>
          {title}
        </ThemedText>
        <Animated.Text
          style={[
            innerStyles.chevron,
            { color: accentColor, transform: [{ rotate }] },
          ]}
        >
          ▾
        </Animated.Text>
      </Pressable>

      <Animated.View style={{ overflow: 'hidden', maxHeight }}>
        <View style={innerStyles.subContent}>{children}</View>
      </Animated.View>
    </View>
  );
}

// ─── Sub-component: Number Input Row ─────────────────────────────────────────

type NumberRowProps = {
  label: string;
  value: string;
  unit: string;
  onChangeText: (v: string) => void;
  accessibilityLabel: string;
  inputBg: string;
  borderColor: string;
  textColor: string;
  placeholderColor: string;
};

function NumberRow({
  label,
  value,
  unit,
  onChangeText,
  accessibilityLabel,
  inputBg,
  borderColor,
  textColor,
  placeholderColor,
}: NumberRowProps) {
  return (
    <View style={innerStyles.row}>
      <ThemedText style={[innerStyles.rowLabel, { color: textColor }]}>
        {label}
      </ThemedText>
      <View style={innerStyles.rowRight}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          keyboardType="number-pad"
          accessibilityLabel={accessibilityLabel}
          style={[
            innerStyles.numberInput,
            {
              backgroundColor: inputBg,
              borderColor,
              color: textColor,
            },
          ]}
          placeholderTextColor={placeholderColor}
        />
        <ThemedText style={[innerStyles.unit, { color: placeholderColor }]}>
          {unit}
        </ThemedText>
      </View>
    </View>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  onConstraintsChange: (c: ShiftConstraints) => void;
  initialConstraints?: Partial<ShiftConstraints>;
};

// ─── Main Component ───────────────────────────────────────────────────────────

export function AdvancedControls({
  onConstraintsChange,
  initialConstraints,
}: Props) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { t } = useT();

  const isDark = colorScheme === 'dark';
  const cardBg = isDark ? '#1C2630' : '#FFFFFF';
  const borderColor = isDark ? '#2D3F50' : '#CCEDE9';
  const textColor = isDark ? '#E2F7F5' : '#134E4A';
  const subtextColor = isDark ? '#8BAAB8' : '#64748B';
  const inputBg = isDark ? '#1A2835' : '#F0FDFA';
  const inputBorder = isDark ? '#2D4A58' : '#99F6E4';
  const presetActiveBg = brand.primary;
  // Chevron glyphs are text: use the text-safe teal, not the fill teal.
  const accentText = colors.tintText;
  const presetInactiveBg = isDark ? '#1A2835' : '#F0FDFA';
  const presetActiveBorder = brand.primaryDark;
  const presetInactiveBorder = inputBorder;

  const [outerOpen, setOuterOpen] = useState(false);
  const outerAnim = useRef(new Animated.Value(0)).current;
  const outerRotate = useRef(new Animated.Value(0)).current;

  const [state, dispatch] = useReducer(reducer, initialConstraints, initState);

  const [activePreset, setActivePreset] = useState<IndustryPresetKey | null>(
    null,
  );

  // Resolved translation strings for section expanded/collapsed state labels
  const sectionExpandedLabel = t('advancedControls.a11y.subsectionExpanded');
  const sectionCollapsedLabel = t('advancedControls.a11y.subsectionCollapsed');

  // Notify parent whenever constraints change
  useEffect(() => {
    onConstraintsChange(buildConstraints(state));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const toggleOuter = useCallback(() => {
    const toValue = outerOpen ? 0 : 1;
    Animated.parallel([
      Animated.timing(outerAnim, {
        toValue,
        duration: COLLAPSE_DURATION,
        useNativeDriver: false,
      }),
      Animated.timing(outerRotate, {
        toValue,
        duration: COLLAPSE_DURATION,
        useNativeDriver: true,
      }),
    ]).start();
    setOuterOpen((prev) => !prev);
  }, [outerAnim, outerOpen, outerRotate]);

  const outerMaxHeight = outerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1200],
  });

  const outerChevronRotate = outerRotate.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });

  const handleField = useCallback(
    (field: keyof ConstraintDraft) => (value: string) => {
      dispatch({ type: 'SET_FIELD', field, value });
      setActivePreset(null);
    },
    [],
  );

  const handlePreset = useCallback((key: IndustryPresetKey) => {
    dispatch({ type: 'APPLY_PRESET', preset: INDUSTRY_PRESETS[key] });
    setActivePreset(key);
  }, []);

  const handleLocationToggle = useCallback((enabled: boolean) => {
    dispatch({ type: 'SET_LOCATION_MODE', enabled });
  }, []);

  const handleLocationsRaw = useCallback((value: string) => {
    dispatch({ type: 'SET_LOCATIONS_RAW', value });
  }, []);

  // Resolved title strings for the three inner CollapseSection instances
  const constraintsSectionTitle = t('advancedControls.constraints.title');
  const presetsSectionTitle = t('advancedControls.presets.title');
  const multiLocationSectionTitle = t('advancedControls.multiLocation.title');

  // Resolved unit string (used for all three NumberRow instances)
  const unitHours = t('advancedControls.unit.hours');

  return (
    <ThemedView style={[innerStyles.card, { backgroundColor: cardBg, borderColor }]}>
      {/* ── Outer header ── */}
      <Pressable
        onPress={toggleOuter}
        accessibilityRole="button"
        accessibilityLabel={`${t('advancedControls.title')} ${outerOpen ? sectionExpandedLabel : sectionCollapsedLabel}`}
        accessibilityHint={t('advancedControls.a11y.outerHint')}
        style={innerStyles.outerHeader}
      >
        <View style={innerStyles.outerHeaderLeft}>
          <ThemedText style={[innerStyles.outerTitle, { color: textColor }]}>
            {t('advancedControls.title')}
          </ThemedText>
        </View>
        <Animated.Text
          style={[
            innerStyles.chevron,
            { color: accentText, transform: [{ rotate: outerChevronRotate }] },
          ]}
        >
          ▾
        </Animated.Text>
      </Pressable>

      {/* ── Outer animated body ── */}
      <Animated.View style={{ overflow: 'hidden', maxHeight: outerMaxHeight }}>
        <View style={innerStyles.outerBody}>
          {/* ── Constraints section ── */}
          <CollapseSection
            title={constraintsSectionTitle}
            accessibilityHint={t('advancedControls.a11y.constraintsHint')}
            accentColor={accentText}
            borderColor={borderColor}
            textColor={textColor}
            expandedLabel={sectionExpandedLabel}
            collapsedLabel={sectionCollapsedLabel}
          >
            <NumberRow
              label={t('advancedControls.constraints.minRest')}
              value={state.draft.minRestHours}
              unit={unitHours}
              onChangeText={handleField('minRestHours')}
              accessibilityLabel={t('advancedControls.a11y.minRestA11y')}
              inputBg={inputBg}
              borderColor={inputBorder}
              textColor={textColor}
              placeholderColor={subtextColor}
            />
            <NumberRow
              label={t('advancedControls.constraints.maxWeekly')}
              value={state.draft.maxWeeklyHours}
              unit={unitHours}
              onChangeText={handleField('maxWeeklyHours')}
              accessibilityLabel={t('advancedControls.a11y.maxWeeklyA11y')}
              inputBg={inputBg}
              borderColor={inputBorder}
              textColor={textColor}
              placeholderColor={subtextColor}
            />
            <NumberRow
              label={t('advancedControls.constraints.minShift')}
              value={state.draft.minShiftHours}
              unit={unitHours}
              onChangeText={handleField('minShiftHours')}
              accessibilityLabel={t('advancedControls.a11y.minShiftA11y')}
              inputBg={inputBg}
              borderColor={inputBorder}
              textColor={textColor}
              placeholderColor={subtextColor}
            />
          </CollapseSection>

          {/* ── Industry presets section ── */}
          <CollapseSection
            title={presetsSectionTitle}
            accessibilityHint={t('advancedControls.a11y.presetsHint')}
            accentColor={accentText}
            borderColor={borderColor}
            textColor={textColor}
            expandedLabel={sectionExpandedLabel}
            collapsedLabel={sectionCollapsedLabel}
          >
            <View style={innerStyles.presetRow}>
              {PRESET_KEYS.map((key) => {
                const isActive = activePreset === key;
                return (
                  <Pressable
                    key={key}
                    onPress={() => handlePreset(key)}
                    accessibilityRole="button"
                    accessibilityLabel={t(PRESET_I18N_KEYS[key])}
                    accessibilityState={{ selected: isActive }}
                    style={[
                      innerStyles.presetChip,
                      {
                        backgroundColor: isActive ? presetActiveBg : presetInactiveBg,
                        borderColor: isActive ? presetActiveBorder : presetInactiveBorder,
                      },
                    ]}
                  >
                    <ThemedText
                      style={[
                        innerStyles.presetChipText,
                        { color: isActive ? '#FFFFFF' : textColor },
                      ]}
                    >
                      {t(PRESET_I18N_KEYS[key])}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
          </CollapseSection>

          {/* ── Multi-location section ── */}
          <CollapseSection
            title={multiLocationSectionTitle}
            accessibilityHint={t('advancedControls.a11y.multiLocationHint')}
            accentColor={accentText}
            borderColor={borderColor}
            textColor={textColor}
            expandedLabel={sectionExpandedLabel}
            collapsedLabel={sectionCollapsedLabel}
          >
            <View style={innerStyles.row}>
              <ThemedText style={[innerStyles.rowLabel, { color: textColor }]}>
                {t('advancedControls.multiLocation.toggle')}
              </ThemedText>
              <Switch
                value={state.locationMode === 'multi'}
                onValueChange={handleLocationToggle}
                trackColor={{ false: borderColor, true: brand.primaryLight }}
                thumbColor={state.locationMode === 'multi' ? brand.primary : subtextColor}
                accessibilityLabel={t('advancedControls.a11y.multiLocationSwitch')}
              />
            </View>
            {state.locationMode === 'multi' ? (
              <View style={innerStyles.row}>
                <ThemedText style={[innerStyles.rowLabel, { color: textColor }]}>
                  {t('advancedControls.multiLocation.locations')}
                </ThemedText>
                <TextInput
                  value={state.locationsRaw}
                  onChangeText={handleLocationsRaw}
                  placeholder={t('advancedControls.multiLocation.locationsPlaceholder')}
                  placeholderTextColor={subtextColor}
                  accessibilityLabel={t('advancedControls.a11y.locationsA11y')}
                  style={[
                    innerStyles.locationsInput,
                    { backgroundColor: inputBg, borderColor: inputBorder, color: textColor },
                  ]}
                />
              </View>
            ) : null}
          </CollapseSection>
        </View>
      </Animated.View>
    </ThemedView>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const innerStyles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: 1.5,
    overflow: 'hidden',
    marginBottom: 8,
  },
  outerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  outerHeaderLeft: {
    flex: 1,
  },
  outerTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  outerBody: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    gap: 8,
  },
  chevron: {
    fontSize: 18,
    fontWeight: '700',
  },

  // ── CollapseSection ────────────────────────────────────────────────────────
  subSection: {
    borderWidth: 1,
    borderRadius: 10,
    overflow: 'hidden',
  },
  subHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  subTitle: {
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  subContent: {
    paddingHorizontal: 14,
    paddingBottom: 12,
    gap: 10,
  },

  // ── NumberRow ─────────────────────────────────────────────────────────────
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    minHeight: 44,
  },
  rowLabel: {
    flex: 1,
    fontSize: 13,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  numberInput: {
    width: 64,
    height: 36,
    borderRadius: 8,
    borderWidth: 1.5,
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '600',
  },
  unit: {
    fontSize: 12,
    width: 36,
  },

  // ── Presets ───────────────────────────────────────────────────────────────
  presetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  presetChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  presetChipText: {
    fontSize: 13,
    fontWeight: '600',
  },

  // ── Locations ─────────────────────────────────────────────────────────────
  locationsInput: {
    flex: 1,
    height: 36,
    borderRadius: 8,
    borderWidth: 1.5,
    paddingHorizontal: 10,
    fontSize: 13,
  },
});