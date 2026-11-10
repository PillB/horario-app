/**
 * SchedulerScreen — orchestration layer only.
 *
 * State, effects, handlers, and derived values live in useSchedulerHandlers.
 * Sub-components live in components/scheduler/.
 * Styles live in scheduler.styles.ts.
 * Pure utils live in utils/schedulerUtils.ts and utils/schedulerValidators.ts.
 * Types live in types/scheduler.ts.
 */
import React, { useEffect } from 'react';
import { ScrollView, View, Modal } from 'react-native';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import ConfettiBurst from '@/components/ConfettiBurst';
import { WellnessPrompt } from '@/components/WellnessPrompt';
import { WorkerSection } from '@/components/scheduler/WorkerSection';
import { ShiftTemplateSection } from '@/components/scheduler/ShiftTemplateSection';
import { DemandSection } from '@/components/scheduler/DemandSection';
import { RosterSection } from '@/components/scheduler/RosterSection';
import { UpgradeBanner } from '@/components/UpgradeBanner';
import { TimezoneBar } from '@/components/scheduler/TimezoneBar';
import { ShiftNotesPanel } from '@/components/scheduler/ShiftNotesPanel';
import { SyncNotice } from '@/components/scheduler/SyncNotice';
import { SectionNav } from '@/components/scheduler/SectionNav';
import { PlaybookLibrary } from '@/components/scheduler/PlaybookLibrary';
import { AdvancedControls } from '@/components/scheduler/AdvancedControls';
import PosUploadSection from '@/components/scheduler/PosUploadSection';
import { ForecastEnhancementsCard } from '@/components/scheduler/ForecastEnhancementsCard';
import { SyncStatusBar } from '@/components/SyncStatusBar';
import { TeamTools } from '@/components/scheduler/TeamTools';
import { ShiftMessagesPanel } from '@/components/scheduler/ShiftMessagesPanel';
import { usePosData } from '@/hooks/usePosData';
import { useActivationMilestone } from '@/hooks/useActivationMilestone';
import { useTimeToSchedule } from '@/hooks/useTimeToSchedule';
import { useSchedulerHandlers } from '@/hooks/useSchedulerHandlers';
import { makeSchedulerStyles } from '@/styles/scheduler.styles';
import { FREE_AUTO_ASSIGN_LIMIT } from '@/hooks/useUsageLimit';
import { useT } from '@/contexts/LocaleContext';
import { TourStep } from '@/components/TourStep';
import { useWelcomeTour } from '@/contexts/WelcomeTourContext';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';

