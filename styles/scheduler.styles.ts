import { StyleSheet } from 'react-native';
import { Colors, brand, ThemeColors } from '@/constants/Colors';

export const makeSchedulerStyles = (colors: ThemeColors) => StyleSheet.create({
  screenContainer: {
    flex: 1,
    position: 'relative',
  },
  container: {
    padding: 16,
    gap: 12,
  },
  pageTitle: {
    marginBottom: 4,
  },
  onboardingCard: {
    borderRadius: 12,
    padding: 14,
    gap: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  onboardingStep: {
    paddingVertical: 6,
  },
  stepIndicator: {
    width: 30,
    height: 30,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  stepIndicatorDone: {
    backgroundColor: colors.successSurface,
    borderColor: colors.success,
  },
  stepIndicatorText: {
    fontWeight: '700',
    color: colors.text,
  },
  progressBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: brand.proSurface,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: brand.proLight,
  },
  card: {
    borderRadius: 12,
    padding: 16,
    backgroundColor: colors.surface,
    gap: 12,
  },
  cardHeader: {
    gap: 2,
  },
  mutedText: {
    color: colors.textSecondary, // Slate 600 light / Slate 400 dark — both pass AA
  },
  banner: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: brand.proSurface,
    borderWidth: 1,
    borderColor: brand.proLight,
  },
  dismissibleBanner: {
    gap: 8,
  },
  bannerSuccess: {
    backgroundColor: colors.successSurface,
    borderColor: colors.success,
  },
  bannerError: {
    backgroundColor: colors.errorSurface,
    borderColor: colors.error,
  },
  bannerWarning: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warning,
  },
  bannerText: {
    color: colors.text,
    fontWeight: '600',
  },
  bannerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dismissText: {
    color: colors.textSecondary,
    fontWeight: '600',
  },
  dismissButton: {
    padding: 6,
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  rowContent: {
    gap: 4,
    flex: 1,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  tag: {
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 12,
    minHeight: 44,
    justifyContent: 'center',
  },
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: colors.successSurface,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  positiveBadge: {
    backgroundColor: colors.successSurface,
  },
  badgeText: {
    fontWeight: '700',
    color: colors.text,
  },
  successText: {
    color: colors.success,
  },
  linkText: {
    color: brand.pro,
    fontWeight: '600',
  },
  securedBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  securedDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.success,
  },
  availabilityList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'flex-end',
  },
  inputGroup: {
    flex: 1,
    gap: 6,
  },
  label: {
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.surface,
    color: colors.text,
  },
  inlineInputs: {
    flexDirection: 'row',
    gap: 10,
  },
  inlineActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  fallbackCard: {
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    backgroundColor: colors.background,
  },
  fallbackBadge: {
    backgroundColor: colors.surfaceRaised,
  },
  toggleChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 44,
    justifyContent: 'center',
  },
  toggleChipActive: {
    backgroundColor: colors.text,
    borderColor: colors.text,
  },
  toggleChipText: {
    color: colors.text,
    fontWeight: '600',
  },
  toggleChipTextActive: {
    color: colors.surface,
  },
  actionButton: {
    flex: 1,
  },
  helperText: {
    flex: 1,
  },
  primaryButton: {
    backgroundColor: brand.pro,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: colors.surface,
    fontWeight: '700',
  },
  secondaryButton: {
    backgroundColor: colors.text,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  tightButton: {
    paddingVertical: 10,
  },
  disabledButton: {
    opacity: 0.4,
    backgroundColor: colors.border,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 4,
  },
  lossSummary: {
    gap: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  progressTrack: {
    height: 10,
    borderRadius: 999,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: brand.pro,
  },
  errorText: {
    color: colors.error,
  },
  rosterDay: {
    gap: 8,
  },
  rosterRow: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderColor: colors.border,
    gap: 4,
  },
  status: {
    color: colors.success,
    fontWeight: '600',
  },
  draftStatus: {
    color: colors.warning,
  },
  publishedStatus: {
    color: colors.success,
  },
  rosterActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  actionChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.text,
  },
  actionChipPrimary: {
    backgroundColor: brand.pro,
  },
  actionChipText: {
    color: colors.surface,
    fontWeight: '700',
  },
  statusPill: {
    alignItems: 'flex-end',
    gap: 4,
  },
  // ── Ghost / preview empty-state styles ────────────────────────────────────
  ghostContainer: {
    gap: 10,
    opacity: 0.4,
    pointerEvents: 'none',
  },
  ghostRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderColor: colors.border,
    gap: 8,
  },
  ghostBlock: {
    gap: 6,
    flex: 1,
  },
  ghostNameBar: {
    height: 13,
    borderRadius: 6,
    backgroundColor: colors.border, // Slate 300 — softer skeleton fill (was #9CA3AF)
    width: '55%',
  },
  ghostRoleBar: {
    height: 11,
    borderRadius: 6,
    backgroundColor: colors.border,
    width: '35%',
  },
  ghostTagRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 2,
  },
  ghostTag: {
    height: 18,
    width: 48,
    borderRadius: 10,
    backgroundColor: colors.border,
  },
  ghostBadgeBar: {
    height: 22,
    width: 72,
    borderRadius: 8,
    backgroundColor: colors.border,
  },
  ghostTimeBar: {
    height: 11,
    borderRadius: 6,
    backgroundColor: colors.border,
    width: '60%',
  },
  ghostEmptyCta: {
    marginTop: 8,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.tint,
    borderStyle: 'dashed',
  },
  ghostEmptyCtaText: {
    color: brand.primaryDeep,
    fontWeight: '600',
    fontSize: 16,
  },
  ghostEmptyNote: {
    fontSize: 14, // raised from 11px (below legible minimum) — 14px improves ambient-light legibility
    color: colors.textSecondary, // ensures dark-mode contrast passes AA (was #64748B hardcoded)
    textAlign: 'center',
    marginTop: 4,
  },
});

// Backward-compatible static export for sub-components that receive styles via
// the shared schedulerStyles reference. Color-critical styles are overridden
// inline per-component using makeLocalStyles(colors). For the main scheduler
// screen, prefer makeSchedulerStyles(colors) with live useColorScheme() values.
export const schedulerStyles = makeSchedulerStyles(Colors.light);