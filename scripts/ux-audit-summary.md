# Horario App — UX/Accessibility Audit Report
**Batch ID:** `msgbatch_019MKsWaUFiudhWueSZxp1y3`
**Date:** 2026-03-30
**Model:** claude-sonnet-4-6 (Batch API — 50% off)
**Files audited:** 30

---

## Summary

| Severity | Count |
|----------|-------|
| 🔴 HIGH  | 91 |
| 🟡 MEDIUM | 136 |
| 🟢 LOW   | 91 |
| **Total** | **318** |

## Findings by Category

| Category | Count |
|----------|-------|
| ACCESSIBILITY | 107 |
| PERFORMANCE | 73 |
| I18N_GAPS | 43 |
| BUTTON_CONSISTENCY | 36 |
| KEYBOARD | 32 |
| EMPTY_STATES | 16 |
| TOOLTIP_COPY | 11 |

---

## Files by Issue Density

| File | HIGH | MED | LOW | Total |
|------|------|-----|-----|-------|
| `components/scheduler/DemandSection.tsx` | 7 | 6 | 4 | 17 |
| `components/scheduler/ShiftTemplateSection.tsx` | 5 | 8 | 5 | 18 |
| `components/scheduler/RosterSection.tsx` | 5 | 7 | 4 | 16 |
| `app/(tabs)/_layout.tsx` | 4 | 5 | 3 | 12 |
| `components/ProfileAchievements.tsx` | 4 | 4 | 3 | 11 |
| `app/(tabs)/index.tsx` | 4 | 6 | 5 | 15 |
| `app/(tabs)/scheduler.tsx` | 4 | 6 | 4 | 14 |
| `app/(tabs)/explore.tsx` | 4 | 7 | 5 | 16 |
| `components/InfoTooltip.tsx` | 4 | 5 | 4 | 13 |
| `components/StreakCounter.tsx` | 4 | 5 | 3 | 12 |
| `components/LanguageSelector.tsx` | 4 | 5 | 4 | 13 |
| `components/scheduler/WorkerSection.tsx` | 4 | 6 | 4 | 14 |
| `components/scheduler/Checklist.tsx` | 4 | 4 | 3 | 11 |
| `components/WellnessPrompt.tsx` | 3 | 4 | 3 | 10 |
| `components/PersonalizedFeed.tsx` | 3 | 4 | 3 | 10 |

---

## 🔴 HIGH Severity Findings

### DS-001 — `ACCESSIBILITY`
**File:** `components/scheduler/DemandSection.tsx` · **Line:** 101

Homogeneous mode toggle Pressable has no accessibilityRole, accessibilityLabel, or accessibilityHint.

- **Current:** `<Pressable onPress={() => setFallbackMode('homogeneous')} style={...}>`
- **Fix:** Add accessibilityRole="radio" accessibilityLabel={t('scheduler.demand.homogeneous')} accessibilityState={{ checked: fallbackMode === 'homogeneous' }} accessibilityHint={t('scheduler.demand.homogeneousHint')}

---

### DS-002 — `ACCESSIBILITY`
**File:** `components/scheduler/DemandSection.tsx` · **Line:** 111

Manual counts mode toggle Pressable has no accessibilityRole, accessibilityLabel, or accessibilityHint.

- **Current:** `<Pressable onPress={() => setFallbackMode('manual')} style={...}>`
- **Fix:** Add accessibilityRole="radio" accessibilityLabel={t('scheduler.demand.manualCounts')} accessibilityState={{ checked: fallbackMode === 'manual' }} accessibilityHint={t('scheduler.demand.manualCountsHint')}

---

### DS-003 — `ACCESSIBILITY`
**File:** `components/scheduler/DemandSection.tsx` · **Line:** 171

Save Baseline Pressable is missing accessibilityRole and accessibilityHint.

- **Current:** `<Pressable onPress={handleFallbackSubmit} style={[styles.secondaryButton, styles.tightButton]}>`
- **Fix:** Add accessibilityRole="button" accessibilityLabel={t('scheduler.demand.saveBaseline')} accessibilityHint={t('scheduler.demand.saveBaselineHint')}

---

### DS-004 — `ACCESSIBILITY`
**File:** `components/scheduler/DemandSection.tsx` · **Line:** 207

Save Target Pressable is missing accessibilityRole and accessibilityHint.

- **Current:** `<Pressable onPress={handleTargetSubmit} style={styles.primaryButton}>`
- **Fix:** Add accessibilityRole="button" accessibilityLabel={t('scheduler.demand.saveTarget')} accessibilityHint={t('scheduler.demand.saveTargetHint')}

---

### DS-005 — `ACCESSIBILITY`
**File:** `components/scheduler/DemandSection.tsx` · **Line:** 214

Forecast action Pressable is missing accessibilityRole, accessibilityHint, and does not expose disabled state via accessibilityState.

- **Current:** `<Pressable accessibilityLabel={forecastButtonLabel} onPress={() => { if (!forecastActionDisabled) runForecast(); }} ...>`
- **Fix:** Add accessibilityRole="button" accessibilityState={{ disabled: forecastActionDisabled }} accessibilityHint={t('scheduler.demand.runForecastHint')} and use the disabled prop instead of guarding inside onPress.

---

### DS-006 — `ACCESSIBILITY`
**File:** `components/scheduler/DemandSection.tsx` · **Line:** 176

Inline error and success messages are not announced to screen readers when they appear.

- **Current:** `{fallbackError ? <ThemedText style={styles.errorText}>{fallbackError}</ThemedText> : null}`
- **Fix:** Wrap error/success ThemedText in a View with accessibilityLiveRegion="polite" (or 'assertive' for errors) so VoiceOver/TalkBack announces the message automatically.

---

### DS-007 — `ACCESSIBILITY`
**File:** `components/scheduler/DemandSection.tsx` · **Line:** 233

demandTargets list items have no accessibilityRole, making the list structure invisible to screen readers.

- **Current:** `<View key={...} style={styles.rowBetween}>`
- **Fix:** Add accessibilityRole="listitem" to each row View and wrap the entire map output in a View with accessibilityRole="list".

---

### DS-013 — `EMPTY_STATES`
**File:** `components/scheduler/DemandSection.tsx` · **Line:** 233

When demandTargets is an empty array the list renders nothing with no empty-state message or CTA to guide the user.

- **Current:** `{demandTargets.map((target) => ( ... ))}`
- **Fix:** Add a conditional: if demandTargets.length === 0, render a ThemedText empty-state message such as t('scheduler.demand.noTargets') plus a CTA linking to the add-target form.

---

### STS-001 — `ACCESSIBILITY`
**File:** `components/scheduler/ShiftTemplateSection.tsx` · **Line:** 163

The 'Save Shift' Pressable is missing accessibilityRole='button', leaving screen readers without semantic context.

- **Current:** `<Pressable accessibilityLabel={t('scheduler.shifts.saveButtonA11y')} onPress={handleShiftSubmit} ...>`
- **Fix:** Add accessibilityRole="button" to the Pressable element.

---

### STS-002 — `ACCESSIBILITY`
**File:** `components/scheduler/ShiftTemplateSection.tsx` · **Line:** 170

The 'Auto-Assign' Pressable is missing accessibilityRole='button', leaving screen readers without semantic context.

- **Current:** `<Pressable accessibilityLabel={t('scheduler.shifts.autoAssignA11y')} onPress={handleAutoAssign} ...>`
- **Fix:** Add accessibilityRole="button" to the Pressable element.

---

### STS-003 — `ACCESSIBILITY`
**File:** `components/scheduler/ShiftTemplateSection.tsx` · **Line:** 196

The 'Apply Auto-Assign' Pressable is missing accessibilityRole='button' and accessibilityHint, and does not communicate its disabled state via accessibilityState.

- **Current:** `<Pressable accessibilityLabel={t('scheduler.shifts.applyButton')} onPress={applyAutoAssign} disabled={autoAssignApplying`
- **Fix:** Add accessibilityRole="button", an accessibilityHint, and accessibilityState={{ disabled: autoAssignApplying }} to the Pressable.

---

### STS-004 — `ACCESSIBILITY`
**File:** `components/scheduler/ShiftTemplateSection.tsx` · **Line:** 87

templateError is rendered as plain ThemedText with no accessibilityRole='alert', so screen readers will not announce it automatically when it appears.

- **Current:** `{templateError ? <ThemedText style={styles.errorText}>{templateError}</ThemedText> : null}`
- **Fix:** Wrap or replace with <ThemedText accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.errorText}>{templateError}</ThemedText>.

---

### STS-005 — `ACCESSIBILITY`
**File:** `components/scheduler/ShiftTemplateSection.tsx` · **Line:** 178

shiftError is rendered as plain ThemedText with no accessibilityRole='alert', so screen readers will not announce it automatically when it appears.

- **Current:** `{shiftError ? <ThemedText style={styles.errorText}>{shiftError}</ThemedText> : null}`
- **Fix:** Add accessibilityRole="alert" and accessibilityLiveRegion="assertive" to the ThemedText rendering shiftError.

---

### RS-001 — `ACCESSIBILITY`
**File:** `components/scheduler/RosterSection.tsx` · **Line:** 91

