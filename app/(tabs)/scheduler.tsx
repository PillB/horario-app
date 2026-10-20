/**
 * SchedulerScreen — orchestration layer only.
 *
 * State, effects, handlers, and derived values live in useSchedulerHandlers.
 * Sub-components live in components/scheduler/.
 * Styles live in scheduler.styles.ts.
 * Pure utils live in utils/schedulerUtils.ts and utils/schedulerValidators.ts.
 * Types live in types/scheduler.ts.
 */
import React, { useEffect, useRef } from 'react';
import { ScrollView, View, Pressable, Modal } from 'react-native';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import ConfettiBurst from '@/components/ConfettiBurst';
import { WellnessPrompt } from '@/components/WellnessPrompt';
import { Checklist } from '@/components/scheduler/Checklist';
import { WorkerSection } from '@/components/scheduler/WorkerSection';
import { ShiftTemplateSection } from '@/components/scheduler/ShiftTemplateSection';
import { DemandSection } from '@/components/scheduler/DemandSection';
import { RosterSection } from '@/components/scheduler/RosterSection';
import { UpgradeBanner } from '@/components/UpgradeBanner';
import { TimezoneBar } from '@/components/scheduler/TimezoneBar';
import { ShiftNotesPanel } from '@/components/scheduler/ShiftNotesPanel';
import { useSchedulerHandlers } from '@/hooks/useSchedulerHandlers';
import { makeSchedulerStyles } from '@/styles/scheduler.styles';
import { FREE_AUTO_ASSIGN_LIMIT } from '@/hooks/useUsageLimit';
import { useT } from '@/contexts/LocaleContext';
import { TourStep } from '@/components/TourStep';
import { useWelcomeTour } from '@/contexts/WelcomeTourContext';
import { Colors, brand } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';

