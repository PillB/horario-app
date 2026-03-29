/**
 * SchedulerScreen — orchestration layer only.
 *
 * State, effects, handlers, and derived values live in useSchedulerHandlers.
 * Sub-components live in components/scheduler/.
 * Styles live in scheduler.styles.ts.
 * Pure utils live in utils/schedulerUtils.ts and utils/schedulerValidators.ts.
 * Types live in types/scheduler.ts.
 */
import React from 'react';
import { ScrollView, View, Pressable } from 'react-native';

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
import { useSchedulerHandlers } from '@/hooks/useSchedulerHandlers';
import { schedulerStyles as styles } from '@/styles/scheduler.styles';
import { FREE_AUTO_ASSIGN_LIMIT } from '@/hooks/useUsageLimit';

export default function SchedulerScreen() {
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

    // Auto-assign state
    autoAssignSuggestions,
    autoAssignApplying,

    // Freemium
    usageCount,
  } = useSchedulerHandlers();

  return (
    <ErrorBoundary>
    <ThemedView style={styles.screenContainer}>
      <ConfettiBurst running={publishCelebration.confettiBurst} disabled={reduceMotionEnabled} />
      <ScrollView ref={scrollViewRef} contentContainerStyle={styles.container}>
        <ThemedText type="title" style={styles.pageTitle}>
          Scheduler
        </ThemedText>
        <ThemedText style={styles.mutedText}>
          Coordinate coverage across workers, shift templates, and day-by-day staffing plans.
        </ThemedText>

        <UpgradeBanner autoAssignUsesLeft={FREE_AUTO_ASSIGN_LIMIT - usageCount} />

        {actionBanner ? (
          <ThemedView
            style={[
              styles.banner,
              actionBanner.type === 'success' && styles.bannerSuccess,
              actionBanner.type === 'error' && styles.bannerError,
            ]}
          >
            <ThemedText style={styles.bannerText}>{actionBanner.message}</ThemedText>
          </ThemedView>
        ) : null}

        <Checklist steps={onboardingSteps} progress={onboardingProgress} />

        {needsFallbackSetup ? (
          <ThemedView style={[styles.banner, styles.bannerWarning, styles.dismissibleBanner]}>
            <View style={styles.bannerHeader}>
              <ThemedText style={styles.bannerText}>Missing data detected</ThemedText>
              <Pressable onPress={() => router.setParams({ section: 'forecast' })}>
                <ThemedText style={styles.linkText}>Open quick setup</ThemedText>
              </Pressable>
            </View>
            <ThemedText style={styles.mutedText}>
              We could not find historical shifts or external signals. Seed homogeneous demand or
              manual worker/shift counts to unlock forecasting.
            </ThemedText>
          </ThemedView>
        ) : null}

        <View
          ref={workerSectionRef}
          onLayout={(e) => setWorkerSectionOffset(e.nativeEvent.layout.y)}
        >
          <WorkerSection
            workers={workers}
            workerForm={workerForm}
            updateWorkerField={updateWorkerField}
            handleAddWorker={handleAddWorker}
            workerError={workerError}
            availabilityForm={availabilityForm}
            updateAvailabilityField={updateAvailabilityField}
            handleAvailabilitySubmit={handleAvailabilitySubmit}
            availabilitySuccessPromptVisible={availabilitySuccessPromptVisible}
            setAvailabilitySuccessPromptVisible={setAvailabilitySuccessPromptVisible}
            availabilityError={availabilityError}
            scrollToShiftSection={scrollToShiftSection}
            router={router}
          />
        </View>

        <View
          ref={templateSectionRef}
          onLayout={(e) => setTemplateSectionOffset(e.nativeEvent.layout.y)}
        >
          <ShiftTemplateSection
            shiftTemplates={shiftTemplates}
            templateForm={templateForm}
            updateTemplateField={updateTemplateField}
            handleAddTemplate={handleAddTemplate}
            templateError={templateError}
            shiftForm={shiftForm}
            updateShiftField={updateShiftField}
            handleShiftSubmit={handleShiftSubmit}
            shiftError={shiftError}
            handleAutoAssign={handleAutoAssign}
            applyAutoAssign={applyAutoAssign}
            autoAssignSuggestions={autoAssignSuggestions}
            autoAssignApplying={autoAssignApplying}
          />
        </View>

        <View
          ref={shiftSectionRef}
          onLayout={(e) => setShiftSectionOffset(e.nativeEvent.layout.y)}
        >
          {/* shiftSectionRef anchors scroll-to-shift-section */}
        </View>

        <View
          ref={demandSectionRef}
          onLayout={(e) => setDemandSectionOffset(e.nativeEvent.layout.y)}
        >
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
          />
        </View>

        <RosterSection
          publishCelebration={publishCelebration}
          rosterByDate={rosterByDate}
          handlePublishShift={handlePublishShift}
          handleUnpublishShift={handleUnpublishShift}
          handleNotifyShift={handleNotifyShift}
          upcomingShifts={upcomingShifts}
          staffingGaps={staffingGaps}
        />

        <WellnessPrompt
          visible={promptVisible}
          minutesActive={minutesActive}
          onDismiss={dismissPrompt}
          onTakeBreak={acknowledgeBreak}
        />
      </ScrollView>
    </ThemedView>
    </ErrorBoundary>
  );
}

// ── Re-exports for backward compatibility with existing tests ─────────────────
export { defaultTimezoneOffsetMinutes, getWeekdayFromDate } from '@/utils/schedulerUtils';
export { findCoveringAvailability } from '@/utils/schedulerValidators';
export type { Worker } from '@/types/scheduler';
export type { ShiftTemplate } from '@/utils/schedulerMetrics';
