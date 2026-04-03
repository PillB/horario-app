import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { Colors, brand, type ThemeColors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useT } from '@/contexts/LocaleContext';

type BusinessType = 'restaurant' | 'retail' | 'cafe' | 'hotel' | 'general';

type PlaybookTemplate = {
  id: string;
  name: string;
  role: string;
  start: string;
  end: string;
  coverage: number;
  businessType: BusinessType;
  description: string;
};

type Playbook = {
  id: string;
  title: string;
  description: string;
  businessType: BusinessType;
  fixesCondition?: string;
  templates: PlaybookTemplate[];
};

export type PlaybookLibraryProps = {
  onImportTemplate: (tpl: Omit<PlaybookTemplate, 'id' | 'businessType' | 'description'>) => void;
  highlightCondition?: string;
};

const PLAYBOOKS: Playbook[] = [
  {
    id: 'restaurant-opening',
    title: 'Restaurant Opening Shifts',
    description: 'Essential opening shifts for a full restaurant service day.',
    businessType: 'restaurant',
    fixesCondition: 'No shifts published',
    templates: [
      {
        id: 'restaurant-opening-tpl-1',
        name: 'Morning Prep',
        role: 'Kitchen',
        start: '06:00',
        end: '09:00',
        coverage: 2,
        businessType: 'restaurant',
        description: 'Kitchen preparation before opening.',
      },
      {
        id: 'restaurant-opening-tpl-2',
        name: 'Floor Open',
        role: 'Server',
        start: '09:00',
        end: '14:00',
        coverage: 3,
        businessType: 'restaurant',
        description: 'Front-of-house opening service.',
      },
      {
        id: 'restaurant-opening-tpl-3',
        name: 'Lunch Rush',
        role: 'Server',
        start: '11:00',
        end: '15:00',
        coverage: 4,
        businessType: 'restaurant',
        description: 'Peak lunch period coverage.',
      },
    ],
  },
  {
    id: 'retail-weekend',
    title: 'Retail Weekend Coverage',
    description: 'Full weekend shift rotation to meet peak retail demand.',
    businessType: 'retail',
    fixesCondition: 'Coverage below 70%',
    templates: [
      {
        id: 'retail-weekend-tpl-1',
        name: 'Opening',
        role: 'Sales',
        start: '09:00',
        end: '13:00',
        coverage: 2,
        businessType: 'retail',
        description: 'Store opening shift.',
      },
      {
        id: 'retail-weekend-tpl-2',
        name: 'Mid-Shift',
        role: 'Sales',
        start: '12:00',
        end: '17:00',
        coverage: 3,
        businessType: 'retail',
        description: 'Midday peak coverage.',
      },
      {
        id: 'retail-weekend-tpl-3',
        name: 'Closing',
        role: 'Sales',
        start: '16:00',
        end: '20:00',
        coverage: 2,
        businessType: 'retail',
        description: 'Store closing shift.',
      },
    ],
  },
  {
    id: 'cafe-full-day',
    title: 'Café Full-Day Rotation',
    description: 'Smooth barista rotation from open to close.',
    businessType: 'cafe',
    templates: [
      {
        id: 'cafe-full-day-tpl-1',
        name: 'Opening Barista',
        role: 'Barista',
        start: '06:30',
        end: '11:00',
        coverage: 1,
        businessType: 'cafe',
        description: 'Early morning café opening.',
      },
      {
        id: 'cafe-full-day-tpl-2',
        name: 'Mid',
        role: 'Barista',
        start: '10:00',
        end: '15:00',
        coverage: 2,
        businessType: 'cafe',
        description: 'Midday service overlap.',
      },
      {
        id: 'cafe-full-day-tpl-3',
        name: 'Afternoon',
        role: 'Barista',
        start: '14:00',
        end: '19:00',
        coverage: 1,
        businessType: 'cafe',
        description: 'Afternoon and closing service.',
      },
    ],
  },
  {
    id: 'hotel-reception',
    title: 'Hotel 24h Reception',
    description: 'Round-the-clock reception staffing for hotel front desk.',
    businessType: 'hotel',
    templates: [
      {
        id: 'hotel-reception-tpl-1',
        name: 'Morning',
        role: 'Reception',
        start: '07:00',
        end: '15:00',
        coverage: 2,
        businessType: 'hotel',
        description: 'Morning reception shift.',
      },
      {
        id: 'hotel-reception-tpl-2',
        name: 'Evening',
        role: 'Reception',
        start: '15:00',
        end: '23:00',
        coverage: 2,
        businessType: 'hotel',
        description: 'Evening reception shift.',
      },
      {
        id: 'hotel-reception-tpl-3',
        name: 'Night',
        role: 'Reception',
        start: '23:00',
        end: '07:00',
        coverage: 1,
        businessType: 'hotel',
        description: 'Overnight reception shift.',
      },
    ],
  },
  {
    id: 'coverage-fix',
    title: 'Quick Coverage Fix',
    description: 'Add one flexible shift per gap',
    businessType: 'general',
    fixesCondition: 'Coverage below 70%',
    templates: [
      {
        id: 'coverage-fix-tpl-1',
        name: 'Flex AM',
        role: 'General',
        start: '08:00',
        end: '14:00',
        coverage: 1,
        businessType: 'general',
        description: 'Flexible morning gap filler.',
      },
      {
        id: 'coverage-fix-tpl-2',
        name: 'Flex PM',
        role: 'General',
        start: '14:00',
        end: '20:00',
        coverage: 1,
        businessType: 'general',
        description: 'Flexible afternoon gap filler.',
      },
    ],
  },
];