Publish Pressable has a static accessibilityLabel that does not include the shift identity, making it indistinguishable from sibling publish buttons for screen-reader users.

- **Current:** `accessibilityLabel={t('scheduler.roster.publishA11y')}`
- **Fix:** accessibilityLabel={t('scheduler.roster.publishA11y', { worker: shift.worker?.name ?? shift.workerId, date })} — e.g. 'Publish shift for Alice on 2025-06-10'

---

### RS-002 — `ACCESSIBILITY`
**File:** `components/scheduler/RosterSection.tsx` · **Line:** 100

Unpublish Pressable has a static accessibilityLabel that does not identify which shift is being unpublished.

- **Current:** `accessibilityLabel={t('scheduler.roster.unpublishA11y')}`
- **Fix:** accessibilityLabel={t('scheduler.roster.unpublishA11y', { worker: shift.worker?.name ?? shift.workerId, date })} — e.g. 'Unpublish shift for Alice on 2025-06-10'

---

### RS-003 — `ACCESSIBILITY`
**File:** `components/scheduler/RosterSection.tsx` · **Line:** 108

Notify Pressable has a static accessibilityLabel that does not identify which shift or worker is being notified.

- **Current:** `accessibilityLabel={t('scheduler.roster.notifyA11y')}`
- **Fix:** accessibilityLabel={t('scheduler.roster.notifyA11y', { worker: shift.worker?.name ?? shift.workerId, date })} — e.g. 'Notify Alice about shift on 2025-06-10'

---

### RS-004 — `ACCESSIBILITY`
**File:** `components/scheduler/RosterSection.tsx` · **Line:** 88

All three Pressables are missing accessibilityHint, leaving screen-reader users without context about the action's effect.

- **Current:** `n/a`
- **Fix:** Add accessibilityHint to each: e.g. publish → 'Makes this shift visible to the assigned worker'; unpublish → 'Reverts shift to draft and hides it from the worker'; notify → 'Sends a push notification to the assigned worker'

---

### RS-005 — `ACCESSIBILITY`
**File:** `components/scheduler/RosterSection.tsx` · **Line:** 88

Disabled Pressables do not set accessibilityState={{ disabled: true }}, so assistive technologies cannot announce them as disabled.

- **Current:** `disabled={shift.status === 'Published'}`
- **Fix:** Add accessibilityState={{ disabled: shift.status === 'Published' }} (and equivalents) to each Pressable alongside the disabled prop.

---

### TL-001 — `ACCESSIBILITY`
**File:** `app/(tabs)/_layout.tsx` · **Line:** 66

SignOutButton Pressable has no accessibilityHint, leaving screen-reader users without context about what signing out will do.

- **Current:** `accessibilityLabel="Sign out"`
- **Fix:** Add accessibilityHint="Ends your session and returns you to the sign-in screen" to the Pressable.

---

### TL-002 — `ACCESSIBILITY`
**File:** `app/(tabs)/_layout.tsx` · **Line:** 66

The SignOutButton renders only an icon inside the Pressable; if the icon fails to render, there is no visible or accessible text fallback for the button label.

- **Current:** `<IconSymbol size={22} name="rectangle.portrait.and.arrow.right" ... />`
- **Fix:** Add an <AccessibilityInfo>-safe visually-hidden label or wrap with an accessible Text node: <Text style={styles.srOnly}>Sign out</Text> alongside the icon.

---

### TL-003 — `ACCESSIBILITY`
**File:** `app/(tabs)/_layout.tsx` · **Line:** 40

Tab bar icons (house.fill, calendar, chart.bar.fill) have no accessibilityLabel; relying solely on the tab title means the icon Pressable area has no programmatic label on its own.

- **Current:** `<IconSymbol size={28} name="house.fill" color={color} />`
- **Fix:** Pass accessibilityLabel matching the tab title to each IconSymbol, e.g. accessibilityLabel={t('nav.home')} on the icon, or ensure HapticTab forwards the screen title as the accessible label.

---

### TL-004 — `ACCESSIBILITY`
**File:** `app/(tabs)/_layout.tsx` · **Line:** 22

The headerRight View wrapping LanguageSelector and extraHeaderRight has no accessibilityRole or label, so grouped interactive controls lack a landmark for screen readers.

- **Current:** `<View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 12 }}>`
- **Fix:** Add accessibilityRole="toolbar" and accessibilityLabel="Header actions" to the wrapping View.

---

### PA-001 — `ACCESSIBILITY`
**File:** `components/ProfileAchievements.tsx` · **Line:** 22

The section heading 'Achievements' has no accessibilityRole, so screen readers cannot identify it as a heading.

- **Current:** `<ThemedText type="subtitle">Achievements</ThemedText>`
- **Fix:** <ThemedText type="subtitle" accessibilityRole="header">Achievements</ThemedText>

---

### PA-002 — `ACCESSIBILITY`
**File:** `components/ProfileAchievements.tsx` · **Line:** 28

Each achievement card View has no accessibilityRole or accessibilityLabel, so screen readers announce it as an unlabelled group with no context.

- **Current:** `<ThemedView key={achievement.id} style={styles.card}>`
- **Fix:** <ThemedView key={achievement.id} style={styles.card} accessibilityRole="group" accessibilityLabel={`${achievement.title}: ${percent}% complete, ${achievement.progress} of ${safeGoal}`}>

---

### PA-003 — `ACCESSIBILITY`
**File:** `components/ProfileAchievements.tsx` · **Line:** 37

The progress bar track View exposes no accessibility semantics; screen readers skip or misread the visual progress indicator.

- **Current:** `<View style={styles.progressTrack}>
  <View style={[styles.progressFill, { width: `${percent}%` }]} />
</View>`
- **Fix:** <View style={styles.progressTrack} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: safeGoal, now: achievement.progress }} accessibilityLabel={`Progress: ${percent}%`}>
  <View style={[styles.progressFill, { width: `${percent}%` }]} />
</View>

---

### PA-004 — `ACCESSIBILITY`
**File:** `components/ProfileAchievements.tsx` · **Line:** 41

The '{progress} of {safeGoal}' text duplicates information already in the progress bar but is also the only human-readable count; there is no accessibilityLabel tying it to the parent achievement.

- **Current:** `<ThemedText style={styles.helperText}>
  {achievement.progress} of {safeGoal}
</ThemedText>`
- **Fix:** <ThemedText style={styles.helperText} accessibilityLabel={`${achievement.progress} of ${safeGoal} completed`} importantForAccessibility="no-hide-descendants">
  {achievement.progress} of {safeGoal}
</ThemedText>

---

### PA-005 — `EMPTY_STATES`
**File:** `components/ProfileAchievements.tsx` · **Line:** 20

When items is empty the component renders nothing (null), giving users no feedback that achievements exist but none have been earned yet.

- **Current:** `if (!items.length) return null;`
- **Fix:** if (!items.length) return (
  <ThemedView style={styles.container}>
    <ThemedText type="subtitle" accessibilityRole="header">Achievements</ThemedText>
    <ThemedText style={styles.helperText}>No achievements yet. Keep going to earn your first one!</ThemedText>
  </ThemedView>
);

---

### PA-006 — `I18N_GAPS`
**File:** `components/ProfileAchievements.tsx` · **Line:** 22

The section title 'Achievements' is a hardcoded English string not wrapped in a translation call.

- **Current:** `Achievements`
- **Fix:** {t('profile.achievements.title')}

---

### PA-007 — `I18N_GAPS`
**File:** `components/ProfileAchievements.tsx` · **Line:** 41

The '{progress} of {safeGoal}' progress label is a hardcoded English string with no i18n wrapper.

- **Current:** `{achievement.progress} of {safeGoal}`
- **Fix:** {t('profile.achievements.progressLabel', { progress: achievement.progress, goal: safeGoal })}

---

### IDX-001 — `ACCESSIBILITY`
**File:** `app/(tabs)/index.tsx` · **Line:** 90

The 'emptyStateCta' Pressable inside the upcoming-shifts empty state is missing an accessibilityHint, leaving screen-reader users without context on what navigating there accomplishes.

- **Current:** `accessibilityLabel={t('home.upcomingShifts.buildFirstA11y')}`
- **Fix:** Add accessibilityHint={t('home.upcomingShifts.buildFirstHint')} alongside the existing label, e.g. 'Opens the scheduler so you can create your first shift'.

---

### IDX-002 — `ACCESSIBILITY`
**File:** `app/(tabs)/index.tsx` · **Line:** 35

The hero logo-mark View ('H' monogram) has no accessibilityLabel or accessibilityRole, so VoiceOver/TalkBack announces it as an unlabelled element.

- **Current:** `<View style={styles.heroLogoMark}><ThemedText style={styles.heroLogoText}>H</ThemedText></View>`
- **Fix:** Add accessibilityRole="image" accessibilityLabel="Horario logo" to the outer heroLogoMark View, and set importantForAccessibility="no" on the inner ThemedText to avoid double-reading.

---

### IDX-003 — `ACCESSIBILITY`
**File:** `app/(tabs)/index.tsx` · **Line:** 100

Each staffing-gap row exposes raw gap/required counts without a combined accessible label, so TalkBack reads three disconnected fragments instead of a meaningful summary.