export default function SchedulerScreen() {
  const { t } = useT();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const styles = makeSchedulerStyles(colors);

  const {
    // Data
    workers,
    shiftTemplates,
    roster,
    demandTargets,
    forecastError,
    needsFallbackSetup,

    // Wellness
    acknowledgeBreak,
    dismissPrompt,
    minutesActive,
    promptVisible,

    // Refs
    scrollViewRef,
    workerSectionRef,
    shiftSectionRef,
    templateSectionRef,
    demandSectionRef,
    baselineTargetsRef,

    // Layout setters
    setWorkerSectionOffset,
    setShiftSectionOffset,
    setTemplateSectionOffset,
    setDemandSectionOffset,

    // UI state
    actionBanner,
    publishCelebration,
    reduceMotionEnabled,
    availabilitySuccessPromptVisible,
    setAvailabilitySuccessPromptVisible,
    availabilityError,
    shiftError,
    targetError,
    fallbackError,
    fallbackMessage,
    workerError,
    templateError,
    workerSuccessMessage,
    templateSuccessMessage,

    // Form state
    availabilityForm,
    shiftForm,
    targetForm,
    fallbackForm,
    fallbackMode,
    setFallbackMode,
    workerForm,
    templateForm,

    // Form change handlers
    updateAvailabilityField,
    updateShiftField,
    updateTargetField,
    updateFallbackField,
    updateWorkerField,
    updateTemplateField,

    // Derived
    rosterByDate,
    upcomingShifts,
    staffingGaps,
    onboardingSteps,
    onboardingProgress,

    // Forecast UI
    forecastButtonLabel,
    forecastHelperText,
    forecastActionDisabled,

    // Navigation
    scrollToShiftSection,
    router,

    // Handlers
    handleAddWorker,
    handleAddTemplate,
    handleAvailabilitySubmit,
    handleShiftSubmit,
    handleTargetSubmit,
    handleFallbackSubmit,
    handlePublishShift,
    handleUnpublishShift,
    handleNotifyShift,
    runForecast,
    handleAutoAssign,
    applyAutoAssign,
    handlePosTargetsGenerated,

    // Auto-assign state
    autoAssignSuggestions,
    autoAssignShortfalls,
    autoAssignApplying,

    // Freemium
    usageCount,

    // Tour
    seedTourData,
  } = useSchedulerHandlers();

  // ── Seed sample data when tour completes for the first time ─────────────
  const { hasCompleted } = useWelcomeTour();
  const seededRef = useRef(false);
  useEffect(() => {
    if (hasCompleted && !seededRef.current && workers.length === 0) {
      seededRef.current = true;
      seedTourData();
    }
  }, [hasCompleted, workers.length, seedTourData]);

  const [selectedShiftForNotes, setSelectedShiftForNotes] = React.useState<{
    shiftId: string;
    workerName: string;
    templateName: string;
    date: string;
  } | null>(null);

  // ── Jump-to-calendar button ────────────────────────────────────────────────
  const rosterSectionOffsetRef = useRef<number>(0);
  const handleScrollToCalendar = React.useCallback(() => {
    if (scrollViewRef.current) {
      (scrollViewRef.current as unknown as { scrollTo: (opts: { y: number; animated: boolean }) => void }).scrollTo({
        y: rosterSectionOffsetRef.current,
        animated: true,
      });
    }
  }, [scrollViewRef]);

  // [Finding 2] linkText must meet AA on warningSurface:
  //   light: brand.primaryDeep (#115E59, 5.87:1 on white/warm surface)
  //   dark:  Colors.dark.tint (#2DD4BF, 8.95:1 on dark amber surface)
  const linkTextColor =
    colorScheme === 'dark' ? Colors.dark.tint : brand.primaryDeep;

  // [Finding 3] Banner text colours derived from theme-aware semantic tokens
  //   success: Colors[scheme].success on Colors[scheme].successSurface
  //   error:   Colors[scheme].error   on Colors[scheme].errorSurface
  const bannerSuccessTextColor = colors.success;
  const bannerErrorTextColor = colors.error;

  const handleSelectShiftForNotes = React.useCallback(
    (shift: { id: string; worker?: { name: string }; workerId: string; template?: { name: string }; templateId: string; date: string }) => {
      setSelectedShiftForNotes({
        shiftId: shift.id,
        workerName: shift.worker?.name ?? shift.workerId,
        templateName: shift.template?.name ?? shift.templateId,
        date: shift.date,
      });
    },
    []
  );

  return (
    <ErrorBoundary>
    <ThemedView style={styles.screenContainer}>
      <ConfettiBurst running={publishCelebration.confettiBurst} disabled={reduceMotionEnabled} />
      <ScrollView ref={scrollViewRef} contentContainerStyle={styles.container}>
        <TimezoneBar />
        {/* [Finding 6] pageTitle contrast confirmed AAA — no change needed */}
        <ThemedText type="title" style={styles.pageTitle}>
          {t('scheduler.title')}
        </ThemedText>
        {/* [Finding 7] subtitle uses textSecondary (6.86:1) instead of textTertiary (4.35:1) */}
        <ThemedText style={[styles.mutedText, { color: colors.textSecondary }]}>
          {t('scheduler.subtitle')}
        </ThemedText>

        {/* Quick-jump to calendar — helps users who want to see the roster first */}
        <Pressable
          onPress={handleScrollToCalendar}
          accessibilityRole="button"
          accessibilityLabel={t('scheduler.jumpToCalendar')}
          style={({ pressed }) => [styles.jumpCalendarBtn, pressed && { opacity: 0.7 }]}
        >
          <ThemedText style={styles.jumpCalendarText}>{t('scheduler.jumpToCalendar')}</ThemedText>
        </Pressable>

        <UpgradeBanner autoAssignUsesLeft={FREE_AUTO_ASSIGN_LIMIT - usageCount} />

        {actionBanner ? (
          <ThemedView
            style={[
              styles.banner,
              actionBanner.type === 'success' && styles.bannerSuccess,
              actionBanner.type === 'error' && styles.bannerError,
            ]}
          >
            {/* [Finding 3] Use semantic text colours for success/error banners */}
            <ThemedText
              style={[
                styles.bannerText,
                actionBanner.type === 'success' && { color: bannerSuccessTextColor },
                actionBanner.type === 'error' && { color: bannerErrorTextColor },
              ]}
            >
              {actionBanner.message}
            </ThemedText>
          </ThemedView>
        ) : null}

        <Checklist steps={onboardingSteps} progress={onboardingProgress} />

        {needsFallbackSetup ? (
          <ThemedView style={[styles.banner, styles.bannerWarning, styles.dismissibleBanner]}>
            <View style={styles.bannerHeader}>
              <ThemedText style={styles.bannerText}>{t('scheduler.missingData.title')}</ThemedText>
              {/* [Finding 5] Accessible dismiss close button */}
              <Pressable
                onPress={() => router.setParams({ section: undefined })}
                accessibilityLabel={t('common.dismiss')}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.dismissButton,
                  pressed && { opacity: 0.7 },
                ]}
              >
                <ThemedText style={{ color: colors.textSecondary, fontSize: 18, lineHeight: 22 }}>
                  {'×'}
                </ThemedText>
              </Pressable>
            </View>
            {/* [Finding 4] Pressable for openSetup with pressed visual state */}
            <Pressable
              onPress={() => router.setParams({ section: 'forecast' })}
              accessibilityRole="link"
              style={({ pressed }) => [
                pressed && { opacity: 0.7 },
              ]}
            >
              {/* [Finding 2] linkText uses brand.primaryDeep / dark tint for AA contrast */}
              <ThemedText style={[styles.linkText, { color: linkTextColor }]}>
                {t('scheduler.missingData.openSetup')}
              </ThemedText>
            </Pressable>
            {/* [Finding 1] description copy uses textSecondary for AA on warm amber surface */}
            <ThemedText style={[styles.mutedText, { color: colors.textSecondary }]}>
              {t('scheduler.missingData.desc')}
            </ThemedText>
          </ThemedView>
        ) : null}

        <View
          ref={workerSectionRef}
          onLayout={(e) => setWorkerSectionOffset(e.nativeEvent.layout.y)}
        >
          <TourStep target="workers-section">
          <WorkerSection
            workers={workers}
            workerForm={workerForm}
            updateWorkerField={updateWorkerField}
            handleAddWorker={handleAddWorker}
            workerError={workerError}
            workerSuccessMessage={workerSuccessMessage}
            availabilityForm={availabilityForm}
            updateAvailabilityField={updateAvailabilityField}
            handleAvailabilitySubmit={handleAvailabilitySubmit}
            availabilitySuccessPromptVisible={availabilitySuccessPromptVisible}
            setAvailabilitySuccessPromptVisible={setAvailabilitySuccessPromptVisible}
            availabilityError={availabilityError}
            scrollToShiftSection={scrollToShiftSection}
            router={router}
          />
          </TourStep>
        </View>

        <View
          ref={demandSectionRef}
          onLayout={(e) => setDemandSectionOffset(e.nativeEvent.layout.y)}
        >
          <TourStep target="demand-section">
          <DemandSection
            fallbackMode={fallbackMode}
            setFallbackMode={setFallbackMode}
            fallbackForm={fallbackForm}
            updateFallbackField={updateFallbackField}
            handleFallbackSubmit={handleFallbackSubmit}
            fallbackError={fallbackError}
            fallbackMessage={fallbackMessage}
            targetForm={targetForm}
            updateTargetField={updateTargetField}
            handleTargetSubmit={handleTargetSubmit}
            targetError={targetError}
            forecastButtonLabel={forecastButtonLabel}
            forecastHelperText={forecastHelperText}
            forecastActionDisabled={forecastActionDisabled}
            runForecast={runForecast}
            baselineTargetsRef={baselineTargetsRef}
            demandTargets={demandTargets}
            roster={roster}
            shiftTemplates={shiftTemplates}
            forecastError={forecastError}
            onBulkSave={handlePosTargetsGenerated}
          />
          </TourStep>
        </View>

        <View
          ref={shiftSectionRef}
          onLayout={(e) => setShiftSectionOffset(e.nativeEvent.layout.y)}
        >
          {/* shiftSectionRef anchors scroll-to-shift-section */}
        </View>

        <View
          ref={templateSectionRef}
          onLayout={(e) => setTemplateSectionOffset(e.nativeEvent.layout.y)}
        >
          <TourStep target="shift-templates-section">
          <ShiftTemplateSection
            shiftTemplates={shiftTemplates}
            templateForm={templateForm}
            updateTemplateField={updateTemplateField}
            handleAddTemplate={handleAddTemplate}
            templateError={templateError}
            templateSuccessMessage={templateSuccessMessage}
            shiftForm={shiftForm}
            updateShiftField={updateShiftField}
            handleShiftSubmit={handleShiftSubmit}
            shiftError={shiftError}
            handleAutoAssign={handleAutoAssign}
            applyAutoAssign={applyAutoAssign}
            autoAssignSuggestions={autoAssignSuggestions}
            autoAssignShortfalls={autoAssignShortfalls}
            autoAssignApplying={autoAssignApplying}
            workers={workers}
          />
          </TourStep>
        </View>

        <TourStep target="roster-section">
        <View
          onLayout={(e) => { rosterSectionOffsetRef.current = e.nativeEvent.layout.y; }}
        >
        <RosterSection
          publishCelebration={publishCelebration}
          rosterByDate={rosterByDate}
          handlePublishShift={handlePublishShift}
          handleUnpublishShift={handleUnpublishShift}
          handleNotifyShift={handleNotifyShift}
          upcomingShifts={upcomingShifts}
          staffingGaps={staffingGaps}
          onSelectShiftForNotes={handleSelectShiftForNotes}
        />
        </View>
        </TourStep>

        <WellnessPrompt
          visible={promptVisible}
          minutesActive={minutesActive}
          onDismiss={dismissPrompt}
          onTakeBreak={acknowledgeBreak}
        />
      </ScrollView>
      <Modal
        visible={selectedShiftForNotes !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSelectedShiftForNotes(null)}
      >
        {selectedShiftForNotes ? (
          <ShiftNotesPanel
            shiftId={selectedShiftForNotes.shiftId}
            workerName={selectedShiftForNotes.workerName}
            templateName={selectedShiftForNotes.templateName}
            date={selectedShiftForNotes.date}
            onClose={() => setSelectedShiftForNotes(null)}
          />
        ) : null}
      </Modal>
    </ThemedView>
    </ErrorBoundary>
  );
}

// ── Re-exports for backward compatibility with existing tests ─────────────────
export { defaultTimezoneOffsetMinutes, getWeekdayFromDate } from '@/utils/schedulerUtils';
export { findCoveringAvailability } from '@/utils/schedulerValidators';
export type { Worker } from '@/types/scheduler';
export type { ShiftTemplate } from '@/utils/schedulerMetrics';