type FilterOption = BusinessType | 'all';

const FILTER_OPTIONS: FilterOption[] = ['all', 'restaurant', 'retail', 'cafe', 'hotel', 'general'];

const BUSINESS_TYPE_LABELS: Record<BusinessType, string> = {
  restaurant: 'Restaurant',
  retail: 'Retail',
  cafe: 'Café',
  hotel: 'Hotel',
  general: 'General',
};

function toImportPayload(
  tpl: PlaybookTemplate,
): Omit<PlaybookTemplate, 'id' | 'businessType' | 'description'> {
  return {
    name: tpl.name,
    role: tpl.role,
    start: tpl.start,
    end: tpl.end,
    coverage: tpl.coverage,
  };
}

export function PlaybookLibrary({
  onImportTemplate,
  highlightCondition,
}: PlaybookLibraryProps): React.ReactElement {
  const t = useT();
  const colorScheme = useColorScheme();
  const theme: ThemeColors = Colors[colorScheme ?? 'light'];

  const [activeFilter, setActiveFilter] = useState<FilterOption>('all');

  const filteredPlaybooks =
    activeFilter === 'all'
      ? PLAYBOOKS
      : PLAYBOOKS.filter((pb) => pb.businessType === activeFilter);

  function handleImportAll(playbook: Playbook): void {
    playbook.templates.forEach((tpl) => {
      onImportTemplate(toImportPayload(tpl));
    });
  }

  function handleImportOne(tpl: PlaybookTemplate): void {
    onImportTemplate(toImportPayload(tpl));
  }

  const dynamicStyles = createDynamicStyles(theme);

  return (
    <ThemedView style={styles.container}>
      <View style={styles.headerContainer}>
        <ThemedText type="defaultSemiBold" style={styles.sectionTitle}>
          {t('playbook.title')}
        </ThemedText>
        <ThemedText style={[styles.subtitle, { color: theme.textSecondary }]}>
          {t('playbook.subtitle')}
        </ThemedText>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterScrollContent}
        style={styles.filterScroll}
      >
        {FILTER_OPTIONS.map((option) => {
          const isActive = activeFilter === option;
          const label =
            option === 'all'
              ? t('playbook.filterAll')
              : BUSINESS_TYPE_LABELS[option as BusinessType];
          return (
            <Pressable
              key={option}
              onPress={() => setActiveFilter(option)}
              accessibilityRole="radio"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={label}
              style={[
                styles.filterChip,
                isActive
                  ? dynamicStyles.filterChipActive
                  : dynamicStyles.filterChipInactive,
              ]}
            >
              <ThemedText
                style={[
                  styles.filterChipText,
                  isActive
                    ? styles.filterChipTextActive
                    : { color: theme.textSecondary },
                ]}
              >
                {label}
              </ThemedText>
            </Pressable>
          );
        })}
      </ScrollView>

      {filteredPlaybooks.length === 0 ? (
        <View style={styles.emptyContainer}>
          <ThemedText style={{ color: theme.textSecondary }}>
            {t('playbook.empty')}
          </ThemedText>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.playbookListContent}
        >
          {filteredPlaybooks.map((playbook) => {
            const isHighlighted =
              highlightCondition !== undefined &&
              highlightCondition.length > 0 &&
              playbook.fixesCondition === highlightCondition;

            return (
              <View
                key={playbook.id}
                style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}
              >
                <View style={styles.cardHeader}>
                  <View style={styles.cardTitleRow}>
                    <ThemedText type="defaultSemiBold" style={styles.cardTitle}>
                      {playbook.title}
                    </ThemedText>
                    <View
                      style={[
                        styles.badgeChip,
                        { backgroundColor: theme.surfaceSecondary ?? theme.surface },
                      ]}
                    >
                      <ThemedText
                        style={[styles.badgeChipText, { color: theme.textSecondary }]}
                      >
                        {BUSINESS_TYPE_LABELS[playbook.businessType]}
                      </ThemedText>
                    </View>
                  </View>

                  {isHighlighted && playbook.fixesCondition !== undefined && (
                    <View style={styles.fixesBadge}>
                      <ThemedText style={styles.fixesBadgeText}>
                        {t('playbook.fixes')} {playbook.fixesCondition}
                      </ThemedText>
                    </View>
                  )}
                </View>

                <ThemedText style={[styles.cardDescription, { color: theme.textSecondary }]}>
                  {playbook.description}
                </ThemedText>

                <View style={styles.templateList}>
                  {playbook.templates.map((tpl) => (
                    <View
                      key={tpl.id}
                      style={[
                        styles.templateRow,
                        { borderTopColor: theme.border },
                      ]}
                    >
                      <View
                        style={[
                          styles.roleChip,
                          { backgroundColor: theme.surfaceSecondary ?? theme.surface },
                        ]}
                      >
                        <ThemedText
                          style={[styles.roleChipText, { color: theme.textSecondary }]}
                          numberOfLines={1}
                        >
                          {tpl.role}
                        </ThemedText>
                      </View>

                      <View style={styles.templateInfo}>
                        <ThemedText style={styles.templateName} numberOfLines={1}>
                          {tpl.name}
                        </ThemedText>
                        <ThemedText
                          style={[styles.templateTime, { color: theme.textSecondary }]}
                        >
                          {tpl.start}–{tpl.end}
                        </ThemedText>
                      </View>

                      <ThemedText
                        style={[styles.coverageText, { color: theme.textSecondary }]}
                      >
                        ×{tpl.coverage}
                      </ThemedText>

                      <Pressable
                        onPress={() => handleImportOne(tpl)}
                        accessibilityRole="button"
                        accessibilityLabel={t('playbook.importOne')}
                        style={[
                          styles.importOneButton,
                          { backgroundColor: brand.primary },
                        ]}
                      >
                        <ThemedText style={styles.importOneButtonText}>+</ThemedText>
                      </Pressable>
                    </View>
                  ))}
                </View>

                <Pressable
                  onPress={() => handleImportAll(playbook)}
                  accessibilityRole="button"
                  accessibilityLabel={`${t('playbook.importAll', {
                    n: String(playbook.templates.length),
                  })} — ${playbook.title}`}
                  style={({ pressed }) => [
                    styles.importAllButton,
                    { backgroundColor: brand.primary, opacity: pressed ? 0.8 : 1 },
                  ]}
                >
                  <ThemedText style={styles.importAllButtonText}>
                    {t('playbook.importAll', { n: String(playbook.templates.length) })}
                  </ThemedText>
                </Pressable>
              </View>
            );
          })}
        </ScrollView>
      )}
    </ThemedView>
  );
}