- **Current:** `<ThemedText style={styles.badge}>{t('home.staffingGaps.open', { n: String(gap.gap) })}</ThemedText>`
- **Fix:** Wrap each gap row View with accessibilityRole="listitem" and accessibilityLabel={`${gap.role}, ${gap.date}, ${gap.gap} open of ${gap.required} required`} so the entire row is read as one unit.

---

### IDX-004 — `ACCESSIBILITY`
**File:** `app/(tabs)/index.tsx` · **Line:** 78

Each upcoming-shift row View has no accessibilityRole or combined label, causing assistive technology to read worker name, template, and date as separate unrelated elements.

- **Current:** `<View key={shift.id} style={styles.rowBetween}>`
- **Fix:** Add accessibilityRole="listitem" and accessibilityLabel={`${shift.workerName}, ${shift.templateName}, ${shift.templateStart}–${shift.templateEnd}, ${shift.date}`} to the row View.

---

### IDX-005 — `PERFORMANCE`
**File:** `app/(tabs)/index.tsx` · **Line:** 147

The ProfileAchievements items array is constructed with a new object literal on every render, causing unnecessary child re-renders even when streakCount has not changed.

- **Current:** `items={[ { id: 'ach-1', ... progress: Math.max(streakCount, 1), ... }, { id: 'ach-2', ... } ]}`
- **Fix:** Memoize the array: const achievements = useMemo(() => [{ id: 'ach-1', ..., progress: Math.max(streakCount, 1) }, { id: 'ach-2', ... }], [streakCount, t]); then pass items={achievements}.

---

### SCH-001 — `ACCESSIBILITY`
**File:** `app/(tabs)/scheduler.tsx` · **Line:** 120

Pressable for opening forecast setup has no accessibilityRole, accessibilityLabel, or accessibilityHint, making it invisible to screen readers.

- **Current:** `<Pressable onPress={() => router.setParams({ section: 'forecast' })}>`
- **Fix:** Add accessibilityRole="button" accessibilityLabel={t('scheduler.missingData.openSetup')} accessibilityHint={t('scheduler.missingData.openSetupHint')} to the Pressable.

---

### SCH-002 — `ACCESSIBILITY`
**File:** `app/(tabs)/scheduler.tsx` · **Line:** 104

The actionBanner ThemedView conveys dynamic success/error status but has no accessibilityRole='alert' or accessibilityLiveRegion, so screen readers won't announce changes.

- **Current:** `<ThemedView style={[styles.banner, actionBanner.type === 'success' && styles.bannerSuccess, ...]}>`
- **Fix:** Add accessibilityRole="alert" accessibilityLiveRegion="polite" (or 'assertive' for errors) to the actionBanner ThemedView.

---

### SCH-003 — `ACCESSIBILITY`
**File:** `app/(tabs)/scheduler.tsx` · **Line:** 114

The needsFallbackSetup warning banner has no accessibilityRole or live-region annotation, so urgent missing-data warnings are not surfaced to assistive technologies.

- **Current:** `<ThemedView style={[styles.banner, styles.bannerWarning, styles.dismissibleBanner]}>`
- **Fix:** Add accessibilityRole="alert" accessibilityLiveRegion="assertive" to this ThemedView.

---

### SCH-004 — `ACCESSIBILITY`
**File:** `app/(tabs)/scheduler.tsx` · **Line:** 121

The link-styled ThemedText child of the Pressable reads as plain text to screen readers with no role indication that it is interactive.

- **Current:** `<ThemedText style={styles.linkText}>{t('scheduler.missingData.openSetup')}</ThemedText>`
- **Fix:** Remove the nested ThemedText and instead render the label directly via accessibilityLabel on the Pressable, or ensure the Pressable has accessibilityRole="link" so assistive tech announces it correctly.

---

### EXP-001 — `ACCESSIBILITY`
**File:** `app/(tabs)/explore.tsx` · **Line:** 131

ScrollView has an accessibilityLabel intended for landmark identification but ScrollView is not a landmark element; this label will be read as the container name, which is confusing on screen readers.

- **Current:** `accessibilityLabel={t('nav.analytics')}`
- **Fix:** Remove accessibilityLabel from ScrollView and instead wrap the header ThemedView with accessibilityRole='header'. If a region label is needed, use a wrapping View with accessibilityRole='none' or add a visually-hidden heading.

---

### EXP-002 — `ACCESSIBILITY`
**File:** `app/(tabs)/explore.tsx` · **Line:** 167

MetricCard is a purely presentational card but contains no accessibilityRole and no accessible grouping, so screen readers read out value and label as disconnected strings.

- **Current:** `<ThemedView style={[styles.metricCard, ...]}> with no accessibilityRole`
- **Fix:** Add accessibilityRole='text' (or 'summary') and accessibilityLabel={`${label}: ${value}${sub ? ', ' + sub : ''}`} to the outer ThemedView of MetricCard so the whole card is announced as one unit.

---

### EXP-003 — `ACCESSIBILITY`
**File:** `app/(tabs)/explore.tsx` · **Line:** 71

HoursBar row has no accessibilityLabel; screen readers will announce the raw worker name, bar (invisible View), and hours as three separate unrelated elements.

- **Current:** `<View style={styles.barRow} testID={testID}>`
- **Fix:** Add accessibilityRole='none' importantForAccessibility='no-hide-descendants' to inner Views, and on the outer View: accessibilityLabel={`${name}: ${hours.toFixed(1)} hours`}.

---

### EXP-004 — `ACCESSIBILITY`
**File:** `app/(tabs)/explore.tsx` · **Line:** 88

FairnessGauge has no accessibilityLabel; the color-coded bar is invisible to screen readers and the label + score are read as separate fragments.

- **Current:** `<View style={styles.fairnessRow}>`
- **Fix:** Add accessibilityLabel={`${label}, fairness standard deviation ${score.toFixed(1)}`} and accessibilityRole='none' on the outer View, marking inner decorative Views with importantForAccessibility='no'.

---

### IT-001 — `ACCESSIBILITY`
**File:** `components/InfoTooltip.tsx` · **Line:** 184

The 'Close tooltip' full-screen dismiss Pressable is missing accessibilityRole and accessibilityHint, making its purpose ambiguous to screen-reader users.

- **Current:** `<Pressable style={StyleSheet.absoluteFill} onPress={hide} accessibilityLabel="Close tooltip" />`
- **Fix:** Add accessibilityRole="button" and accessibilityHint="Dismisses the help tooltip" to the full-screen Pressable.

---

### IT-002 — `ACCESSIBILITY`
**File:** `components/InfoTooltip.tsx` · **Line:** 197

The native 'Close' button has an accessibilityLabel of 'Close' which is vague and does not describe what is being closed.

- **Current:** `accessibilityLabel="Close"`
- **Fix:** Change to accessibilityLabel="Close help tooltip" and add accessibilityHint="Dismisses the help information card".

---

### IT-003 — `ACCESSIBILITY`
**File:** `components/InfoTooltip.tsx` · **Line:** 152

The web tooltip card View is not exposed to assistive technology — it has no accessibilityRole, accessibilityLabel, or aria-modal, so screen readers cannot identify or navigate it.

- **Current:** `<View style={[styles.tooltipCard, { position: 'absolute', ... }]} onPointerEnter={clearHideTimer} onPointerLeave={schedu`
- **Fix:** Add accessibilityRole="tooltip", accessibilityLabel={label} (or a derivative), and aria-modal where supported, so assistive tech announces the tooltip card.

---

### IT-004 — `ACCESSIBILITY`
**File:** `components/InfoTooltip.tsx` · **Line:** 186

The native modal overlay View containing the tooltip card has no accessibilityViewIsModal or accessibilityRole, so focus is not trapped inside the modal for screen readers.

- **Current:** `<View style={styles.nativeOverlay} pointerEvents="box-none">`
- **Fix:** Add accessibilityViewIsModal={true} and accessibilityRole="alert" (or 'dialog' on web) to the nativeOverlay View.

---

### IT-005 — `KEYBOARD`
**File:** `components/InfoTooltip.tsx` · **Line:** 130

On web, the Modal does not trap keyboard focus inside the tooltip card; Tab key can reach elements behind the transparent backdrop, breaking keyboard UX.

- **Current:** `<Modal visible={visible} transparent animationType={isWeb ? 'none' : 'fade'} onRequestClose={hide}>`
- **Fix:** On web, render a focus-trap wrapper (e.g. react-focus-lock or a manual tabIndex/-1 sentinel approach) around the tooltip card when visible, and restore focus to buttonRef on close.

---

### IT-012 — `I18N_GAPS`
**File:** `components/InfoTooltip.tsx` · **Line:** 197

The hardcoded string 'Got it ✓' inside the close button is not wrapped in a translation call.

- **Current:** `<ThemedText style={styles.closeText}>Got it ✓</ThemedText>`
- **Fix:** Replace with {t('tooltip.close')} (or equivalent i18n call) and add the key to translation files.

---

### SC-001 — `ACCESSIBILITY`
**File:** `components/StreakCounter.tsx` · **Line:** 55

Pressable log button is missing accessibilityRole, accessibilityLabel, and accessibilityHint, making it unidentifiable to screen readers.

