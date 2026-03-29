import { StyleSheet } from 'react-native';

export const schedulerStyles = StyleSheet.create({
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
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  onboardingStep: {
    paddingVertical: 6,
  },
  stepIndicator: {
    width: 30,
    height: 30,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F9FAFB',
  },
  stepIndicatorDone: {
    backgroundColor: '#DCFCE7',
    borderColor: '#22C55E',
  },
  stepIndicatorText: {
    fontWeight: '700',
    color: '#0F172A',
  },
  progressBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#EFF6FF',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  card: {
    borderRadius: 12,
    padding: 16,
    backgroundColor: '#ffffff11',
    gap: 12,
  },
  cardHeader: {
    gap: 2,
  },
  mutedText: {
    color: '#9CA3AF',
  },
  banner: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  dismissibleBanner: {
    gap: 8,
  },
  bannerSuccess: {
    backgroundColor: '#ECFDF3',
    borderColor: '#BBF7D0',
  },
  bannerError: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  bannerWarning: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  bannerText: {
    color: '#0F172A',
    fontWeight: '600',
  },
  bannerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dismissText: {
    color: '#4B5563',
    fontWeight: '600',
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
    backgroundColor: '#eef2ff',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#e0f2fe',
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  positiveBadge: {
    backgroundColor: '#dcfce7',
  },
  badgeText: {
    fontWeight: '700',
  },
  successText: {
    color: '#15803D',
  },
  linkText: {
    color: '#2563EB',
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
    backgroundColor: '#16a34a',
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
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
    color: '#111827',
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
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#F8FAFC',
  },
  fallbackBadge: {
    backgroundColor: '#f3f4f6',
  },
  toggleChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  toggleChipActive: {
    backgroundColor: '#111827',
    borderColor: '#111827',
  },
  toggleChipText: {
    color: '#111827',
    fontWeight: '600',
  },
  toggleChipTextActive: {
    color: '#ffffff',
  },
  actionButton: {
    flex: 1,
  },
  helperText: {
    flex: 1,
  },
  primaryButton: {
    backgroundColor: '#2563EB',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  secondaryButton: {
    backgroundColor: '#111827',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  tightButton: {
    paddingVertical: 10,
  },
  disabledButton: {
    opacity: 0.6,
  },
  divider: {
    height: 1,
    backgroundColor: '#E5E7EB',
    marginVertical: 4,
  },
  lossSummary: {
    gap: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#0b1224',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  progressTrack: {
    height: 10,
    borderRadius: 999,
    backgroundColor: '#E5E7EB',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#2563EB',
  },
  errorText: {
    color: '#DC2626',
  },
  rosterDay: {
    gap: 8,
  },
  rosterRow: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderColor: '#E5E7EB',
    gap: 4,
  },
  status: {
    color: '#065f46',
    fontWeight: '600',
  },
  draftStatus: {
    color: '#92400e',
  },
  publishedStatus: {
    color: '#15803d',
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
    backgroundColor: '#111827',
  },
  actionChipPrimary: {
    backgroundColor: '#2563EB',
  },
  actionChipText: {
    color: '#FFFFFF',
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
    borderColor: '#E5E7EB',
    gap: 8,
  },
  ghostBlock: {
    gap: 6,
    flex: 1,
  },
  ghostNameBar: {
    height: 13,
    borderRadius: 6,
    backgroundColor: '#9CA3AF',
    width: '55%',
  },
  ghostRoleBar: {
    height: 11,
    borderRadius: 6,
    backgroundColor: '#D1D5DB',
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
    backgroundColor: '#E5E7EB',
  },
  ghostBadgeBar: {
    height: 22,
    width: 72,
    borderRadius: 8,
    backgroundColor: '#D1D5DB',
  },
  ghostTimeBar: {
    height: 11,
    borderRadius: 6,
    backgroundColor: '#D1D5DB',
    width: '60%',
  },
  ghostEmptyCta: {
    marginTop: 8,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#0D9488',
    borderStyle: 'dashed',
  },
  ghostEmptyCtaText: {
    color: '#0D9488',
    fontWeight: '600',
    fontSize: 13,
  },
  ghostEmptyNote: {
    fontSize: 11,
    color: '#9CA3AF',
    textAlign: 'center',
    marginTop: 4,
  },
});