function createDynamicStyles(theme: ThemeColors): ReturnType<typeof StyleSheet.create> {
  return StyleSheet.create({
    filterChipActive: {
      backgroundColor: brand.primary,
    },
    filterChipInactive: {
      backgroundColor: theme.surface,
    },
  });
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingVertical: 8,
  },
  headerContainer: {
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
  },
  filterScroll: {
    flexGrow: 0,
    marginBottom: 12,
  },
  filterScrollContent: {
    paddingHorizontal: 16,
    gap: 8,
    alignItems: 'center',
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '500',
  },
  filterChipTextActive: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '500',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
  },
  playbookListContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    gap: 16,
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  cardHeader: {
    marginBottom: 6,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 4,
  },
  cardTitle: {
    fontSize: 15,
    flexShrink: 1,
  },
  badgeChip: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  badgeChipText: {
    fontSize: 11,
    fontWeight: '500',
  },
  fixesBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#FEF3C7',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginTop: 4,
  },
  fixesBadgeText: {
    color: '#D97706',
    fontSize: 11,
    fontWeight: '600',
  },
  cardDescription: {
    fontSize: 13,
    marginBottom: 10,
    lineHeight: 18,
  },
  templateList: {
    marginBottom: 12,
  },
  templateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  roleChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    maxWidth: 80,
  },
  roleChipText: {
    fontSize: 11,
    fontWeight: '500',
  },
  templateInfo: {
    flex: 1,
    flexDirection: 'column',
  },
  templateName: {
    fontSize: 13,
    fontWeight: '500',
  },
  templateTime: {
    fontSize: 12,
    marginTop: 1,
  },
  coverageText: {
    fontSize: 13,
    fontWeight: '600',
    minWidth: 24,
    textAlign: 'right',
  },
  importOneButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  importOneButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 22,
  },
  importAllButton: {
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  importAllButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
});