- **Current:** `<Pressable style={[styles.logButton, isFresh && styles.logButtonDisabled]} onPress={onRecordToday} disabled={isFresh}>`
- **Fix:** Add accessibilityRole="button", accessibilityLabel={isFresh ? 'Already logged for today' : 'Log today\'s progress'}, accessibilityHint={isFresh ? '' : 'Records your activity and extends your streak'}, and accessibilityState={{ disabled: isFresh }}.

---

### SC-002 — `ACCESSIBILITY`
**File:** `components/StreakCounter.tsx` · **Line:** 55

Disabled state of the log button is communicated only via opacity and the disabled prop but not via accessibilityState, so screen readers won't announce it as disabled.

- **Current:** `disabled={isFresh}`
- **Fix:** Add accessibilityState={{ disabled: isFresh }} to the Pressable alongside the existing disabled prop.

---

### SC-003 — `ACCESSIBILITY`
**File:** `components/StreakCounter.tsx` · **Line:** 35

The badge displaying the streak count has no accessibilityLabel, so screen readers will read raw numbers without context.

- **Current:** `<ThemedText style={styles.badgeText}>{streakCount} day streak</ThemedText>`
- **Fix:** Wrap the badge ThemedView with accessibilityRole="text" and accessibilityLabel={`Current streak: ${streakCount} days`}.

---

### SC-004 — `ACCESSIBILITY`
**File:** `components/StreakCounter.tsx` · **Line:** 49

The rewardCard ThemedView has no accessibilityRole or accessibilityLabel, leaving reward information unannounced in a structured way for screen readers.

- **Current:** `<ThemedView style={styles.rewardCard}>`
- **Fix:** Add accessibilityRole="alert" (or "region") and accessibilityLabel={`Reward unlocked: ${rewardTitle}`} so screen readers announce it when it appears.

---

### SC-006 — `I18N_GAPS`
**File:** `components/StreakCounter.tsx` · **Line:** 38

The string ' day streak' is hardcoded English and not wrapped in a t() translation call.

- **Current:** `{streakCount} day streak`
- **Fix:** Replace with {t('streakCounter.dayStreak', { count: streakCount })} and add the key to your i18n resource files.

---

### LS-001 — `ACCESSIBILITY`
**File:** `components/LanguageSelector.tsx` · **Line:** 65

The overlay Pressable used to dismiss the modal has a vague accessibilityLabel that gives no role or action context and is missing accessibilityRole and accessibilityHint.

- **Current:** `accessibilityLabel="Close language selector"`
- **Fix:** Add accessibilityRole="button" and accessibilityHint="Double-tap to dismiss" and change label to "Dismiss language selector".

---

### LS-002 — `ACCESSIBILITY`
**File:** `components/LanguageSelector.tsx` · **Line:** 76

Language row items use accessibilityRole="radio" but there is no wrapping radiogroup role, which makes the radio semantics invalid for both screen readers and assistive tech.

- **Current:** `accessibilityRole="radio"`
- **Fix:** Wrap the FlatList in a View with accessibilityRole="radiogroup" and accessibilityLabel={locale.language.selectorLabel} so the radio items have valid group context.

---

### LS-003 — `ACCESSIBILITY`
**File:** `components/LanguageSelector.tsx` · **Line:** 84

The checkmark (✓) is rendered as visible text but has no accessibilityElementsHidden, so screen readers will announce it redundantly since accessibilityState.checked already conveys selection.

- **Current:** `<ThemedText style={styles.checkmark}>✓</ThemedText>`
- **Fix:** Add importantForAccessibility="no" (Android) and accessibilityElementsHidden={true} (iOS) to the checkmark ThemedText, or render it as an aria-hidden element on web.

---

### LS-004 — `ACCESSIBILITY`
**File:** `components/LanguageSelector.tsx` · **Line:** 55

Flag emoji in triggerText and lang rows are exposed to screen readers without an accessibilityLabel, causing TalkBack/VoiceOver to spell out the emoji description rather than the language name.

- **Current:** `<ThemedText style={styles.triggerText}>{current.flag} {currentLang.toUpperCase()}</ThemedText>`
- **Fix:** Wrap the flag emoji in a View/Text with accessibilityElementsHidden={true} and importantForAccessibility="no" so only the language code or label is announced.

---

### WS-001 — `ACCESSIBILITY`
**File:** `components/scheduler/WorkerSection.tsx` · **Line:** 171

The availability-submit Pressable has no accessibilityRole, accessibilityLabel, or accessibilityHint, making it completely opaque to assistive technology.

- **Current:** `<Pressable onPress={handleAvailabilitySubmit} style={styles.primaryButton}>`
- **Fix:** Add accessibilityRole="button", accessibilityLabel={t('scheduler.availability.addButtonA11y')}, accessibilityHint={t('scheduler.availability.addButtonHint')} to the Pressable.

---

### WS-002 — `ACCESSIBILITY`
**File:** `components/scheduler/WorkerSection.tsx` · **Line:** 179

The dismiss Pressable inside the success banner has no accessibilityRole, accessibilityLabel, or accessibilityHint; screen-reader users only hear the raw text 'dismiss' with no context.

- **Current:** `<Pressable onPress={() => setAvailabilitySuccessPromptVisible(false)}>`
- **Fix:** Add accessibilityRole="button", accessibilityLabel={t('scheduler.availability.dismissBannerA11y')} (e.g. 'Dismiss availability saved confirmation'), accessibilityHint to the Pressable.

---

### WS-003 — `ACCESSIBILITY`
**File:** `components/scheduler/WorkerSection.tsx` · **Line:** 155

The availability workerId InputField has no accessibilityLabel or accessibilityHint, so screen readers cannot describe the field's purpose.

- **Current:** `<InputField label={t('scheduler.availability.workerIdLabel')} ... onChangeText={updateAvailabilityField('workerId')} />`
- **Fix:** Pass accessibilityLabel={t('scheduler.availability.workerIdA11y')} and accessibilityHint={t('scheduler.availability.workerIdA11yHint')} to the InputField.

---

### WS-004 — `ACCESSIBILITY`
**File:** `components/scheduler/WorkerSection.tsx` · **Line:** 161

The day, from, and to InputFields inside the availability inline-inputs group all lack accessibilityLabel and accessibilityHint.

- **Current:** `<InputField label={t('scheduler.availability.dayLabel')} ... /> <InputField label={...fromLabel} .../> <InputField label`
- **Fix:** Add accessibilityLabel and accessibilityHint props to each of the three InputFields, analogous to the worker-form fields above.

---

### CHK-001 — `ACCESSIBILITY`
**File:** `components/scheduler/Checklist.tsx` · **Line:** 38

accessibilityLabel for the step Pressable is identical whether the step is complete or not because the ternary appends an empty string in both branches, so screen readers never announce completion state.

- **Current:** `t('scheduler.onboarding.completedA11y', { step: step.title }) + (step.completed ? '' : '')`
- **Fix:** Use a meaningful conditional: `step.completed ? t('scheduler.onboarding.stepCompletedA11y', { step: step.title }) : t('scheduler.onboarding.stepIncompleteA11y', { step: step.title })`

---

### CHK-002 — `ACCESSIBILITY`
**File:** `components/scheduler/Checklist.tsx` · **Line:** 38

Each step Pressable is missing an accessibilityHint describing what will happen when activated.

- **Current:** `n/a`
- **Fix:** Add `accessibilityHint={step.completed ? t('scheduler.onboarding.stepDoneHint') : t('scheduler.onboarding.stepActionHint', { action: step.actionLabel })}` to every Pressable.

---

### CHK-003 — `ACCESSIBILITY`
**File:** `components/scheduler/Checklist.tsx` · **Line:** 28

Progress bar View has no accessibility role or live label, so screen readers cannot announce the current onboarding progress percentage.

- **Current:** `<View style={styles.progressTrack}>`
- **Fix:** Add `accessibilityRole="progressbar"`, `accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}`, and `accessibilityLabel={t('scheduler.onboarding.progressA11y', { pct: Math.round(progress * 100) })}` to the outer progress track View.

---

### CHK-004 — `ACCESSIBILITY`
**File:** `components/scheduler/Checklist.tsx` · **Line:** 36

When step.onPress is undefined the Pressable is still rendered as an interactive button, misleading assistive technology and keyboard users.

- **Current:** `onPress={step.onPress}`
- **Fix:** Set `accessibilityState={{ disabled: !step.onPress }}` and conditionally omit `accessibilityRole="button"` or replace with `role="none"` when onPress is falsy.

---

### WP-001 — `ACCESSIBILITY`
**File:** `components/WellnessPrompt.tsx` · **Line:** 20

The alert container has no accessibilityHint, so screen-reader users receive no guidance on what actions are available inside the live region.

- **Current:** `accessibilityLabel="Mindful break reminder"`
- **Fix:** Add accessibilityHint="Two buttons below let you dismiss or start a 3-minute reset" to the ThemedView.

---

### WP-002 — `ACCESSIBILITY`
**File:** `components/WellnessPrompt.tsx` · **Line:** 28

The 'Dismiss' Pressable is missing an accessibilityHint, leaving screen-reader users without context about the consequence of the action.

