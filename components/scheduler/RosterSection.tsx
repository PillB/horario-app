import React from 'react';
import { View, Pressable } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { type Shift, type ShiftTemplate } from '@/utils/schedulerMetrics';
import { type Worker } from '@/types/scheduler';
import { type DemandForecast } from '@/services/demandForecast';
import { SectionCard } from './SectionCard';
import { schedulerStyles as styles } from '@/styles/scheduler.styles';

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
}: Props) => (
  <>
    <SectionCard
      title="Calendar & roster"
      subtitle="Review what is published and where you have coverage gaps."
    >
      {publishCelebration.badgeVisible ? (
        <View style={[styles.badge, styles.positiveBadge, styles.securedBadge]}>
          <View style={styles.securedDot} />
          <ThemedText style={styles.badgeText}>Next 7 days secured.</ThemedText>
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
            <ThemedText style={styles.ghostEmptyCtaText}>Assign shifts to see your roster here ↑</ThemedText>
          </View>
          <ThemedText style={styles.ghostEmptyNote}>
            Create a shift in Shift Creation above — it appears here instantly.
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
                  {shift.status}
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
                  style={[
                    styles.actionChip,
                    shift.status === 'Published' && styles.disabledButton,
                    styles.actionChipPrimary,
                  ]}
                >
                  <ThemedText style={styles.actionChipText}>Publish</ThemedText>
                </Pressable>
                <Pressable
                  onPress={() => handleUnpublishShift(shift.id)}
                  disabled={shift.status === 'Draft'}
                  style={[styles.actionChip, shift.status === 'Draft' && styles.disabledButton]}
                >
                  <ThemedText style={styles.actionChipText}>Unpublish</ThemedText>
                </Pressable>
                <Pressable
                  onPress={() => handleNotifyShift(shift.id)}
                  disabled={shift.notified}
                  style={[styles.actionChip, shift.notified && styles.disabledButton]}
                >
                  <ThemedText style={styles.actionChipText}>
                    {shift.notified ? 'Notified' : 'Notify'}
                  </ThemedText>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      ))}
    </SectionCard>

    <SectionCard title="Upcoming shifts" subtitle="Stay ahead of the next roster window.">
      {upcomingShifts.length === 0 ? (
        <ThemedText style={styles.mutedText}>
          No published shifts yet — publish a shift above to see it here.
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
            <ThemedText style={styles.badgeText}>{shift.status}</ThemedText>
            <ThemedText style={styles.mutedText}>{shift.date}</ThemedText>
          </View>
        </View>
      ))}
    </SectionCard>

    <SectionCard
      title="Staffing gaps"
      subtitle="Highlight under-covered roles across the horizon."
    >
      {staffingGaps.length === 0 ? (
        <ThemedText>Coverage meets current demand targets.</ThemedText>
      ) : (
        staffingGaps.map((gap) => (
          <View key={`${gap.date}-${gap.role}`} style={styles.rowBetween}>
            <View>
              <ThemedText type="defaultSemiBold">{gap.role}</ThemedText>
              <ThemedText style={styles.mutedText}>{gap.date}</ThemedText>
            </View>
            <View style={styles.statusPill}>
              <ThemedText style={styles.badgeText}>{gap.scheduled} scheduled</ThemedText>
              <ThemedText style={styles.mutedText}>Shortfall: {gap.gap}</ThemedText>
            </View>
          </View>
        ))
      )}
    </SectionCard>
  </>
);