import { PageTitle } from '@/components/PageTitle';

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
    workersLoaded,
    templatesLoaded,
    rosterLoaded,
    syncStatus,
    retrySync,
    lastSyncedAt,
    handleConstraintsChange,
    handleImportPlaybookTemplate,
    accountId,
    forecastError,
    forecastModels,
    forecastNotices,

    // Wellness
    acknowledgeBreak,
    dismissPrompt,
    minutesActive,
    promptVisible,

    // Refs
    scrollViewRef,
    baselineTargetsRef,

    // Active step
    activeSection,
    goToSection,

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
    scheduleLocations,
    upcomingShifts,
    staffingGaps,

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
    handleRemoveWorker,
    handleRemoveAvailability,
    handleRemoveTemplate,
    handleRemoveShift,
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

  // ── Seed sample data right after the user finishes a guide ─────────────
  // Only once the stored workers have loaded (CHG-088), only into an account
  // with none, and only for a guide finished just now: skipping the guide, a
  // completion restored from storage or a later visit to an account whose
  // workers were all removed must not write sample rows (QA 2026-10-28).
  const { sampleDataOffered, takeSampleDataOffer } = useWelcomeTour();
  // First-schedule milestone and time-to-schedule, measured on this device:
  // the target is defined once a template exists, reached on the first publish.
  const { activationState, markTargetDefined, markActivationReached, showSuccessFeedback, dismissSuccessFeedback } =
    useActivationMilestone();
  const { startSession, markSchedulePublished } = useTimeToSchedule();
  const publishedCount = roster.filter((shift) => shift.status === 'Published').length;
  const publishedSeenRef = React.useRef<number | null>(null);
  // The message is for the visit in which the first publish happened, not every later visit.
  const [activatedThisVisit, setActivatedThisVisit] = React.useState(false);
  useEffect(() => { startSession(); }, [startSession]);
  useEffect(() => {
    if (templatesLoaded && shiftTemplates.length > 0) void markTargetDefined();
  }, [templatesLoaded, shiftTemplates.length, markTargetDefined]);
  useEffect(() => {
    if (!rosterLoaded) return;
    const seen = publishedSeenRef.current;
    publishedSeenRef.current = publishedCount;
    // Only a publish made in this visit counts, not shifts that were already published.
    if (seen !== null && publishedCount > seen) {
      if (!activationState.activation_reached) setActivatedThisVisit(true);
      void markActivationReached();
      void markSchedulePublished();
    }
  }, [rosterLoaded, publishedCount, activationState.activation_reached, markActivationReached, markSchedulePublished]);

  // Uploaded sales history, for the forecast adjustments card on the demand step.
  const { sales: posSales, refresh: refreshPosSales } = usePosData(accountId);
  useEffect(() => {
    if (!sampleDataOffered || !workersLoaded) return;
    if (!takeSampleDataOffer()) return;
    if (workers.length === 0) seedTourData();
  }, [sampleDataOffered, takeSampleDataOffer, workersLoaded, workers.length, seedTourData]);

  const [selectedShiftForNotes, setSelectedShiftForNotes] = React.useState<{
    shiftId: string;
    workerName: string;
    templateName: string;
    date: string;
  } | null>(null);

  // Role and hours of the shift whose notes are open, for its messages.
  const selectedShiftMessageContext = React.useMemo(() => {
    if (!selectedShiftForNotes) return null;
    const shift = roster.find((entry) => entry.id === selectedShiftForNotes.shiftId);
    const template = shift ? shiftTemplates.find((tpl) => tpl.id === shift.templateId) : undefined;
    if (!shift || !template) return null;
    return { date: shift.date, role: template.role, startTime: template.start, endTime: template.end };
  }, [roster, selectedShiftForNotes, shiftTemplates]);

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

  const assignPanel = (
        <View>
          <TourStep target="shift-assign-section">
          <ShiftTemplateSection
            part="assign"
            shiftTemplates={shiftTemplates}
            templatesLoaded={templatesLoaded}
            onRemoveTemplate={handleRemoveTemplate}
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
  );

  const rosterPanel = (
        <TourStep target="roster-section">
        <View>
        <RosterSection
          publishCelebration={publishCelebration}
          rosterByDate={rosterByDate}
          scheduleLocations={scheduleLocations}
          handlePublishShift={handlePublishShift}
          handleUnpublishShift={handleUnpublishShift}
          handleNotifyShift={handleNotifyShift}
          onRemoveShift={handleRemoveShift}
          rosterLoaded={rosterLoaded}
          upcomingShifts={upcomingShifts}
          staffingGaps={staffingGaps}
          onSelectShiftForNotes={handleSelectShiftForNotes}
        />
        </View>
        </TourStep>
  );

  return (
    <ErrorBoundary>
    <PageTitle title={t('nav.scheduler')} />
    <ThemedView style={styles.screenContainer}>
      <ConfettiBurst running={publishCelebration.confettiBurst} disabled={reduceMotionEnabled} />
      <TimezoneBar />
      <TourStep target="scheduler-sections">
      <SectionNav
        active={activeSection}
        onSelect={goToSection}
        done={{
          workers: workers.length > 0,
          templates: shiftTemplates.length > 0,
          forecast: demandTargets.length > 0,
          shifts: roster.length > 0,
        }}
        counts={{ workers: workers.length, templates: shiftTemplates.length, shifts: roster.length }}
      />
      </TourStep>
      <SyncStatusBar
        status={syncStatus.loading ? 'saving' : syncStatus.errors.length === 0 && lastSyncedAt ? 'saved' : 'idle'}
        lastSyncedAt={lastSyncedAt}
        onRetry={retrySync}
      />
      <ScrollView ref={scrollViewRef} contentContainerStyle={styles.container}>
        {/* The paid-plan prompt sits where auto-assign is used. */}
        {activeSection === 'shifts' ? (
          <UpgradeBanner autoAssignUsesLeft={FREE_AUTO_ASSIGN_LIMIT - usageCount} />
        ) : null}

        <SyncNotice
          loading={syncStatus.loading}
          errors={syncStatus.errors}
          truncated={syncStatus.truncated}
          onRetry={retrySync}
        />

        {showSuccessFeedback && activatedThisVisit ? (
          <ThemedView style={[styles.banner, styles.bannerSuccess]} accessibilityLiveRegion="polite" testID="activation-banner">
            <ThemedText style={[styles.bannerText, { color: bannerSuccessTextColor }]}>
              {activationState.time_to_activation_ms !== null
                ? t('scheduler.activation.reachedIn', { n: String(Math.max(1, Math.round(activationState.time_to_activation_ms / 60000))) })
                : t('scheduler.activation.reached')}
            </ThemedText>
            <ThemedText
              onPress={dismissSuccessFeedback}
              accessibilityRole="button"
              accessibilityLabel={t('common.dismiss')}
              accessibilityHint={t('scheduler.activation.dismissHint')}
              style={styles.linkText}
            >
              {t('common.dismiss')}
            </ThemedText>
          </ThemedView>
        ) : null}

        {actionBanner ? (
          <ThemedView
            style={[
              styles.banner,
              actionBanner.type === 'success' && styles.bannerSuccess,
              actionBanner.type === 'error' && styles.bannerError,
            ]}
            accessibilityRole={actionBanner.type === 'error' ? 'alert' : undefined}
            accessibilityLiveRegion={actionBanner.type === 'error' ? 'assertive' : 'polite'}
            testID="scheduler-action-banner"
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

        {activeSection === 'workers' ? (
        <View>
          <TourStep target="workers-section">
          <WorkerSection
            workers={workers}
            workersLoaded={workersLoaded}
            onRemoveWorker={handleRemoveWorker}
            onRemoveAvailability={handleRemoveAvailability}
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
          <ErrorBoundary>
            <TeamTools accountId={accountId} workers={workers} onImported={retrySync} />
          </ErrorBoundary>
        </View>
        ) : null}

        {activeSection === 'forecast' ? (
        <View>
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
            forecastModels={forecastModels}
            forecastNotices={forecastNotices}
            onBulkSave={handlePosTargetsGenerated}
          />
          </TourStep>
          <ErrorBoundary>
            <PosUploadSection accountId={accountId} onUploadComplete={() => { void refreshPosSales(); }} />
          </ErrorBoundary>
          {posSales.length > 0 ? (
            <ErrorBoundary>
              <ForecastEnhancementsCard
                sales={posSales}
                baseForecast={demandTargets}
                roster={roster}
                shiftTemplates={shiftTemplates}
              />
            </ErrorBoundary>
          ) : null}
        </View>
        ) : null}

        {activeSection === 'templates' ? (
        <View>
          <TourStep target="shift-templates-section">
          <ShiftTemplateSection
            part="templates"
            shiftTemplates={shiftTemplates}
            templatesLoaded={templatesLoaded}
            onRemoveTemplate={handleRemoveTemplate}
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
          <ErrorBoundary>
            <PlaybookLibrary onImportTemplate={(tpl) => { void handleImportPlaybookTemplate(tpl); }} />
          </ErrorBoundary>
        </View>
        ) : null}

        {/* With shifts on the roster it comes first; an empty roster starts with the form. */}
        {activeSection === 'shifts' ? (
          <>
            {roster.length > 0 ? <>{rosterPanel}{assignPanel}</> : <>{assignPanel}{rosterPanel}</>}
            {/* Business limits for auto-assign; the stricter of these and the law applies. */}
            <ErrorBoundary>
              <AdvancedControls onConstraintsChange={handleConstraintsChange} />
            </ErrorBoundary>
          </>
        ) : null}

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
          <View style={styles.notesModalBody}>
          <ShiftNotesPanel
            shiftId={selectedShiftForNotes.shiftId}
            workerName={selectedShiftForNotes.workerName}
            templateName={selectedShiftForNotes.templateName}
            date={selectedShiftForNotes.date}
            onClose={() => setSelectedShiftForNotes(null)}
          />
          {selectedShiftMessageContext ? (
            <ScrollView style={styles.notesModalMessages}>
              <ErrorBoundary>
                <ShiftMessagesPanel shiftId={selectedShiftForNotes.shiftId} {...selectedShiftMessageContext} />
              </ErrorBoundary>
            </ScrollView>
          ) : null}
          </View>
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