- **Current:** `accessibilityLabel="Dismiss break reminder"`
- **Fix:** Add accessibilityHint="Closes the wellness prompt without taking a break" to the dismiss Pressable.

---

### WP-003 — `ACCESSIBILITY`
**File:** `components/WellnessPrompt.tsx` · **Line:** 33

The 'Take a break' Pressable is missing an accessibilityHint, so users don't know what will happen when they activate it.

- **Current:** `accessibilityLabel="Take a short break"`
- **Fix:** Add accessibilityHint="Starts a guided 3-minute break session" to the primary Pressable.

---

### PF-001 — `ACCESSIBILITY`
**File:** `components/PersonalizedFeed.tsx` · **Line:** 23

accessibilityLabel concatenates title and summary which can exceed 120 chars and duplicates visible text already read by screen readers; no accessibilityHint describes the action.

- **Current:** `accessibilityLabel={`${item.title}. ${item.summary}`}`
- **Fix:** accessibilityLabel={item.title} accessibilityHint={`Relevance score ${Math.round(Math.min(1,Math.max(0,item.score))*100)}%. Tap to open.`}

---

### PF-002 — `EMPTY_STATES`
**File:** `components/PersonalizedFeed.tsx` · **Line:** 14

When items is empty the component returns null with no empty-state message or CTA, leaving a blank section with no user guidance.

- **Current:** `if (!items.length) return null;`
- **Fix:** if (!items.length) return (<ThemedView style={styles.container}><ThemedText>No personalized actions yet. Complete more tasks to get recommendations.</ThemedText></ThemedView>);

---

### PF-003 — `I18N_GAPS`
**File:** `components/PersonalizedFeed.tsx` · **Line:** 17

The section heading 'Personalized actions' is a hardcoded English string not wrapped in a t() call.

- **Current:** `<ThemedText type="subtitle">Personalized actions</ThemedText>`
- **Fix:** <ThemedText type="subtitle">{t('personalizedFeed.heading')}</ThemedText>

---

### UB-001 — `ACCESSIBILITY`
**File:** `components/UpgradeBanner.tsx` · **Line:** 44

Trial banner is a static View but conveys status information with no accessibilityRole or accessibilityLabel, making it invisible to screen readers as a meaningful region.

- **Current:** `<View style={[styles.banner, styles.trialBanner]}>`
- **Fix:** Add accessibilityRole="status" and accessibilityLabel="Pro trial active — unlimited auto-assigns enabled. $12/mo flat after trial." to the outer View so VoiceOver/TalkBack announces it as a live status region.

---

### UB-002 — `ACCESSIBILITY`
**File:** `components/UpgradeBanner.tsx` · **Line:** 69

The free-plan Pressable accessibilityLabel is static ('Upgrade to Pro plan') and does not reflect the dynamic state (limit reached vs. uses remaining), losing critical context for screen-reader users.

- **Current:** `accessibilityLabel="Upgrade to Pro plan"`
- **Fix:** Set accessibilityLabel dynamically: accessibilityLabel={limitReached ? 'Upgrade to Pro — free auto-assign limit reached' : `Upgrade to Pro — ${autoAssignUsesLeft} free auto-assign${autoAssignUsesLeft === 1 ? '' : 's'} remaining`}

---

### UB-003 — `ACCESSIBILITY`
**File:** `components/UpgradeBanner.tsx` · **Line:** 71

accessibilityHint describes navigation ('Opens billing page') but omits the consequence of the action; hint should describe outcome not mechanism.

- **Current:** `accessibilityHint="Opens billing page to start your free Pro trial"`
- **Fix:** accessibilityHint="Starts your 10-day free Pro trial with no per-employee fees"

---

### UB-004 — `I18N_GAPS`
**File:** `components/UpgradeBanner.tsx` · **Line:** 58

All user-visible strings (headline, CTA, pricing note, badge labels, trial copy) are hardcoded English literals with no t() internationalisation wrapper.

- **Current:** `'Stop building rosters by hand — you\'ve hit the free limit.' / 'TRIAL' / 'FREE' / '$12/mo flat after trial...'`
- **Fix:** Wrap every visible string in a t() call, e.g. t('upgradeBanner.limitReachedHeadline'), and extract all literals to a locale file. Apply consistently across outcomeHeadline, outcomeCta, badge text, trial text, trialSub, and pricingNote.

---

### EL-001 — `ACCESSIBILITY`
**File:** `components/ExternalLink.tsx` · **Line:** 9

No accessibilityRole is enforced, so screen readers may not announce this as a link, and callers can accidentally omit it.

- **Current:** `<Link target="_blank" {...rest} href={href} onPress={...} />`
- **Fix:** Spread rest after setting a default: <Link accessibilityRole="link" {...rest} href={href} onPress={...} /> — this ensures a sensible default while still allowing callers to override.

---

### EL-002 — `ACCESSIBILITY`
**File:** `components/ExternalLink.tsx` · **Line:** 9

No accessibilityHint is provided to warn users that the link opens outside the app (in-app browser on native, new tab on web).

- **Current:** `n/a`
- **Fix:** Add a default hint: accessibilityHint={rest.accessibilityHint ?? 'Opens in an external browser'} as a prop on the Link element.

---

### IF-001 — `ACCESSIBILITY`
**File:** `components/scheduler/InputField.tsx` · **Line:** 30

TextInput is missing accessibilityRole; React Native does not automatically assign 'none' or 'text' role to TextInput on all platforms, leaving screen readers without explicit semantic context.

- **Current:** `<TextInput ... accessibilityLabel={accessibilityLabel ?? label} />`
- **Fix:** Add accessibilityRole="none" (or use role="textbox" on web via aria-role) — for React Native set accessibilityRole to a supported value; for TextInput the standard is to leave role implicit but explicitly add role='search'/'text' via the accessible prop set to true: `accessible={true} accessibilityRole="none"`. More practically, ensure `accessible={true}` is explicit so the field is always exposed as a focusable accessible element.

---

### IF-002 — `ACCESSIBILITY`
**File:** `components/scheduler/InputField.tsx` · **Line:** 32

accessibilityHint is entirely optional and can be undefined, meaning callers that omit it leave screen-reader users without any action guidance on what the field expects.

- **Current:** `accessibilityHint={accessibilityHint}`
- **Fix:** Derive a sensible default hint from the label when none is provided, e.g.: `accessibilityHint={accessibilityHint ?? `Enter ${label.toLowerCase()}`}`

---

### LRS-001 — `ACCESSIBILITY`
**File:** `components/scheduler/LostRevenueSummary.tsx` · **Line:** 52

The ThemedView root container has no accessibilityRole or accessibilityLabel, so screen readers announce it as a generic unlabelled region.

- **Current:** `<ThemedView style={styles.lossSummary}>`
- **Fix:** <ThemedView style={styles.lossSummary} accessibilityRole="summary" accessibilityLabel="Lost revenue summary">

---

### LRS-002 — `ACCESSIBILITY`
**File:** `components/scheduler/LostRevenueSummary.tsx` · **Line:** 57

The progress bar View has no accessibilityRole, accessibilityLabel, or accessibilityValue, making it completely opaque to assistive technology.

