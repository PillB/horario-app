import React from 'react';
import { View, Pressable } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { type Shift, type ShiftTemplate } from '@/utils/schedulerMetrics';
import { type Worker } from '@/types/scheduler';
import { type DemandForecast } from '@/services/demandForecast';
import { SectionCard } from './SectionCard';
import { schedulerStyles as styles } from '@/styles/scheduler.styles';
import { useT } from '@/contexts/LocaleContext';

type RosterShift = Shift & { template?: ShiftTemplate; worker?: Worker };
type StaffingGap = DemandForecast & { scheduled: number; gap: number };

type Props = {
  publishCelebration: { badgeVisible: boolean; confettiBurst: boolean };
  rosterByDate: Record<string, RosterShift[]>;
  handlePublishShift: (shiftId: string) => void;
  handleUnpublishShift: (shiftId: string) => void;
  handleNotifyShift: (shiftId: string) => void;
  upcomingShifts: RosterShift[];
  staffingGaps: StaffingGap[];
};

export const RosterSection = ({
  publishCelebration,
  rosterByDate,
  handlePublishShift,
  handleUnpublishShift,
  handleNotifyShift,
  upcomingShifts,
  staffingGaps,
}: Props) => {
  const { t } = useT();
  return (
    <>
      <SectionCard
        title={t('scheduler.roster.sectionTitle')}
        subtitle={t('scheduler.roster.sectionSubtitle')}
        tooltip={t('scheduler.roster.tooltip')}
      >
        {publishCelebration.badgeVisible ? (
          <View style={[styles.badge, styles.positiveBadge, styles.securedBadge]}>
            <View style={styles.securedDot} />
            <ThemedText style={styles.badgeText}>{t('scheduler.roster.secured')}</ThemedText>
          </View>
        ) : null}
        {Object.entries(rosterByDate).length === 0 ? (
          <View>
            <View style={styles.ghostContainer} accessibilityElementsHidden>
              {[0, 1].map((i) => (
                <View key={i} style={styles.ghostRow}>
                  <View style={styles.ghostBlock}>
                    <View style={styles.ghostNameBar} />
                    <View style={styles.ghostTimeBar} />
                  </View>
                  <View style={[styles.ghostBadgeBar, { width: 52 }]} />
                </View>
              ))}
            </View>
            <View style={styles.ghostEmptyCta}>
              <ThemedText style={styles.ghostEmptyCtaText}>{t('scheduler.roster.emptyTitle')}</ThemedText>
            </View>
            <ThemedText style={styles.ghostEmptyNote}>
              {t('scheduler.roster.emptyDesc')}
            </ThemedText>
          </View>
        ) : null}
        {Object.entries(rosterByDate).map(([date, shifts]) => (
          <View key={date} style={styles.rosterDay}>
            <ThemedText type="defaultSemiBold">{date}</ThemedText>
            {shifts.map((shift) => (
              <View key={shift.id} style={styles.rosterRow}>
                <View style={styles.rowBetween}>
                  <ThemedText style={styles.badgeText}>
                    {shift.template?.name ?? shift.templateId}
                  </ThemedText>
                  <ThemedText
                    style={[
                      styles.status,
                      shift.status === 'Draft' ? styles.draftStatus : styles.publishedStatus,
                    ]}
                  >
                    {shift.status === 'Draft' ? t('common.draft') : t('common.published')}
                  </ThemedText>
                </View>
                <ThemedText>
                  {shift.worker?.name ?? shift.workerId} • {shift.template?.start} -{' '}
                  {shift.template?.end}
                </ThemedText>
                <View style={styles.rosterActions}>
                  <Pressable
                    onPress={() => handlePublishShift(shift.id)}
                    disabled={shift.status === 'Published'}
                    accessibilityRole="button"
                    accessibilityLabel={t('scheduler.roster.publishA11y')}
                    style={[
                      styles.actionChip,
                      shift.status === 'Published' && styles.disabledButton,
                      styles.actionChipPrimary,
                    ]}
                  >
                    <ThemedText style={styles.actionChipText}>{t('common.publish')}</ThemedText>
                  </Pressable>
                  <Pressable
                    onPress={() => handleUnpublishShift(shift.id)}
                    disabled={shift.status === 'Draft'}
                    accessibilityRole="button"
                    accessibilityLabel={t('scheduler.roster.unpublishA11y')}
                    style={[styles.actionChip, shift.status === 'Draft' && styles.disabledButton]}
                  >
                    <ThemedText style={styles.actionChipText}>{t('common.unpublish')}</ThemedText>
                  </Pressable>
                  <Pressable
                    onPress={() => handleNotifyShift(shift.id)}
                    disabled={shift.notified}
                    accessibilityRole="button"
                    accessibilityLabel={t('scheduler.roster.notifyA11y')}
                    style={[styles.actionChip, shift.notified && styles.disabledButton]}
                  >
                    <ThemedText style={styles.actionChipText}>
                      {shift.notified ? t('common.notified') : t('common.notify')}
                    </ThemedText>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        ))}
      </SectionCard>

      <SectionCard
        title={t('scheduler.roster.upcoming.title')}
        subtitle={t('scheduler.roster.upcoming.subtitle')}
      >
        {upcomingShifts.length === 0 ? (
          <ThemedText style={styles.mutedText}>
            {t('scheduler.roster.upcoming.empty')}
          </ThemedText>
        ) : null}
        {upcomingShifts.map((shift) => (
          <View key={shift.id} style={styles.rowBetween}>
            <View>
              <ThemedText type="defaultSemiBold">
                {shift.worker?.name ?? shift.workerId}
              </ThemedText>
              <ThemedText style={styles.mutedText}>
                {shift.template?.name ?? shift.templateId} • {shift.template?.start} -{' '}
                {shift.template?.end}
              </ThemedText>
            </View>
            <View style={styles.statusPill}>
              <ThemedText style={styles.badgeText}>
                {shift.status === 'Draft' ? t('common.draft') : t('common.published')}
              </ThemedText>
              <ThemedText style={styles.mutedText}>{shift.date}</ThemedText>
            </View>
          </View>
        ))}
      </SectionCard>

      <SectionCard
        title={t('scheduler.roster.gaps.title')}
        subtitle={t('scheduler.roster.gaps.subtitle')}
      >
        {staffingGaps.length === 0 ? (
          <ThemedText>{t('scheduler.roster.gaps.allCovered')}</ThemedText>
        ) : (
          staffingGaps.map((gap) => (
            <View key={`${gap.date}-${gap.role}`} style={styles.rowBetween}>
              <View>
                <ThemedText type="defaultSemiBold">{gap.role}</ThemedText>
                <ThemedText style={styles.mutedText}>{gap.date}</ThemedText>
              </View>
              <View style={styles.statusPill}>
                <ThemedText style={styles.badgeText}>
                  {t('scheduler.roster.gaps.scheduled', { n: String(gap.scheduled) })}
                </ThemedText>
                <ThemedText style={styles.mutedText}>
                  {t('scheduler.roster.gaps.shortfall', { n: String(gap.gap) })}
                </ThemedText>
              </View>
            </View>
          ))
        )}
      </SectionCard>
    </>
  );
};