- **Current:** `<View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: improvementPercent as `${number}`
- **Fix:** <View
  style={styles.progressTrack}
  accessibilityRole="progressbar"
  accessibilityLabel="Schedule improvement"
  accessibilityValue={{ min: 0, max: 100, now: Math.min(100, Math.max(0, metrics.improvement * 100)), text: improvementPercent }}
>
  <View style={[styles.progressFill, { width: improvementPercent as `${number}%` }]} />
</View>

---

### ALT-001 — `ACCESSIBILITY`
**File:** `app/_layout.tsx` · **Line:** 23

The '+not-found' Stack.Screen has no accessibilityLabel or title option, so screen-readers will announce a raw route string to users landing on the 404 screen.

- **Current:** `<Stack.Screen name="+not-found" />`
- **Fix:** <Stack.Screen name="+not-found" options={{ title: 'Page Not Found', headerShown: true }} />

---

### SC-001 — `ACCESSIBILITY`
**File:** `components/SkeletonCard.tsx` · **Line:** 53

accessibilityLabel 'Loading' is vague and provides no context about what content is loading.

- **Current:** `accessibilityLabel="Loading"`
- **Fix:** accessibilityLabel="Loading content, please wait"

---

### EB-001 — `ACCESSIBILITY`
**File:** `components/ErrorBoundary.tsx` · **Line:** 46

ThemedView container has no accessibilityRole or accessibilityLabel, so screen readers announce it as an opaque view with no semantic meaning when the error state is shown.

- **Current:** `<ThemedView testID="error-boundary-fallback" style={styles.container}>`
- **Fix:** <ThemedView testID="error-boundary-fallback" accessibilityRole="alert" accessibilityLabel="An error occurred. Please try again." style={styles.container}>

---

### EB-003 — `I18N_GAPS`
**File:** `components/ErrorBoundary.tsx` · **Line:** 52

The heading 'Something went wrong', error message, button label 'Try again', accessibilityLabel 'Retry', and accessibilityHint are all hardcoded English strings not passed through a localisation function.

- **Current:** `"Something went wrong", "Try again", "Retry", "Attempt to reload the section that failed"`
- **Fix:** Wrap every user-visible string with t(): t('errorBoundary.title'), t('errorBoundary.retry'), t('errorBoundary.retryHint'), etc., and move them to the appropriate translation file.

---

### TT-001 — `ACCESSIBILITY`
**File:** `components/ThemedText.tsx` · **Line:** 22

Text nodes with type='link' have no accessibilityRole='link', so screen readers cannot identify them as navigable links.

- **Current:** `type === 'link' ? styles.link : undefined`
- **Fix:** Spread `accessibilityRole={type === 'link' ? 'link' : undefined}` onto the <Text> element, e.g.: `<Text accessibilityRole={type === 'link' ? 'link' : undefined} style={[...]} {...rest} />`

---

### PSV-001 — `ACCESSIBILITY`
**File:** `components/ParallaxScrollView.tsx` · **Line:** 53

The Animated.ScrollView has no accessibilityRole or accessibilityLabel, so screen readers cannot identify it as a scrollable region.

- **Current:** `<Animated.ScrollView ref={scrollRef} scrollEventThrottle={16} ...>`
- **Fix:** Add accessibilityRole="scrollbar" (or the semantic equivalent) and accessibilityLabel="Main content scroll view" to the Animated.ScrollView element.

---

### HT-001 — `ACCESSIBILITY`
**File:** `components/HapticTab.tsx` · **Line:** 6

HapticTab spreads BottomTabBarButtonProps but never explicitly enforces or augments accessibilityRole, accessibilityLabel, or accessibilityHint, meaning tabs lacking those props in the navigator config will be completely unannotated for screen readers.

- **Current:** `<PlatformPressable {...props} onPressIn={...} />`
- **Fix:** Destructure and provide safe fallbacks: `const { accessibilityRole = 'button', accessibilityLabel, accessibilityHint, ...rest } = props;` then pass them explicitly to PlatformPressable, and add a dev-mode warning when accessibilityLabel is absent.

---

### COL-001 — `ACCESSIBILITY`
**File:** `components/Collapsible.tsx` · **Line:** 22

accessibilityHint is missing on the toggle button, leaving screen-reader users without guidance on what pressing it will do.

- **Current:** `accessibilityLabel={title}`
- **Fix:** Add accessibilityHint={isOpen ? 'Collapse this section' : 'Expand this section'} to the TouchableOpacity.

---

### SC-001 — `ACCESSIBILITY`
**File:** `components/scheduler/SectionCard.tsx` · **Line:** 18

ThemedView wrapping the card has no accessibilityRole, so screen readers cannot identify it as a distinct section/region.

- **Current:** `<ThemedView style={styles.card}>`
- **Fix:** <ThemedView style={styles.card} accessibilityRole="region" accessibilityLabel={title}>

---

### AL-001 — `ACCESSIBILITY`
**File:** `components/scheduler/AvailabilityLabel.tsx` · **Line:** 13

The outer View has no accessibilityRole, accessibilityLabel, or accessibilityHint, so screen readers will announce two disconnected text nodes instead of a single meaningful availability slot.

- **Current:** `<View style={styles.badge}>`
- **Fix:** <View style={styles.badge} accessibilityRole="text" accessibilityLabel={`Available on ${day} from ${from} to ${to}`}>

---

## 🟡 MEDIUM Severity Findings

| ID | Category | File | Issue |
|----|----------|------|-------|
| `DS-008` | `KEYBOARD` | `components/scheduler/DemandSection.tsx` | No returnKeyType or onSubmitEditing chaining between the role and startDate InputFields. |
| `DS-009` | `KEYBOARD` | `components/scheduler/DemandSection.tsx` | Toggle chip Pressables are not reachable via Tab key on web because Pressable does not ren |
| `DS-010` | `KEYBOARD` | `components/scheduler/DemandSection.tsx` | No autoFocus on the first InputField of the fallback form, so keyboard users have no autom |
| `DS-011` | `BUTTON_CONSISTENCY` | `components/scheduler/DemandSection.tsx` | Save Baseline uses styles.secondaryButton + styles.tightButton while Save Target uses only |
| `DS-012` | `BUTTON_CONSISTENCY` | `components/scheduler/DemandSection.tsx` | Forecast Pressable is disabled by conditionally guarding runForecast inside onPress rather |
| `DS-014` | `PERFORMANCE` | `components/scheduler/DemandSection.tsx` | Inline arrow functions passed to both toggle Pressables create new function references on  |
| `DS-015` | `PERFORMANCE` | `components/scheduler/DemandSection.tsx` | Inline arrow function wrapping runForecast with a guard creates a new function reference e |
| `STS-006` | `ACCESSIBILITY` | `components/scheduler/ShiftTemplateSection.tsx` | templateSuccessMessage is rendered as plain ThemedText with no live region, so screen read |
| `STS-007` | `ACCESSIBILITY` | `components/scheduler/ShiftTemplateSection.tsx` | WorkerId and templateId InputFields in the shifts section are missing accessibilityLabel a |
| `STS-008` | `KEYBOARD` | `components/scheduler/ShiftTemplateSection.tsx` | No returnKeyType or onSubmitEditing is set on any InputField in the template form, so keyb |
| `STS-009` | `KEYBOARD` | `components/scheduler/ShiftTemplateSection.tsx` | No returnKeyType or onSubmitEditing is set on any InputField in the shift form, preventing |
| `STS-010` | `KEYBOARD` | `components/scheduler/ShiftTemplateSection.tsx` | No autoFocus on the first InputField of the 'Add Template' form, so keyboard users opening |
| `STS-011` | `BUTTON_CONSISTENCY` | `components/scheduler/ShiftTemplateSection.tsx` | The 'Save Shift' button uses styles.primaryButton but its sibling 'Auto-Assign' uses style |
| `STS-012` | `BUTTON_CONSISTENCY` | `components/scheduler/ShiftTemplateSection.tsx` | The 'Apply' Pressable conditionally applies styles.disabledButton but has no cursor or opa |
| `STS-013` | `EMPTY_STATES` | `components/scheduler/ShiftTemplateSection.tsx` | The auto-assign suggestions block renders nothing (null) when autoAssignSuggestions is an  |
| `STS-014` | `PERFORMANCE` | `components/scheduler/ShiftTemplateSection.tsx` | Inside the autoAssignSuggestions map, workers.find() and shiftTemplates.find() are called  |
| `RS-006` | `ACCESSIBILITY` | `components/scheduler/RosterSection.tsx` | The date heading inside each rosterDay group has no accessibilityRole, so screen readers d |
| `RS-007` | `ACCESSIBILITY` | `components/scheduler/RosterSection.tsx` | The 'Secured' badge View has no accessibilityLabel or accessibilityRole, so its meaning is |
| `RS-008` | `BUTTON_CONSISTENCY` | `components/scheduler/RosterSection.tsx` | The Unpublish and Notify chips omit styles.actionChipPrimary / variant style that the Publ |
| `RS-009` | `BUTTON_CONSISTENCY` | `components/scheduler/RosterSection.tsx` | Disabled visual state relies solely on styles.disabledButton with no opacity or color chan |
| `RS-010` | `PERFORMANCE` | `components/scheduler/RosterSection.tsx` | Object.entries(rosterByDate) is called twice in render — once for the empty check and once |
| `RS-011` | `PERFORMANCE` | `components/scheduler/RosterSection.tsx` | Inline arrow functions are created on every render for all three onPress handlers inside t |
| `RS-014` | `EMPTY_STATES` | `components/scheduler/RosterSection.tsx` | When rosterByDate is empty the ghost skeleton renders decorative placeholder rows but ther |
| `TL-005` | `BUTTON_CONSISTENCY` | `app/(tabs)/_layout.tsx` | SignOutButton uses an inline style object literal instead of a StyleSheet entry, inconsist |
| `TL-006` | `BUTTON_CONSISTENCY` | `app/(tabs)/_layout.tsx` | SignOutButton has no disabled state styling or disabled prop; if signOut is in-flight the  |
| `TL-007` | `PERFORMANCE` | `app/(tabs)/_layout.tsx` | headerRightContent is a JSX element created as a plain variable inside the render body of  |
| `TL-008` | `PERFORMANCE` | `app/(tabs)/_layout.tsx` | headerRight is an inline arrow function () => headerRightContent passed to screenOptions,  |
| `TL-009` | `PERFORMANCE` | `app/(tabs)/_layout.tsx` | onPress={() => signOut()} is a new inline function created on every render of SignOutButto |
| `TL-010` | `I18N_GAPS` | `app/(tabs)/_layout.tsx` | The accessibilityLabel "Sign out" is a hardcoded English string not passed through the t() |
| `PA-008` | `PERFORMANCE` | `components/ProfileAchievements.tsx` | A new inline style object literal `{ width: \`${percent}%\` }` is created on every render  |
| `PA-009` | `PERFORMANCE` | `components/ProfileAchievements.tsx` | The entire items.map() with per-item arithmetic (Math.min, Math.max, Math.round) runs unco |
| `PA-010` | `BUTTON_CONSISTENCY` | `components/ProfileAchievements.tsx` | The card background is hardcoded '#ffffff' while the container uses a transparent tint '#f |
| `PA-011` | `BUTTON_CONSISTENCY` | `components/ProfileAchievements.tsx` | The progress fill colour '#2563EB' is hardcoded and will not adapt to theme or user-define |
| `IDX-006` | `PERFORMANCE` | `app/(tabs)/index.tsx` | An inline arrow function is passed as the onSelectItem prop on every render, breaking refe |
| `IDX-007` | `PERFORMANCE` | `app/(tabs)/index.tsx` | usePersonalizedFeed is called with a new options object literal on every render, which may |
| `IDX-008` | `BUTTON_CONSISTENCY` | `app/(tabs)/index.tsx` | The three quick-action Pressables use actionButton style (borderRadius: 10, padding: 12) w |
| `IDX-009` | `BUTTON_CONSISTENCY` | `app/(tabs)/index.tsx` | No Pressable in the file handles a disabled visual state; if the parent hook is loading (r |
| `IDX-010` | `EMPTY_STATES` | `app/(tabs)/index.tsx` | PersonalizedFeed is rendered unconditionally with whatever feedItems the hook returns; if  |
| `IDX-011` | `I18N_GAPS` | `app/(tabs)/index.tsx` | The heroTagline text 'Smart scheduling, simplified.' is a hardcoded English string not wra |
| `IDX-012` | `I18N_GAPS` | `app/(tabs)/index.tsx` | The heroWordmark text 'Horario' is hardcoded English (product name) without a t() call; wh |
| `SCH-005` | `KEYBOARD` | `app/(tabs)/scheduler.tsx` | The Pressable inside the warning banner is not reachable via Tab key on web because Pressa |
| `SCH-006` | `EMPTY_STATES` | `app/(tabs)/scheduler.tsx` | WorkerSection receives workers which may be an empty array on first load, but there is no  |
| `SCH-007` | `EMPTY_STATES` | `app/(tabs)/scheduler.tsx` | ShiftTemplateSection receives shiftTemplates which may be empty, but no empty-state messag |
| `SCH-008` | `EMPTY_STATES` | `app/(tabs)/scheduler.tsx` | RosterSection receives upcomingShifts and staffingGaps which may both be empty arrays with |
| `SCH-009` | `PERFORMANCE` | `app/(tabs)/scheduler.tsx` | Inline arrow function passed to onPress creates a new function reference on every render,  |
| `SCH-010` | `PERFORMANCE` | `app/(tabs)/scheduler.tsx` | Array literal with conditional values is constructed inline in the style prop on every ren |
| `EXP-005` | `ACCESSIBILITY` | `app/(tabs)/explore.tsx` | The revenue card's ThemedText displaying the revenue value has a dynamic color (red/green) |
| `EXP-006` | `ACCESSIBILITY` | `app/(tabs)/explore.tsx` | The 'openScheduler' translation key is used for both the accessibilityLabel and the visibl |
| `EXP-007` | `KEYBOARD` | `app/(tabs)/explore.tsx` | The retry Pressable and the primary action Pressable are not reachable via Tab key on Expo |
| `EXP-008` | `TOOLTIP_COPY` | `app/(tabs)/explore.tsx` | accessibilityHint for retry button depends entirely on t('analytics.retryA11yHint') whose  |
| `EXP-009` | `BUTTON_CONSISTENCY` | `app/(tabs)/explore.tsx` | retryButton and primaryButton share identical padding (10/20 vs 10) and borderRadius (10)  |
| `EXP-010` | `BUTTON_CONSISTENCY` | `app/(tabs)/explore.tsx` | Neither retryButton nor primaryButton visually communicates a disabled state; if the paren |
| `EXP-012` | `PERFORMANCE` | `app/(tabs)/explore.tsx` | Inline object literal `{ borderLeftColor: accent, borderLeftWidth: 3 }` is created on ever |
| `EXP-013` | `PERFORMANCE` | `app/(tabs)/explore.tsx` | The accent color for the coverage MetricCard is computed via a ternary chain directly in J |
| `IT-006` | `KEYBOARD` | `components/InfoTooltip.tsx` | The ⓘ button does not handle onKeyDown for Enter/Space on web, so keyboard-only users who  |
| `IT-007` | `KEYBOARD` | `components/InfoTooltip.tsx` | When the tooltip card appears on web it does not receive programmatic focus, so keyboard u |
| `IT-008` | `TOOLTIP_COPY` | `components/InfoTooltip.tsx` | The accessibilityHint for web ('Shows help information for this section') is generic and n |
| `IT-010` | `BUTTON_CONSISTENCY` | `components/InfoTooltip.tsx` | The native 'Got it ✓' close button uses a StyleSheet-defined style but has no pressed/disa |
| `IT-013` | `I18N_GAPS` | `components/InfoTooltip.tsx` | The default label prop value 'More information' and both accessibilityHint strings are har |
| `IT-014` | `PERFORMANCE` | `components/InfoTooltip.tsx` | estimateCardHeight() is called inside measureAndShow (which is a useCallback) on every inv |
| `SC-005` | `KEYBOARD` | `components/StreakCounter.tsx` | The Pressable is not focusable via keyboard on web because no focusable or tabIndex prop i |
| `SC-007` | `I18N_GAPS` | `components/StreakCounter.tsx` | Helper text including 'Longest streak:', 'Today is already counted.', and 'Log an action t |
| `SC-008` | `I18N_GAPS` | `components/StreakCounter.tsx` | Button label strings 'Logged for today' and 'Log today\'s progress' are hardcoded English. |
| `SC-009` | `BUTTON_CONSISTENCY` | `components/StreakCounter.tsx` | The disabled visual state uses only opacity: 0.7 with no colour or label change, which is  |
| `SC-010` | `PERFORMANCE` | `components/StreakCounter.tsx` | An inline style array [styles.logButton, isFresh && styles.logButtonDisabled] creates a ne |
| `LS-005` | `KEYBOARD` | `components/LanguageSelector.tsx` | On web, the overlay backdrop Pressable is not reachable or dismissible via Escape key; the |
| `LS-006` | `KEYBOARD` | `components/LanguageSelector.tsx` | The Modal does not trap focus on web; keyboard users can Tab behind the overlay to the und |
| `LS-007` | `KEYBOARD` | `components/LanguageSelector.tsx` | The trigger Pressable does not receive focus automatically on web when it is the primary i |
| `LS-008` | `PERFORMANCE` | `components/LanguageSelector.tsx` | ItemSeparatorComponent is declared as an inline arrow function returning JSX, causing a ne |
| `LS-009` | `PERFORMANCE` | `components/LanguageSelector.tsx` | The renderItem function is defined as an inline arrow function inside JSX, creating a new  |
| `WS-005` | `KEYBOARD` | `components/scheduler/WorkerSection.tsx` | Worker-form InputFields have no returnKeyType or onSubmitEditing chaining, so the keyboard |
| `WS-006` | `KEYBOARD` | `components/scheduler/WorkerSection.tsx` | Availability-form InputFields have no returnKeyType or onSubmitEditing chaining across wor |
| `WS-007` | `KEYBOARD` | `components/scheduler/WorkerSection.tsx` | No autoFocus on the first InputField of the add-worker form, requiring extra tab stops on  |
| `WS-008` | `BUTTON_CONSISTENCY` | `components/scheduler/WorkerSection.tsx` | The 'Assign Now' CTA uses a combined style array [styles.secondaryButton, styles.tightButt |
| `WS-009` | `BUTTON_CONSISTENCY` | `components/scheduler/WorkerSection.tsx` | None of the three Pressable buttons visually distinguish a disabled state; when the form i |
| `WS-010` | `PERFORMANCE` | `components/scheduler/WorkerSection.tsx` | The 'Assign Now' Pressable uses an inline arrow function that creates a new function refer |
| `CHK-005` | `KEYBOARD` | `components/scheduler/Checklist.tsx` | Pressable components are not guaranteed to be focusable via keyboard on web (Expo web); no |
| `CHK-006` | `TOOLTIP_COPY` | `components/scheduler/Checklist.tsx` | The accessibilityLabel key 'scheduler.onboarding.completedA11y' is ambiguous — it does not |
| `CHK-007` | `BUTTON_CONSISTENCY` | `components/scheduler/Checklist.tsx` | Inner flex View uses an inline object literal style `{ flex: 1, marginHorizontal: 10 }` wh |
| `CHK-008` | `BUTTON_CONSISTENCY` | `components/scheduler/Checklist.tsx` | Completed steps have no visual distinction (e.g., reduced opacity, different background) c |
| `CHK-009` | `EMPTY_STATES` | `components/scheduler/Checklist.tsx` | If `steps` is an empty array, the card renders with a title and progress bar but no items  |
| `WP-004` | `KEYBOARD` | `components/WellnessPrompt.tsx` | Neither Pressable sets tabIndex or accessible focus order hints, and on web there is no gu |
| `WP-005` | `BUTTON_CONSISTENCY` | `components/WellnessPrompt.tsx` | The two sibling buttons have inconsistent border radii: the shared 'button' style uses bor |
| `WP-006` | `BUTTON_CONSISTENCY` | `components/WellnessPrompt.tsx` | Neither button has a visually distinct disabled state; if onDismiss or onTakeBreak are und |
| `WP-007` | `I18N_GAPS` | `components/WellnessPrompt.tsx` | The subtitle string 'Time for a mindful pause' is a hardcoded English literal not wrapped  |
| `WP-008` | `I18N_GAPS` | `components/WellnessPrompt.tsx` | The body copy including the pluralised 'minute/minutes' label is hardcoded English and not |
| `PF-004` | `PERFORMANCE` | `components/PersonalizedFeed.tsx` | An inline arrow function is created on every render for each item's onPress, causing unnec |
| `PF-005` | `PERFORMANCE` | `components/PersonalizedFeed.tsx` | Math.round(Math.min(1, Math.max(0, item.score)) * 100) is recomputed inline on every rende |
| `PF-006` | `BUTTON_CONSISTENCY` | `components/PersonalizedFeed.tsx` | Pressable cards have no visual disabled state; if onSelectItem is undefined the card is st |
| `PF-007` | `BUTTON_CONSISTENCY` | `components/PersonalizedFeed.tsx` | Pressable has no pressed-state visual feedback (no style function variant or android_rippl |
| `PF-008` | `KEYBOARD` | `components/PersonalizedFeed.tsx` | On web, Pressable does not receive keyboard focus or trigger onPress via Enter/Space witho |
| `UB-005` | `TOOLTIP_COPY` | `components/UpgradeBanner.tsx` | outcomeCta string 'Auto-assign your whole team in one tap. Try Pro free 10 days →' exceeds |
| `UB-006` | `PERFORMANCE` | `components/UpgradeBanner.tsx` | openBilling is recreated on every render because it is defined as an inline arrow function |
| `UB-007` | `PERFORMANCE` | `components/UpgradeBanner.tsx` | The Pressable style prop uses an inline arrow function that constructs a new array on ever |
| `UB-008` | `BUTTON_CONSISTENCY` | `components/UpgradeBanner.tsx` | The trial banner is a plain View while the free-plan banner is a Pressable, creating incon |
| `EL-003` | `ACCESSIBILITY` | `components/ExternalLink.tsx` | target="_blank" has no rel equivalent to protect against reverse tabnapping; on web this i |
| `EL-004` | `KEYBOARD` | `components/ExternalLink.tsx` | The onPress handler uses event.preventDefault() but does not handle the keyboard Enter/Spa |
| `IF-003` | `KEYBOARD` | `components/scheduler/InputField.tsx` | No returnKeyType prop is accepted or forwarded, so the keyboard Return key defaults to 'de |
| `IF-004` | `KEYBOARD` | `components/scheduler/InputField.tsx` | No onSubmitEditing prop is exposed, preventing parent forms from chaining focus to the nex |
| `IF-005` | `KEYBOARD` | `components/scheduler/InputField.tsx` | No ref is forwarded from this component, making it impossible for parent forms to programm |
| `LRS-003` | `ACCESSIBILITY` | `components/scheduler/LostRevenueSummary.tsx` | The delta badge View has no accessibilityLabel; screen readers will read raw symbol-prefix |
| `LRS-004` | `BUTTON_CONSISTENCY` | `components/scheduler/LostRevenueSummary.tsx` | The negative delta falls back to styles.badge instead of a dedicated styles.negativeBadge, |
| `LRS-005` | `I18N_GAPS` | `components/scheduler/LostRevenueSummary.tsx` | "Lost revenue exposure" is a hardcoded English string not wrapped in a t() translation cal |
| `LRS-006` | `I18N_GAPS` | `components/scheduler/LostRevenueSummary.tsx` | The subtitle description string is hardcoded English and not wrapped in t(). |
| `ALT-002` | `PERFORMANCE` | `app/_layout.tsx` | The 'inner' JSX tree is reconstructed as a new object literal on every render of RootLayou |
| `ALT-003` | `PERFORMANCE` | `app/_layout.tsx` | The ThemeProvider 'value' prop receives a new object reference on every render because the |
| `ALT-004` | `PERFORMANCE` | `app/_layout.tsx` | useFonts is called unconditionally but the font object literal `{ SpaceMono: require(...)  |
| `SC-002` | `ACCESSIBILITY` | `components/SkeletonCard.tsx` | accessibilityRole 'progressbar' should be accompanied by accessibilityValue (min/max/now)  |
| `SC-003` | `ACCESSIBILITY` | `components/SkeletonCard.tsx` | The skeleton card is not marked as aria-busy, so assistive technologies on web will not kn |
| `SC-004` | `ACCESSIBILITY` | `components/SkeletonCard.tsx` | Individual Animated.View skeleton rows have no accessibilityElementsHidden/importantForAcc |
| `EB-002` | `ACCESSIBILITY` | `components/ErrorBoundary.tsx` | The error message text is rendered from error.message which may be a raw JS error string ( |
| `EB-004` | `BUTTON_CONSISTENCY` | `components/ErrorBoundary.tsx` | The retry Pressable has no disabled state and no visual feedback style; if onRetry is unde |
| `EB-005` | `BUTTON_CONSISTENCY` | `components/ErrorBoundary.tsx` | Pressable uses only a static StyleSheet object for its style prop, giving no pressed feedb |
| `EB-006` | `KEYBOARD` | `components/ErrorBoundary.tsx` | On Expo web, Pressable does not automatically receive a keyboard-focusable role; the retry |
| `TT-002` | `ACCESSIBILITY` | `components/ThemedText.tsx` | Text nodes with type='title' or type='subtitle' carry no accessibilityRole='header', so he |
| `TT-003` | `KEYBOARD` | `components/ThemedText.tsx` | Elements rendered with type='link' are not keyboard-focusable on web; a plain <Text> is no |
| `TT-004` | `BUTTON_CONSISTENCY` | `components/ThemedText.tsx` | The 'link' style hardcodes a color value (#0a7ea4) inline in the StyleSheet instead of sou |
| `PSV-002` | `ACCESSIBILITY` | `components/ParallaxScrollView.tsx` | The parallax header Animated.View wrapping headerImage has no accessibilityRole or accessi |
| `PSV-003` | `PERFORMANCE` | `components/ParallaxScrollView.tsx` | A new object literal is created on every render for contentContainerStyle, causing unneces |
| `PSV-004` | `PERFORMANCE` | `components/ParallaxScrollView.tsx` | An inline array literal is passed to the style prop of Animated.View on every render, crea |
| `HT-002` | `PERFORMANCE` | `components/HapticTab.tsx` | An inline arrow function is created on every render and passed as the onPressIn prop, prev |
| `HT-003` | `PERFORMANCE` | `components/HapticTab.tsx` | process.env.EXPO_OS is evaluated on every press event at runtime; it is a build-time const |
| `COL-002` | `ACCESSIBILITY` | `components/Collapsible.tsx` | The chevron IconSymbol is a decorative icon but has no accessibilityElementsHidden/importa |
| `COL-003` | `KEYBOARD` | `components/Collapsible.tsx` | On web, TouchableOpacity does not natively handle Enter/Space key activation; interactive  |
| `COL-004` | `BUTTON_CONSISTENCY` | `components/Collapsible.tsx` | The focused style applies borderWidth:2 and padding:4, which causes a layout shift (conten |
| `COL-005` | `BUTTON_CONSISTENCY` | `components/Collapsible.tsx` | headingFocused hardcodes Colors.light.tint as borderColor in the StyleSheet, overriding th |
| `SC-002` | `ACCESSIBILITY` | `components/scheduler/SectionCard.tsx` | ThemedText used as a section heading has no accessibilityRole='header', so screen readers  |
| `SC-003` | `TOOLTIP_COPY` | `components/scheduler/SectionCard.tsx` | The InfoTooltip label is constructed at render time as a template literal; if `title` is l |
| `SC-004` | `I18N_GAPS` | `components/scheduler/SectionCard.tsx` | The string 'Help for ' is hardcoded English and not wrapped in a t() translation call. |
| `SC-005` | `PERFORMANCE` | `components/scheduler/SectionCard.tsx` | An inline object literal is created on every render as the style prop for the inner View,  |
| `AL-002` | `ACCESSIBILITY` | `components/scheduler/AvailabilityLabel.tsx` | The muted time-range text '{from} - {to}' uses a plain hyphen-minus as a separator, which  |
| `AL-003` | `I18N_GAPS` | `components/scheduler/AvailabilityLabel.tsx` | The accessibilityLabel template string (once added) would be hardcoded English ('Available |
| `CB-001` | `ACCESSIBILITY` | `components/ConfettiBurst.tsx` | The confetti View has no accessibilityRole or accessibilityLabel, so screen readers may an |
| `CB-002` | `PERFORMANCE` | `components/ConfettiBurst.tsx` | The rotate interpolation object `{ inputRange, outputRange }` is recreated on every render |
| `CB-003` | `PERFORMANCE` | `components/ConfettiBurst.tsx` | An inline style object literal containing `backgroundColor`, `width`, and `height` is cons |
| `TV-001` | `PERFORMANCE` | `components/ThemedView.tsx` | A new object literal `{ backgroundColor }` is created on every render inside the style arr |

---

## Next Step: Onboarding Tour Architecture
See Phase 3 proposal. **No code changes until approved.**
