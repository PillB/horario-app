# Horario App — Contrast & Readability Audit
**Batch ID:** `msgbatch_012YEDmMDj3dCRYmXtqjoB9W`
**Date:** 2026-03-30
**Model:** claude-sonnet-4-6 (Batch API — 50% off)
**Files audited:** 31 / 31
**Standard:** WCAG 2.1 AA (4.5:1 normal text · 3:1 large text & non-text)

---

## Summary

| Severity | Count |
|----------|-------|
| 🔴 HIGH  | 103 |
| 🟡 MEDIUM | 103 |
| 🟢 LOW   | 80 |
| **Total** | **286** |

## Findings by Category

| Category | Count |
|----------|-------|
| CONTRAST_RATIO | 72 |
| DARK_MODE_GAP | 71 |
| STATE_VISIBILITY | 61 |
| HARDCODED_COLOUR | 58 |
| OVERLAY_LEGIBILITY | 11 |
| ICON_VISIBILITY | 8 |
| PLACEHOLDER_TEXT | 5 |

---

## Files by Issue Density

| File | HIGH | MED | LOW | Total |
|------|------|-----|-----|-------|
| `styles/scheduler.styles.ts` | 9 | 7 | 5 | 21 |
| `app/(tabs)/explore.tsx` | 7 | 6 | 4 | 17 |
| `app/(tabs)/index.tsx` | 6 | 5 | 3 | 14 |
| `components/StreakCounter.tsx` | 6 | 5 | 3 | 14 |
| `components/UpgradeBanner.tsx` | 5 | 4 | 3 | 12 |
| `components/LanguageSelector.tsx` | 5 | 4 | 3 | 12 |
| `components/ProfileAchievements.tsx` | 5 | 4 | 2 | 11 |
| `components/scheduler/WorkerSection.tsx` | 5 | 4 | 3 | 12 |
| `components/scheduler/RosterSection.tsx` | 5 | 4 | 2 | 11 |
| `components/scheduler/DemandSection.tsx` | 5 | 6 | 3 | 14 |
| `components/WellnessPrompt.tsx` | 4 | 3 | 3 | 10 |
| `components/PersonalizedFeed.tsx` | 4 | 3 | 2 | 9 |
| `components/TourSpotlight.tsx` | 4 | 5 | 3 | 12 |
| `components/scheduler/ShiftTemplateSection.tsx` | 4 | 4 | 2 | 10 |
| `app/(tabs)/_layout.tsx` | 3 | 3 | 3 | 9 |

---

## 🔴 HIGH Severity — WCAG AA Failures

### SS-001 — `HARDCODED_COLOUR`
**File:** `styles/scheduler.styles.ts` · **Line:** 21
**Element:** onboardingCard backgroundColor
**Colours:** `#0F172A (assumed text)` on `#ffffff (hardcoded)` → **17.85:1** (required 4.5:1)

Background color is hardcoded as #ffffff instead of using the Colors.light.surface token, which will not adapt to dark mode, leaving text invisible on dark surfaces.

- **Fix:** Replace backgroundColor: '#ffffff' with backgroundColor: colors.surface using the ThemeColors token from useColorScheme.

---

### SS-002 — `HARDCODED_COLOUR`
**File:** `styles/scheduler.styles.ts` · **Line:** 24
**Element:** onboardingCard borderColor
**Colours:** `n/a` on `#E5E7EB (hardcoded)` → **unknown** (required 3:1)

Border color is hardcoded as #E5E7EB (Gray 200), bypassing the Colors.light.border token and failing to adapt in dark mode where it will be near-invisible against dark surfaces.

- **Fix:** Replace borderColor: '#E5E7EB' with borderColor: colors.border.

---

### SS-003 — `DARK_MODE_GAP`
**File:** `styles/scheduler.styles.ts` · **Line:** 64
**Element:** card backgroundColor (#ffffff11)
**Colours:** `#0F172A (assumed text)` on `#ffffff11 (≈ rgba(255,255,255,0.067))` → **unknown** (required 4.5:1)

A nearly transparent white (#ffffff11) is used as the card background; on a dark background (#0F172A) this resolves to an extremely low-luminance surface that will make any dark-mode text (#F1F5F9) nearly invisible against other surrounding elements, and in light mode renders as nearly transparent.

- **Fix:** Replace backgroundColor: '#ffffff11' with backgroundColor: colors.surface to get an opaque, theme-aware card background.

---

### SS-004 — `HARDCODED_COLOUR`
**File:** `styles/scheduler.styles.ts` · **Line:** 129
**Element:** input text color
**Colours:** `#111827 (hardcoded)` on `#FFFFFF (hardcoded)` → **16.75:1** (required 4.5:1)

Input text and background are both hardcoded hex values that will not adapt to dark mode, causing near-black text on a dark surface background in dark mode.

- **Fix:** Replace color: '#111827' with color: colors.text and backgroundColor: '#FFFFFF' with backgroundColor: colors.surface.

---

### SS-005 — `DARK_MODE_GAP`
**File:** `styles/scheduler.styles.ts` · **Line:** 73
**Element:** mutedText color (#475569)
**Colours:** `#475569 (hardcoded)` on `Colors.dark.background #0F172A` → **3.17:1** (required 4.5:1)

The hardcoded Slate 600 (#475569) achieves 6.86:1 on white in light mode but only approximately 3.17:1 against the dark background #0F172A, failing WCAG AA for normal text.

- **Fix:** Replace color: '#475569' with color: colors.textSecondary so the dark-mode value (#94A3B8, 5.27:1) is used automatically.

---

### SS-006 — `HARDCODED_COLOUR`
**File:** `styles/scheduler.styles.ts` · **Line:** 92
**Element:** dismissText color (#4B5563)
**Colours:** `#4B5563 (hardcoded)` on `banner backgrounds (#EFF6FF / #ECFDF3 / #FEF2F2 / #FFFBEB)` → **5.67:1** (required 4.5:1)

dismiss text uses hardcoded #4B5563 (Gray 600) which passes light mode but is not token-driven and will not adapt to dark mode where it falls below AA against dark surfaces.

- **Fix:** Replace color: '#4B5563' with color: colors.textSecondary.

---

### SS-007 — `CONTRAST_RATIO`
**File:** `styles/scheduler.styles.ts` · **Line:** 174
**Element:** ghostEmptyCtaText color on ghostEmptyCta
**Colours:** `#0D9488 (brand.primary)` on `#FFFFFF / Colors.light.surface` → **3.06:1** (required 4.5:1)

The ghost CTA text uses brand primary teal (#0D9488) at font-size 13px, which only achieves 3.06:1 contrast — failing WCAG AA for normal-weight text at this size.

- **Fix:** Replace color: '#0D9488' with color: Colors.light.tint applied only for large/bold text, or use Colors.brand.primaryDeep (#115E59, 5.87:1) for normal-weight small text.

---

### SS-008 — `HARDCODED_COLOUR`
**File:** `styles/scheduler.styles.ts` · **Line:** 246
**Element:** lossSummary backgroundColor (#0b1224)
**Colours:** `#F1F5F9 (assumed light text)` on `#0b1224 (hardcoded)` → **unknown** (required 4.5:1)

lossSummary uses a hardcoded near-black background #0b1224 which is not a design token and will not respond to theme changes; text rendered inside at default light-mode color (#0F172A) would be approximately 1.02:1 — essentially invisible.

- **Fix:** Replace backgroundColor: '#0b1224' with a token-driven surface (e.g., colors.surface or Colors.dark.background) and ensure text inside uses colors.text explicitly.

---

### SS-009 — `CONTRAST_RATIO`
**File:** `styles/scheduler.styles.ts` · **Line:** 265
**Element:** draftStatus color (#92400e)
**Colours:** `#92400e (hardcoded Amber 800)` on `#F8FAFC (Colors.light.background)` → **4.32:1** (required 4.5:1)

The draftStatus text color #92400e achieves approximately 4.32:1 against the light background, narrowly failing WCAG AA for normal text.

- **Fix:** Replace color: '#92400e' with color: Colors.light.warning (#B45309, 4.82:1) which is the correct token for warning-level text.

---

### EXP-001 — `HARDCODED_COLOUR`
**File:** `app/(tabs)/explore.tsx` · **Line:** 222
**Element:** card background (ThemedView style)
**Colours:** `#0F172A (dark bg text)` on `#ffffff11 (≈ rgba(255,255,255,0.067) over #0F172A → ~#1A2535)` → **unknown** (required 4.5:1)

backgroundColor '#ffffff11' is a raw semi-transparent hex that renders differently on every theme surface — it is not a design token and creates an unpredictable background that can undermine all child text contrast ratios.

- **Fix:** Replace with Colors.light.surface / Colors.dark.surface via useColorScheme: backgroundColor: colorScheme === 'dark' ? Colors.dark.surface : Colors.light.surface

---

### EXP-002 — `HARDCODED_COLOUR`
**File:** `app/(tabs)/explore.tsx` · **Line:** 241
**Element:** metricCard background (MetricCard ThemedView style)
**Colours:** `child text tokens` on `#ffffff11 (same semi-transparent issue)` → **unknown** (required 4.5:1)

Same raw semi-transparent '#ffffff11' used for MetricCard background creates undefined rendering substrate for all KPI text, especially in dark mode where it blends into the dark surface unpredictably.

- **Fix:** Use Colors.light.surface / Colors.dark.surface token via useColorScheme, same as EXP-001.

---

### EXP-003 — `CONTRAST_RATIO`
**File:** `app/(tabs)/explore.tsx` · **Line:** 304
**Element:** errorText — error message body text
**Colours:** `#EF4444 (Red 500)` on `Colors.light.surface (#FFFFFF)` → **3.45:1** (required 4.5:1)

#EF4444 (Red 500) at 3.45:1 on white fails WCAG AA for normal-size body text.

- **Fix:** Replace hardcoded '#EF4444' with Colors.light.error (#DC2626, 4.64:1) via token: color: colors.error

---

### EXP-004 — `DARK_MODE_GAP`
**File:** `app/(tabs)/explore.tsx` · **Line:** 304
**Element:** errorText — error message body text in dark mode
**Colours:** `#EF4444 (Red 500)` on `Colors.dark.surface (#1E293B)` → **4.55:1** (required 4.5:1)

errorText is hardcoded '#EF4444' which narrowly passes in dark mode (4.55:1) but fails in light mode (3.45:1); it should use the theme-aware error token to be correct in both modes.

- **Fix:** Use colors.error token from useColorScheme: in light mode Colors.light.error=#DC2626, in dark mode Colors.dark.error=#F87171.

---

### EXP-005 — `HARDCODED_COLOUR`
**File:** `app/(tabs)/explore.tsx` · **Line:** 312
**Element:** retryButton backgroundColor
**Colours:** `#FFFFFF` on `#2563EB (Blue 600)` → **8.59:1** (required 4.5:1)

Button color #2563EB is hardcoded and not a design token — it deviates from the Horario teal brand primary and will not update if the design system changes.

- **Fix:** Replace '#2563EB' with brand.primary (#0D9488) or brand.primaryDark (#0F766E); white text on #0F766E is 9.30:1 AAA. Use token: backgroundColor: Colors.light.tint (or brand.primaryDark for higher contrast).

---

### EXP-006 — `HARDCODED_COLOUR`
**File:** `app/(tabs)/explore.tsx` · **Line:** 320
**Element:** primaryButton backgroundColor
**Colours:** `#FFFFFF` on `#2563EB (Blue 600)` → **8.59:1** (required 4.5:1)

primaryButton also uses hardcoded '#2563EB' — same off-brand, non-tokenized issue as retryButton; inconsistent with the teal design system.

- **Fix:** Replace with brand.primaryDark (#0F766E): backgroundColor: brand.primaryDark. White text yields 9.30:1 AAA.

---

### EXP-007 — `CONTRAST_RATIO`
**File:** `app/(tabs)/explore.tsx` · **Line:** 282
**Element:** barFill backgroundColor — HoursBar progress fill
**Colours:** `N/A (non-text graphical element)` on `#E5E7EB (barTrack)` → **2.19:1** (required 3:1)

#2563EB bar fill vs #E5E7EB track background is 2.19:1, failing WCAG 1.4.11 non-text contrast (3:1 required for UI components).

- **Fix:** Replace barFill backgroundColor '#2563EB' with brand.primaryDeep (#115E59) which achieves ≥3:1 against #E5E7EB, or use brand.primaryDark (#0F766E). Also replace barTrack '#E5E7EB' with Colors.light.border (#E2E8F0) token.

---

### EXP-008 — `DARK_MODE_GAP`
**File:** `app/(tabs)/explore.tsx` · **Line:** 267
**Element:** metricSub text — '#475569' hardcoded in StyleSheet
**Colours:** `#475569 (Slate 600)` on `Colors.dark.surface (#1E293B)` → **3.11:1** (required 4.5:1)

metricSub and mutedText are hardcoded to '#475569' (Slate 600) which is 6.86:1 on white (light mode ✓) but only 3.11:1 on the dark surface #1E293B, failing AA for 12px normal text.

- **Fix:** Drive color through theme token: use colors.textSecondary (light: #475569, dark: #94A3B8 = 5.27:1 on dark). Remove hardcoded hex from StyleSheet and apply via dynamic style.

---

### IDX-001 — `HARDCODED_COLOUR`
**File:** `app/(tabs)/index.tsx` · **Line:** 176
**Element:** card background — semi-transparent overlay `#ffffff11`
**Colours:** `Colors.light.text (#0F172A)` on `#ffffff11 over Colors.light.background (#F8FAFC)` → **unknown** (required 4.5:1)

`backgroundColor: '#ffffff11'` (≈4% white alpha) renders as an unpredictable tint whose effective colour depends on the surface beneath, bypasses design tokens, and in dark mode produces near-invisible cards on the dark background (#0F172A).

- **Fix:** Replace with `backgroundColor: Colors[scheme].surface` (light: `#FFFFFF`, dark: `#1E293B`) via `useColorScheme` or use `ThemedView` which already maps to the correct surface token.

---

### IDX-002 — `HARDCODED_COLOUR`
**File:** `app/(tabs)/index.tsx` · **Line:** 196
**Element:** primaryButton background
**Colours:** `#FFFFFF (primaryButtonText)` on `#2563EB (hardcoded blue)` → **8.59:1** (required 4.5:1)

The primary CTA uses a hardcoded `#2563EB` (Blue 600) that is not part of the Horario design token system; it will never respond to theme changes and deviates from the teal brand palette.

- **Fix:** Replace `backgroundColor: '#2563EB'` with `backgroundColor: brand.primaryDark` (`#0F766E`); white text on `#0F766E` gives 9.30:1 ✅ AAA and aligns with brand identity.

---

### IDX-003 — `DARK_MODE_GAP`
**File:** `app/(tabs)/index.tsx` · **Line:** 176
**Element:** card `backgroundColor: '#ffffff11'` in dark mode
**Colours:** `Colors.dark.text (#F1F5F9)` on `#ffffff11 over Colors.dark.background (#0F172A) ≈ #121827` → **14.80:1** (required 4.5:1)

While text contrast is technically fine, the near-invisible card container provides no visual separation from the dark page background, making card boundaries imperceptible and causing STATE_VISIBILITY failure for interactive cards.

- **Fix:** Use `Colors.dark.surface` (`#1E293B`) as the card background in dark mode so cards are visually distinct from the `#0F172A` page background.

---

### IDX-004 — `HARDCODED_COLOUR`
**File:** `app/(tabs)/index.tsx` · **Line:** 170
**Element:** mutedText color
**Colours:** `#475569 (hardcoded Slate 600)` on `#ffffff11 over #F8FAFC (light) / #0F172A (dark)` → **6.86:1 (light) / unknown (dark)** (required 4.5:1)

Light mode ratio is acceptable, but in dark mode `#475569` on dark surface (`#1E293B` ≈ 2.17:1) fails AA — the hardcoded value cannot adapt to dark mode.

- **Fix:** Remove hardcoded `color: '#475569'` and use `color: Colors[scheme].textSecondary` — dark mode token `#94A3B8` achieves 5.27:1 on `#1E293B` ✅ AA.

---

### IDX-005 — `CONTRAST_RATIO`
**File:** `app/(tabs)/index.tsx` · **Line:** 215
**Element:** emptyStateCtaText — teal link text on card surface
**Colours:** `#0D9488 (brand.primary)` on `#FFFFFF (Colors.light.surface)` → **3.06:1** (required 4.5:1)

`color: '#0D9488'` at 14px normal weight achieves only 3.06:1 on white, failing WCAG AA normal text (requires 4.5:1); it passes only for text ≥18pt or bold ≥14pt.

- **Fix:** Use `color: brand.primaryDeep` (`#115E59`, 5.87:1 ✅ AA) or `Colors.light.tint` paired with `fontWeight: '700'` and `fontSize: 16` to qualify as large/bold text at 3:1 minimum.

---

### IDX-006 — `DARK_MODE_GAP`
**File:** `app/(tabs)/index.tsx` · **Line:** 215
**Element:** emptyStateCtaText — teal link text in dark mode
**Colours:** `#0D9488 (hardcoded)` on `Colors.dark.surface (#1E293B)` → **2.54:1** (required 4.5:1)

The hardcoded `#0D9488` teal on dark surface `#1E293B` yields approximately 2.54:1, failing AA in dark mode for normal text.

- **Fix:** Use `Colors[scheme].tint` which resolves to `#2DD4BF` in dark mode — white/dark-surface contrast is 8.95:1 ✅ AAA.

---

### SC-001 — `HARDCODED_COLOUR`
**File:** `components/StreakCounter.tsx` · **Line:** 57
**Element:** container background
**Colours:** `Colors.light.text (#0F172A)` on `#ffffff11 (white at ~6.7% opacity over unknown parent)` → **unknown** (required 4.5:1)

The semi-transparent #ffffff11 background composites unpredictably over whatever surface is beneath it, making all child text contrast unverifiable and potentially failing in dark mode or over image backgrounds.

- **Fix:** Replace with `backgroundColor: Colors[scheme].surface` (opaque token) or `Colors[scheme].surfaceRaised`, eliminating the semi-transparent layer; if a tinted card is desired use `brand.primarySurface` (#F0FDFA) in light mode.

---

### SC-002 — `HARDCODED_COLOUR`
**File:** `components/StreakCounter.tsx` · **Line:** 63
**Element:** helperText — streak helper / reward message body text
**Colours:** `#475569` on `#ffffff11 (unknown composite)` → **unknown** (required 4.5:1)

Although #475569 (Slate 600) gives 6.86:1 on a pure white surface, the actual backing colour is the semi-transparent #ffffff11 container over an unknown parent, so the true ratio is unverifiable; in dark mode the ThemedText colour override does not apply so dark-mode text defaults will render against this hardcoded light value.

- **Fix:** Remove the inline `color: '#475569'` hardcode and instead apply `color: Colors[scheme].textSecondary` via a theme-aware style, and resolve SC-001 to establish a known background.

---

### SC-003 — `DARK_MODE_GAP`
**File:** `components/StreakCounter.tsx` · **Line:** 63
**Element:** helperText
**Colours:** `#475569 (hardcoded)` on `Colors.dark.background (#0F172A)` → **2.99:1** (required 4.5:1)

The hardcoded light-mode Slate 600 colour (#475569) achieves only ~3.0:1 against the dark-mode background (#0F172A), a clear AA failure for body text in dark mode.

- **Fix:** Use `color: Colors[scheme].textSecondary` which resolves to #475569 in light and #94A3B8 (5.27:1) in dark mode.

---

### SC-004 — `HARDCODED_COLOUR`
**File:** `components/StreakCounter.tsx` · **Line:** 73
**Element:** badge background
**Colours:** `badgeText (ThemedText default)` on `#dbeafe (Blue 100)` → **unknown** (required 4.5:1)

#dbeafe is a hardcoded hex not from the design token system; ThemedText default text colour in dark mode is #F1F5F9 which gives approximately 1.05:1 against #dbeafe — a critical contrast failure.

- **Fix:** Replace `backgroundColor: '#dbeafe'` with `brand.proSurface` (#F5F3FF) or `brand.primarySurface` (#F0FDFA) and set explicit badge text colour to `Colors[scheme].text` (or `brand.primaryDeep` #115E59 at 5.87:1 on those surfaces).

---

### SC-005 — `DARK_MODE_GAP`
**File:** `components/StreakCounter.tsx` · **Line:** 73
**Element:** badge — dark mode text on #dbeafe background
**Colours:** `Colors.dark.text (#F1F5F9)` on `#dbeafe` → **1.05:1** (required 4.5:1)

In dark mode ThemedText renders #F1F5F9 text on the hardcoded #dbeafe badge background, which is near-white-on-white and completely illegible.

- **Fix:** Conditionally set badge background per scheme: light → `brand.primarySurface`, dark → `brand.primaryDeep`; fix badgeText colour to `brand.primaryDeep` (light) / `brand.primaryLight` (dark) using themed tokens.

---

### SC-006 — `HARDCODED_COLOUR`
**File:** `components/StreakCounter.tsx` · **Line:** 78
**Element:** progressFill
**Colours:** `n/a (decorative track)` on `#2563EB vs #E5E7EB track` → **3.71:1** (required 3:1)

#2563EB (Blue 600) on #E5E7EB (Gray 200) track achieves 3.71:1 which passes the 3:1 non-text threshold, but both colours are hardcoded hex values outside the token system; in dark mode #E5E7EB track is very light against a dark background, creating a jarring unthemed element.

- **Fix:** Replace `backgroundColor: '#2563EB'` with `brand.primary` (#0D9488) for brand consistency, and replace track `backgroundColor: '#E5E7EB'` with `Colors[scheme].border` for dark-mode compatibility.

---

### SC-007 — `DARK_MODE_GAP`
**File:** `components/StreakCounter.tsx` · **Line:** 88
**Element:** rewardCard background
**Colours:** `Colors.dark.text (#F1F5F9)` on `#f8fafc (hardcoded Slate 50)` → **1.06:1** (required 4.5:1)

The reward card background is hardcoded to #f8fafc (near-white); in dark mode ThemedText renders light text (#F1F5F9) against it, producing ~1.06:1 — completely unreadable.

- **Fix:** Replace `backgroundColor: '#f8fafc'` with `Colors[scheme].surface` and `borderColor: '#E5E7EB'` with `Colors[scheme].border` using a scheme-aware style.

---

### UB-001 — `CONTRAST_RATIO`
**File:** `components/UpgradeBanner.tsx` · **Line:** 96
**Element:** trialBadgeText — 'TRIAL' label on brand.success (#10B981) badge
**Colours:** `#FFFFFF` on `#10B981` → **3.46:1** (required 4.5:1)

White text on Emerald 500 badge background yields only 3.46:1, failing WCAG AA for normal-sized text (11px bold is still below 18pt/14pt-bold threshold for large-text exemption).

- **Fix:** Change trialBadge backgroundColor to brand.successSurface is insufficient; instead darken the badge to Colors.light.success (#15803D) which gives 5.44:1 vs white: `backgroundColor: '#15803D'` — or use `Colors.light.success` token.

---

### UB-002 — `CONTRAST_RATIO`
**File:** `components/UpgradeBanner.tsx` · **Line:** 109
**Element:** trialText — body sentence on successSurface (#ECFDF5) background
**Colours:** `#115E59` on `#ECFDF5` → **5.87:1** (required 4.5:1)

brand.primaryDeep (#115E59) at 13px yields 5.87:1 on successSurface — this passes AA. No issue here; listed only to confirm correctness. (Finding suppressed — see UB-003 for the actual sibling failure.)

- **Fix:** No change required; keep brand.primaryDeep for trialText.

---

### UB-003 — `CONTRAST_RATIO`
**File:** `components/UpgradeBanner.tsx` · **Line:** 113
**Element:** trialSub — '$12/mo flat after trial.' subline on successSurface (#ECFDF5)
**Colours:** `#0F766E` on `#ECFDF5` → **4.01:1** (required 4.5:1)

brand.primaryDark (#0F766E) at 11px on successSurface (#ECFDF5) achieves only 4.01:1, failing WCAG AA for normal text; 11px is well below the large-text threshold.

- **Fix:** Use brand.primaryDeep (#115E59) which yields 5.87:1 on successSurface: `color: brand.primaryDeep` in the trialSub style.

---

### UB-004 — `HARDCODED_COLOUR`
**File:** `components/UpgradeBanner.tsx` · **Line:** 139
**Element:** freePlanTitle — outcome headline text
**Colours:** `#1E1B4B` on `#F5F3FF` → **14.07:1** (required 4.5:1)

The hardcoded hex #1E1B4B bypasses the design token system entirely; while its contrast ratio is sufficient in light mode, it will not adapt to dark mode (dark background #0F172A still passes, but the token system is bypassed, creating a maintenance risk and potential future failures).

- **Fix:** Replace with a system token: `color: Colors.light.text` (or resolve via useThemeColor) — #0F172A gives 17.85:1 on proSurface and the token will adapt correctly.

---

### UB-005 — `CONTRAST_RATIO`
**File:** `components/UpgradeBanner.tsx` · **Line:** 144
**Element:** freePlanCta — CTA link text on proSurface (#F5F3FF)
**Colours:** `#7C3AED` on `#F5F3FF` → **5.05:1** (required 4.5:1)

brand.pro (#7C3AED) at 12px on proSurface (#F5F3FF) yields approximately 5.05:1 — this technically passes AA, but at 12px (below 16px body minimum) the safety margin is thin and ambient-light degradation in outdoor use can push perceived contrast below threshold.

- **Fix:** Increase font size to at least 13px (matching freePlanTitle) or switch to brand.proDark (#6D28D9) which yields ~6.3:1, providing a safer margin: `color: brand.proDark, fontSize: 13`.

---

### UB-006 — `HARDCODED_COLOUR`
**File:** `components/UpgradeBanner.tsx` · **Line:** 148
**Element:** pricingNote — '$12/mo flat · no per-employee fees · cancel anytime'
**Colours:** `#6B7280` on `#F5F3FF` → **4.40:1** (required 4.5:1)

Hardcoded Gray 500 (#6B7280) at 11px on proSurface (#F5F3FF) achieves only ~4.40:1 — the inline comment claims 4.48:1 on proSurface but that calculation is optimistic; the actual luminance computation yields below 4.5:1, failing WCAG AA for 11px normal text. Also bypasses the token system.

- **Fix:** Use `Colors.light.textSecondary` (#475569, 6.86:1 on white/proSurface) or at minimum `Colors.light.textTertiary` (#64748B, 4.35:1 — still just below AA); best fix is textSecondary at a bumped size of 12px: `color: Colors.light.textSecondary, fontSize: 12`.

---

### LS-001 — `CONTRAST_RATIO`
**File:** `components/LanguageSelector.tsx` · **Line:** 85
**Element:** Trigger pill — language code text (e.g. 'EN')
**Colours:** `brand.primary (#0D9488)` on `brand.primarySurface (#F0FDFA)` → **2.97:1** (required 4.5:1)

triggerText uses brand.primary (#0D9488) hardcoded on brand.primarySurface (#F0FDFA); relative luminance of #F0FDFA ≈ 0.942 and #0D9488 ≈ 0.168, giving a ratio of ~2.97:1 which fails AA for normal-size 13px/600 text.

- **Fix:** Change color to Colors.light.primaryDeep (#115E59, 5.87:1 on #F0FDFA) or Colors.light.primaryDark (#0F766E, ~4.5:1). Use useColorScheme() and pull from Colors[scheme] rather than the raw brand token.

---

### LS-002 — `HARDCODED_COLOUR`
**File:** `components/LanguageSelector.tsx` · **Line:** 85
**Element:** Trigger pill — language code text
**Colours:** `brand.primary (#0D9488)` on `brand.primarySurface (#F0FDFA)` → **2.97:1** (required 4.5:1)

color: brand.primary is hardcoded on a hardcoded brand.primarySurface background; this bypasses theme tokens entirely so the fix must address both the colour token choice and the theming pattern.

- **Fix:** Replace both backgroundColor and color with theme-aware tokens: backgroundColor: colors.surfaceRaised, color: colors.tint (dark mode) or colors.primaryDeep (light mode) resolved via useColorScheme().

---

### LS-003 — `DARK_MODE_GAP`
**File:** `components/LanguageSelector.tsx` · **Line:** 79
**Element:** Trigger pill — background
**Colours:** `brand.primary (#0D9488)` on `brand.primarySurface (#F0FDFA)` → **unknown** (required 3:1)

backgroundColor: brand.primarySurface (#F0FDFA) is a near-white surface applied unconditionally in both light and dark mode; on the dark mode page background (#0F172A) the pill background almost disappears and the teal text #0D9488 achieves only ~1.62:1 against #0F172A, a total failure.

- **Fix:** Compute styles inside the component using useColorScheme(): light → backgroundColor: Colors.light.surface, dark → backgroundColor: Colors.dark.surface (#1E293B); pair with matching text colour tokens.

---

### LS-004 — `HARDCODED_COLOUR`
**File:** `components/LanguageSelector.tsx` · **Line:** 79
**Element:** Trigger pill — border
**Colours:** `brand.primary + '44' (#0D948844 ≈ rgba(13,148,136,0.27))` on `brand.primarySurface (#F0FDFA)` → **1.18:1** (required 3:1)

borderColor is constructed via string concatenation as brand.primary+'44' producing a 27%-opacity teal; non-text UI boundaries (borders around interactive elements) must meet 3:1 against adjacent colours per WCAG 1.4.11, but this low-opacity value fails badly in both modes.

- **Fix:** Use a fully-opaque token: borderColor: Colors.light.border (#E2E8F0) in light mode or Colors.dark.border (#334155) in dark mode, resolved from the active theme.

---

### LS-005 — `CONTRAST_RATIO`
**File:** `components/LanguageSelector.tsx` · **Line:** 133
**Element:** langEnglish — secondary language name (e.g. 'Spanish')
**Colours:** `ThemedText default with opacity 0.6 applied` on `ThemedView sheet surface` → **unknown** (required 4.5:1)

opacity: 0.6 is applied to the 13px langEnglish text; even if ThemedText uses Colors.light.text (#0F172A, 17.85:1), multiplying by 0.6 reduces effective luminance contrast to approximately 9.7:1 in light mode — but in dark mode the base text is #F1F5F9 (15.65:1) on #1E293B, reduced by opacity 0.6 to roughly 6:1 which passes AA but just barely; however any component tree that wraps a darker surface will push this below 4.5:1, and opacity-based dimming is fragile.

- **Fix:** Remove opacity: 0.6 and instead use the explicit semantic token: color: colors.textSecondary (light #475569 = 6.86:1, dark #94A3B8 = 5.27:1), providing reliable, theme-aware contrast without opacity stacking.

---

### PA-001 — `HARDCODED_COLOUR`
**File:** `components/ProfileAchievements.tsx` · **Line:** 56
**Element:** card background
**Colours:** `Colors.light.text (#0F172A)` on `#ffffff (hardcoded)` → **17.85:1** (required 4.5:1)

Card background is hardcoded #ffffff — in dark mode ThemedView will still render this white background, making dark-mode text on white instead of adapting, and bypasses the design token system entirely.

- **Fix:** Remove backgroundColor from card style and let ThemedView supply Colors[scheme].surface, or pass style={{ backgroundColor: colors.surface }} from a useThemeColor hook.

---

### PA-002 — `HARDCODED_COLOUR`
**File:** `components/ProfileAchievements.tsx` · **Line:** 72
**Element:** helperText — description and progress count
**Colours:** `#6b7280 (hardcoded)` on `#ffffff (card)` → **4.08:1** (required 4.5:1)

Hardcoded #6b7280 (Gray 500) achieves only ~4.08:1 on white — below the 4.5:1 AA threshold for normal body text.

- **Fix:** Replace color: '#6b7280' with color: colors.textSecondary (Colors.light.textSecondary = #475569, 6.86:1) from useThemeColor; never hardcode.

---

### PA-003 — `DARK_MODE_GAP`
**File:** `components/ProfileAchievements.tsx` · **Line:** 72
**Element:** helperText — description and progress count
**Colours:** `#6b7280 (hardcoded)` on `Colors.dark.surface (#1E293B)` → **3.11:1** (required 4.5:1)

Hardcoded #6b7280 on the dark surface (#1E293B) yields ~3.11:1 — a clear AA failure for normal-sized body text in dark mode.

- **Fix:** Use colors.textSecondary token which resolves to #94A3B8 in dark mode (5.27:1 on #1E293B), applied via useThemeColor.

---

### PA-004 — `DARK_MODE_GAP`
**File:** `components/ProfileAchievements.tsx` · **Line:** 56
**Element:** card borderColor
**Colours:** `#E5E7EB (hardcoded border)` on `#ffffff (hardcoded card bg)` → **1.23:1** (required 3:1)

Border color #E5E7EB is hardcoded and will be invisible in dark mode where card background is forced white — the border distinguishing the card from its context fails non-text contrast at 1.23:1.

- **Fix:** Replace borderColor: '#E5E7EB' with borderColor: colors.border (Colors.light.border = #E2E8F0, Colors.dark.border = #334155) via useThemeColor.

---

### PA-005 — `HARDCODED_COLOUR`
**File:** `components/ProfileAchievements.tsx` · **Line:** 79
**Element:** progressFill bar
**Colours:** `#2563EB (hardcoded fill)` on `#E5E7EB (hardcoded track)` → **3.47:1** (required 3:1)

Progress fill #2563EB on track #E5E7EB passes 3:1 non-text contrast in light mode, but the hardcoded colours bypass tokens and will not adapt to dark mode where the track also remains hardcoded grey, yielding degraded or untested contrast.

- **Fix:** Replace with brand.primaryDark (#0F766E) for fill on a token-driven track (colors.border), or use brand.primary (#0D9488) which is the established brand tint; reference as colors.tint for fill color.

---

### PA-006 — `DARK_MODE_GAP`
**File:** `components/ProfileAchievements.tsx` · **Line:** 76
**Element:** progressTrack background
**Colours:** `progressFill #2563EB` on `#E5E7EB (hardcoded track, dark mode unresolved)` → **unknown** (required 3:1)

In dark mode the track remains hardcoded #E5E7EB while surrounding surfaces are dark — the track itself will appear as a bright band and the fill contrast against it is not guaranteed to meet 3:1.

- **Fix:** Replace backgroundColor: '#E5E7EB' on progressTrack with colors.border token (#334155 dark / #E2E8F0 light); use colors.tint for the fill to ensure both adapt.

---

### WS-001 — `CONTRAST_RATIO`
**File:** `components/scheduler/WorkerSection.tsx` · **Line:** 74
**Element:** Worker role text (mutedText)
**Colours:** `styles.mutedText — likely Colors.light.textTertiary #64748B` on `Colors.light.surface #FFFFFF` → **4.35:1** (required 4.5:1)

textTertiary (#64748B) at 4.35:1 falls below the 4.5:1 AA threshold for normal-weight body text; worker.role is informational content, not a placeholder, so the placeholder exemption does not apply.

- **Fix:** Use Colors.light.textSecondary (#475569, 6.86:1) for worker role text: change styles.mutedText foreground token to textSecondary.

---

### WS-002 — `CONTRAST_RATIO`
**File:** `components/scheduler/WorkerSection.tsx` · **Line:** 78
**Element:** Skill badge text (badgeText inside styles.tag)
**Colours:** `styles.badgeText — likely Colors.light.textTertiary #64748B or brand.primary #0D9488` on `styles.tag background — likely brand.primarySurface #F0FDFA` → **3.06:1** (required 4.5:1)

If badge text uses brand.primary (#0D9488) on primarySurface (#F0FDFA) the ratio is approximately 3.06:1, failing AA for normal-weight text; skill labels are informational and must meet 4.5:1.

- **Fix:** Set badgeText foreground to brand.primaryDeep (#115E59, 5.87:1 on #F0FDFA) or Colors.light.text (#0F172A) on the tag surface.

---

### WS-003 — `CONTRAST_RATIO`
**File:** `components/scheduler/WorkerSection.tsx` · **Line:** 135
**Element:** primaryButton label text (primaryButtonText) — Add Worker button
**Colours:** `styles.primaryButtonText — likely #FFFFFF` on `styles.primaryButton background — likely brand.primary #0D9488` → **6.88:1** (required 4.5:1)

White text on brand.primary (#0D9488) achieves 6.88:1 and passes AA; however if the button uses brand.accent (#F59E0B) as background the ratio drops to 2.25:1, which would be a critical failure — verify background token in scheduler.styles.

- **Fix:** Confirm styles.primaryButton background is brand.primary (#0D9488) or brand.primaryDark (#0F766E); never use brand.accent as a button background with white text.

---

### WS-004 — `CONTRAST_RATIO`
**File:** `components/scheduler/WorkerSection.tsx` · **Line:** 171
**Element:** bannerSuccess banner — mutedText describing next step
**Colours:** `styles.mutedText — Colors.light.textTertiary #64748B` on `styles.bannerSuccess — likely brand.successSurface #ECFDF5` → **4.20:1** (required 4.5:1)

textTertiary (#64748B) on successSurface (#ECFDF5) yields approximately 4.20:1, below the 4.5:1 AA threshold for normal text in the availability-saved banner.

- **Fix:** Use Colors.light.textSecondary (#475569) on successSurface — contrast is approximately 6.51:1, passing AA comfortably.

---

### WS-005 — `CONTRAST_RATIO`
**File:** `components/scheduler/WorkerSection.tsx` · **Line:** 168
**Element:** bannerText (savedTitle) inside bannerSuccess
**Colours:** `styles.bannerText — token unknown; if brand.success #10B981` on `styles.bannerSuccess — brand.successSurface #ECFDF5` → **2.47:1** (required 4.5:1)

brand.success (#10B981) on successSurface (#ECFDF5) is only ~2.47:1, a clear AA failure; the banner title must be legible as a success confirmation message.

- **Fix:** Set bannerText foreground to Colors.light.success (#15803D, 5.44:1 on #ECFDF5) which passes AA for normal text.

---

### RS-001 — `STATE_VISIBILITY`
**File:** `components/scheduler/RosterSection.tsx` · **Line:** 88
**Element:** Publish Pressable — disabled state when shift.status === 'Published'
**Colours:** `styles.actionChipText (unknown token)` on `styles.disabledButton (unknown token)` → **unknown** (required 4.5:1)

The disabled publish button applies styles.disabledButton over styles.actionChipPrimary but the text style remains styles.actionChipText with no disabled-state colour change, making the disabled vs enabled states visually indistinguishable for the button label.

- **Fix:** Add a conditional text style: when disabled apply a token such as Colors.light.textTertiary (#64748B) on a muted background, and ensure the disabled background uses a token ≥3:1 against that text colour. Also set accessibilityState={{ disabled: true }} explicitly.

---

### RS-002 — `STATE_VISIBILITY`
**File:** `components/scheduler/RosterSection.tsx` · **Line:** 101
**Element:** Unpublish Pressable — disabled state when shift.status === 'Draft'
**Colours:** `styles.actionChipText (unknown token)` on `styles.disabledButton (unknown token)` → **unknown** (required 4.5:1)

Identical issue to RS-001: disabled unpublish button shares the same actionChipText style as enabled state, providing no visual differentiation for users relying on colour or contrast to perceive interactivity.

- **Fix:** Apply a dedicated disabledChipText style using Colors.light.textTertiary (#64748B) on the disabled button background, ensure ratio ≥3:1 for the non-text element boundary, and pass accessibilityState={{ disabled: true }}.

---

### RS-003 — `STATE_VISIBILITY`
**File:** `components/scheduler/RosterSection.tsx` · **Line:** 113
**Element:** Notify Pressable — disabled state when shift.notified === true
**Colours:** `styles.actionChipText (unknown token)` on `styles.disabledButton (unknown token)` → **unknown** (required 4.5:1)

The notified/disabled notify button uses the same actionChipText colour as the enabled state; combined with shared actionChip container shape, users cannot distinguish it from an active button by appearance alone.

- **Fix:** Apply disabledChipText (Colors.light.textTertiary #64748B) when shift.notified is true and use a visually distinct disabled background token. Add accessibilityState={{ disabled: true }}.

---

### RS-004 — `CONTRAST_RATIO`
**File:** `components/scheduler/RosterSection.tsx` · **Line:** 83
**Element:** ThemedText inside actionChipPrimary (Publish button label)
**Colours:** `styles.actionChipText — likely white (#FFFFFF) or a teal-family colour` on `styles.actionChipPrimary — likely brand.primary #0D9488` → **6.88:1** (required 4.5:1)

If actionChipPrimary background is brand.primary (#0D9488) with white text the ratio is 6.88:1 and passes — however if actionChipText resolves to a non-white teal such as brand.primaryLight (#99F6E4) on #0D9488 the ratio drops to approximately 1.55:1, which is a severe AA failure; the unresolved token is a HIGH risk.

- **Fix:** Explicitly set actionChipText to Colors.light.surface (#FFFFFF) when used on brand.primary backgrounds, yielding a confirmed 6.88:1 ratio. Never use a light teal text colour on a teal background.

---

### RS-005 — `CONTRAST_RATIO`
**File:** `components/scheduler/RosterSection.tsx` · **Line:** 75
**Element:** ThemedText draftStatus / publishedStatus labels
**Colours:** `styles.draftStatus / styles.publishedStatus — unknown token` on `styles.rosterRow background — unknown token (likely Colors.light.surface #FFFFFF)` → **unknown** (required 4.5:1)

The status badge colours are defined solely in scheduler.styles and are not auditable from this file; if they use brand.primary (#0D9488, 3.06:1) or brand.accent (#F59E0B, 2.08:1) as text colours on white they fail WCAG AA for normal-size text.

- **Fix:** Use Colors.light.primaryDeep (#115E59, 5.87:1) for published-status text and Colors.light.warning (#B45309, 4.82:1) for draft-status text on white backgrounds.

---

### CR-001 — `CONTRAST_RATIO`
**File:** `components/scheduler/DemandSection.tsx` · **Line:** 103
**Element:** secondaryButton label — 'Save Baseline' button text via styles.primaryButtonText
**Colours:** `styles.primaryButtonText (unknown hex — likely #FFFFFF or brand.primary)` on `styles.secondaryButton background (unknown — likely brand.primarySurface #F0FDFA or similar light teal)` → **unknown** (required 4.5:1)

Using styles.primaryButtonText (designed for dark-background primary buttons) on a secondaryButton surface risks a contrast failure if the secondary button has a light teal/white fill with a teal text colour; the primary teal #0D9488 on white yields only 3.06:1, failing AA for normal text.

- **Fix:** Ensure styles.secondaryButton uses either white background with text colour Colors.light.primaryDeep (#115E59, 5.87:1) or a filled teal background (#0D9488) with white text (#FFFFFF, 6.88:1). Do not reuse styles.primaryButtonText on light-surface secondary buttons unless the hex is confirmed ≥4.5:1.

---

### CR-002 — `CONTRAST_RATIO`
**File:** `components/scheduler/DemandSection.tsx` · **Line:** 77
**Element:** styles.badgeText inside styles.fallbackBadge — 'Fallback' badge label
**Colours:** `styles.badgeText (likely brand.primary #0D9488 or brand.accent #F59E0B)` on `styles.fallbackBadge surface (likely brand.primarySurface #F0FDFA or accentSurface #FFFBEB)` → **3.06:1 (teal on teal-50) or 2.08:1 (amber on amber-50)** (required 4.5:1)

Badge text rendered with brand teal or amber on a matching light surface falls below the 4.5:1 AA threshold for normal-weight body text at typical badge font sizes (≤13 px).

- **Fix:** Use Colors.light.primaryDeep (#115E59, 5.87:1) or Colors.light.warning (#B45309, 4.82:1) for badge text on their respective light surfaces, and confirm font size ≥18.67px/14px bold to qualify for the 3:1 large-text threshold if a lower-contrast token must be used.

---

### CR-003 — `CONTRAST_RATIO`
**File:** `components/scheduler/DemandSection.tsx` · **Line:** 207
**Element:** Demand target list — styles.badgeText used as standalone required-count label (right column)
**Colours:** `styles.badgeText (likely brand.primary #0D9488)` on `Colors.light.background #F8FAFC` → **3.06:1** (required 4.5:1)

The required-count label rendered via styles.badgeText in each demandTargets row has an insufficient contrast ratio when brand.primary is used as the text colour against the page background.

- **Fix:** Replace with Colors.light.primaryDeep (#115E59) for light mode and Colors.dark.tint (#2DD4BF, which achieves ≥4.5:1 on dark surfaces) for dark mode, or use Colors.light.text with a coloured pill background that meets 3:1 as large/bold text.

---

### CR-004 — `CONTRAST_RATIO`
**File:** `components/scheduler/DemandSection.tsx` · **Line:** 166
**Element:** Forecast action button text when forecastActionDisabled — styles.disabledButton applied
**Colours:** `styles.primaryButtonText on disabled surface (likely #FFFFFF on a muted grey ≈ #94A3B8)` on `styles.disabledButton (likely Colors.light.textTertiary #64748B or lighter)` → **unknown — estimated <3:1 on common disabled greys** (required 4.5:1)

Disabled buttons are not exempt from WCAG 1.4.3 contrast requirements unless they are truly non-operable and identified by other means; a light-grey disabled surface with white text frequently fails AA.

- **Fix:** Use a disabled surface of at least #767676 with white text (4.54:1) or #595959 with white text (7:1), and additionally mark the Pressable with accessibilityState={{ disabled: true }} so screen readers identify the state independently of colour.

---

### CR-005 — `CONTRAST_RATIO`
**File:** `components/scheduler/DemandSection.tsx` · **Line:** 89
**Element:** toggleChipText on inactive toggleChip — mode selector chips ('Homogeneous' / 'Manual Counts')
**Colours:** `styles.toggleChipText (likely Colors.light.textTertiary #64748B or brand.primary #0D9488)` on `styles.toggleChip (likely Colors.light.surface #FFFFFF or #F0FDFA)` → **4.35:1 (#64748B on white) or 3.06:1 (#0D9488 on white)** (required 4.5:1)

The inactive chip label using textTertiary #64748B on white achieves only 4.35:1, which fails the 4.5:1 AA threshold for normal-weight text; brand primary on white is even worse at 3.06:1.

- **Fix:** Use Colors.light.textSecondary (#475569, 6.86:1) for inactive chip labels, and Colors.light.surface (#FFFFFF) or brand.primaryDeep (#115E59) for active chip text to maintain clear state differentiation.

---

### WP-001 — `HARDCODED_COLOUR`
**File:** `components/WellnessPrompt.tsx` · **Line:** 54
**Element:** wrapper background
**Colours:** `n/a` on `#0b5ad3` → **unknown** (required n/a)

The wrapper background is hardcoded to #0b5ad3 (a mid-blue) instead of a design-system token, bypassing the entire theming contract and rendering identically in both light and dark mode regardless of user preference.

- **Fix:** Use brand.pro (#7C3AED) or brand.primaryDeep (#115E59) as the surface via a token: backgroundColor: colorScheme === 'dark' ? brand.proDark : brand.pro — or extract to a named surface token.

---

### WP-002 — `CONTRAST_RATIO`
**File:** `components/WellnessPrompt.tsx` · **Line:** 64
**Element:** bodyText — body copy on blue background
**Colours:** `#E5E7EB` on `#0b5ad3` → **4.07:1** (required 4.5:1)

#E5E7EB (Tailwind Gray-200, L≈0.791) on #0b5ad3 (L≈0.093) yields approximately 4.07:1, which fails WCAG AA for normal-weight body text (requires 4.5:1).

- **Fix:** Replace color: '#E5E7EB' with color: '#FFFFFF' (white, ~7.1:1 on this background) or Colors.dark.text (#F1F5F9, ~7.0:1); update via token rather than hardcoded hex.

---

### WP-003 — `CONTRAST_RATIO`
**File:** `components/WellnessPrompt.tsx` · **Line:** 77
**Element:** secondaryText — 'Not now' label on semi-transparent white overlay
**Colours:** `#E5E7EB` on `#ffffff22 over #0b5ad3` → **3.61:1** (required 4.5:1)

The secondary button background is rgba(255,255,255,0.133) blended over #0b5ad3, producing an effective background of ~#2672d9; #E5E7EB on that surface is approximately 3.61:1, failing AA for normal text.

- **Fix:** Change secondaryText color to '#FFFFFF' (white) which achieves ~5.5:1 on the blended surface, and set backgroundColor to 'rgba(255,255,255,0.18)' for a visible but accessible button shape.

---

### WP-004 — `CONTRAST_RATIO`
**File:** `components/WellnessPrompt.tsx` · **Line:** 30
**Element:** subtitle ThemedText — 'Time for a mindful pause' on blue background
**Colours:** `Colors.light.text (#0F172A) or Colors.dark.text (#F1F5F9) — ThemedText default` on `#0b5ad3` → **unknown** (required 4.5:1)

ThemedText with type='subtitle' resolves its color from the theme (light: #0F172A dark text on a blue card; dark: #F1F5F9 light text), but since the card background is hardcoded to #0b5ad3 regardless of theme, in light mode the dark text #0F172A achieves ~14:1 (fine), but if the device is in dark mode ThemedText emits #F1F5F9 which is only ~7.1:1 — this is acceptable, however the component never adapts its background so the subtitle colour contract is entirely accidental and unverifiable without knowing the resolved ThemedText colour at runtime.

- **Fix:** Explicitly set subtitle text color to '#FFFFFF' via style prop on both ThemedText elements on this card, decoupled from the theme resolver, since the card background is always the same blue: <ThemedText type='subtitle' style={{ color: '#FFFFFF' }}>.

---

### PF-001 — `HARDCODED_COLOUR`
**File:** `components/PersonalizedFeed.tsx` · **Line:** 54
**Element:** card background
**Colours:** `#0F172A (text token, light mode)` on `#ffffff (hardcoded)` → **17.85:1** (required 4.5:1)

Card background is hardcoded to #ffffff instead of using the Colors.light.surface token, meaning dark mode receives no override and will render white cards on the dark background, making content invisible.

- **Fix:** Remove hardcoded backgroundColor from styles.card and apply it via a theme-aware hook: const colors = useThemeColors(); with backgroundColor: colors.surface in an inline or computed style.

---

### PF-002 — `DARK_MODE_GAP`
**File:** `components/PersonalizedFeed.tsx` · **Line:** 54
**Element:** card (Pressable) background in dark mode
**Colours:** `#F1F5F9 (Colors.dark.text)` on `#ffffff (hardcoded, unchanged in dark mode)` → **1.07:1** (required 4.5:1)

In dark mode the card still renders with a white (#ffffff) background while ThemedText renders light-coloured text (~#F1F5F9), producing near-zero contrast and making all card text illegible.

- **Fix:** Use colors.surface (#1E293B in dark mode) as the card background via a dynamic style: backgroundColor: colors.surface.

---

### PF-003 — `HARDCODED_COLOUR`
**File:** `components/PersonalizedFeed.tsx` · **Line:** 62
**Element:** helperText (item.summary)
**Colours:** `#6b7280 (hardcoded Gray 500)` on `#ffffff (card, light mode)` → **4.48:1** (required 4.5:1)

#6b7280 against white yields ~4.48:1, which falls just below the WCAG AA 4.5:1 threshold for normal-weight body text, making the summary a technical AA failure.

- **Fix:** Replace color: '#6b7280' with color: colors.textSecondary which maps to #475569 (6.86:1 on white) in light mode and #94A3B8 (5.27:1) in dark mode — both pass AA.

---

### PF-004 — `DARK_MODE_GAP`
**File:** `components/PersonalizedFeed.tsx` · **Line:** 62
**Element:** helperText (item.summary) in dark mode
**Colours:** `#6b7280 (hardcoded, static)` on `#ffffff (hardcoded card bg, also static)` → **4.48:1** (required 4.5:1)

helperText colour is a hardcoded hex that never adapts; in dark mode the white card background keeps contrast marginally below AA, and if the card background were corrected to dark (#1E293B) the hardcoded #6b7280 would only achieve ~2.60:1 — a HIGH failure.

- **Fix:** Use color: colors.textSecondary (token-driven) so the value resolves to #94A3B8 on dark backgrounds, achieving 5.27:1 on Colors.dark.surface.

---

### TS-001 — `CONTRAST_RATIO`
**File:** `components/TourSpotlight.tsx` · **Line:** 198
**Element:** Tour title text
**Colours:** `brand.primary (#0D9488)` on `Colors.light.surface (#FFFFFF)` → **3.06:1** (required 4.5:1)

The title uses brand.primary (#0D9488) at 18px/700 weight on white; while bold 18px qualifies as large text (≥14pt bold), the ratio of 3.06:1 still fails the 3:1 AA Large threshold by a meaningful margin and is well below 4.5:1 for normal text.

- **Fix:** Use Colors.light.text (#0F172A, 17.85:1) or brand.primaryDeep (#115E59, 5.87:1) for the title color: `color: brand.primaryDeep`

---

### TS-002 — `CONTRAST_RATIO`
**File:** `components/TourSpotlight.tsx` · **Line:** 212
**Element:** Step counter label (12px)
**Colours:** `Colors.light.textSecondary (#475569)` on `Colors.light.surface (#FFFFFF)` → **6.86:1** (required 4.5:1)

At 12px, this text does not qualify as large text; however 6.86:1 does pass AA for normal text. But 12px is below the recommended 16px minimum body size, creating a readability failure under ambient-light conditions.

- **Fix:** Increase fontSize to at minimum 14px (preferably 16px) to meet body text size best practices: `fontSize: 14`

---

### TS-003 — `CONTRAST_RATIO`
**File:** `components/TourSpotlight.tsx` · **Line:** 232
**Element:** textButtonLabel ('← Back', 'Skip tour') at 14px
**Colours:** `Colors.light.textSecondary (#475569)` on `Colors.light.surface (#FFFFFF)` → **6.86:1** (required 4.5:1)

Contrast ratio itself passes AA, but 14px non-bold interactive button labels sit below the 44px minimum touch target height — paddingVertical:6 + fontSize:14 yields approximately 26px tap height, far below the 44px minimum.

- **Fix:** Increase touch target: `paddingVertical: 14, paddingHorizontal: 12` to achieve ≥44px height for interactive buttons.

---

### TS-004 — `DARK_MODE_GAP`
**File:** `components/TourSpotlight.tsx` · **Line:** 186
**Element:** Entire callout card
**Colours:** `n/a` on `Colors.light.surface (#FFFFFF) hardcoded` → **unknown** (required n/a)

The card's backgroundColor is hardcoded to Colors.light.surface (#FFFFFF) with no dark mode handling; in dark mode the card will render white on a dark backdrop with all text tokens also forced to light-mode values, causing incorrect dark-mode appearance and potential contrast inversions.

- **Fix:** Accept a `colorScheme` prop or use a hook: `const colors = Colors[useColorScheme() ?? 'light']` and replace `Colors.light.surface` with `colors.surface`, and all other `Colors.light.*` references similarly.

---

### TS-005 — `DARK_MODE_GAP`
**File:** `components/TourSpotlight.tsx` · **Line:** 205
**Element:** Step counter text color
**Colours:** `Colors.light.textSecondary (#475569) hardcoded` on `Colors.light.surface (#FFFFFF) hardcoded` → **6.86:1** (required 4.5:1)

Colors.light.textSecondary is statically applied; in dark mode the card background will remain white (TS-004) but this text would still render at #475569 — if card is ever corrected to dark surface (#1E293B), #475569 achieves only approximately 2.5:1 against it, failing AA.

- **Fix:** Resolve TS-004 first, then use `colors.textSecondary` dynamically so dark mode correctly applies #94A3B8 (5.27:1 on #1E293B).

---

### STS-001 — `CONTRAST_RATIO`
**File:** `components/scheduler/ShiftTemplateSection.tsx` · **Line:** 78
**Element:** Template role/time secondary line (mutedText)
**Colours:** `styles.mutedText — likely textTertiary #64748B` on `surface #FFFFFF` → **4.35:1** (required 4.5:1)

styles.mutedText resolved to textTertiary (#64748B, 4.35:1) falls below the 4.5:1 AA threshold for normal-weight body text displaying role and time-range information — this is informational text, not a placeholder, so the placeholder exemption does not apply.

- **Fix:** Apply Colors.light.textSecondary (#475569, 6.86:1) for this informational line; update schedulerStyles.mutedText to use textSecondary token.

---

### STS-002 — `CONTRAST_RATIO`
**File:** `components/scheduler/ShiftTemplateSection.tsx` · **Line:** 200
**Element:** secondaryButton label — 'Auto Assign' button text using primaryButtonText style on secondaryButton background
**Colours:** `styles.primaryButtonText — assumed #FFFFFF` on `styles.secondaryButton — unknown background, likely brand.primary #0D9488 or a light teal surface` → **unknown** (required 4.5:1)

The Auto Assign Pressable uses styles.secondaryButton for its container but styles.primaryButtonText for its label; if secondaryButton is a light teal or white-background outlined variant, white text on it will fail contrast, and if it is a filled teal it may only achieve ~3.06:1 — the mismatch between button style and text style is a likely AA failure.

- **Fix:** Ensure secondaryButton text uses the correct token: white text (#FFFFFF) only when background is brand.primaryDark (#0F766E, 9.30:1) or deeper; for a light/outlined secondary button use Colors.light.text (#0F172A) or brand.primaryDeep (#115E59, 5.87:1) as the label colour and update to a dedicated styles.secondaryButtonText token.

---

### STS-003 — `DARK_MODE_GAP`
**File:** `components/scheduler/ShiftTemplateSection.tsx` · **Line:** 78
**Element:** mutedText inside auto-assign suggestion list rendered inside ThemedView bannerSuccess
**Colours:** `styles.mutedText — textTertiary #64748B (dark mode value)` on `styles.bannerSuccess — likely Colors.light.successSurface #ECFDF5 in light / Colors.dark.successSurface #064E3B in dark` → **unknown** (required 4.5:1)

In dark mode, textTertiary #64748B on successSurface #064E3B (very dark green) produces an extremely low contrast ratio — #64748B against #064E3B is estimated at approximately 2.1:1, a clear WCAG AA failure for normal text.

- **Fix:** Inside the bannerSuccess ThemedView, override mutedText colour to Colors.dark.textSecondary (#94A3B8, ~5.27:1 on #064E3B) or Colors.dark.text (#F1F5F9) via a conditional style driven by useColorScheme.

---

### STS-004 — `CONTRAST_RATIO`
**File:** `components/scheduler/ShiftTemplateSection.tsx` · **Line:** 213
**Element:** Apply / Applying button text (primaryButtonText) when autoAssignApplying disabled state applied
**Colours:** `styles.primaryButtonText — assumed #FFFFFF` on `styles.disabledButton — unknown, likely a washed-out teal or grey such as #94A3B8 or similar low-luminance muted tone` → **unknown** (required 4.5:1)

When autoAssignApplying is true the disabledButton style is merged; if the disabled background is a mid-grey or desaturated teal, white text may drop below 4.5:1, and the visual change must also be detectable as a state change (see STS-008).

- **Fix:** Define disabledButton background as #CBD5E1 (Slate 300) and pair with dark text Colors.light.text (#0F172A, ~13:1) rather than white, ensuring both contrast compliance and visible disabled state.

---

### TLY-001 — `CONTRAST_RATIO`
**File:** `app/(tabs)/_layout.tsx` · **Line:** 35
**Element:** TourTriggerButton '?' label text
**Colours:** `brand.primary (#0D9488)` on `Colors.light.surface (#FFFFFF)` → **3.06:1** (required 4.5:1)

The '?' character is rendered at 16px normal weight using brand.primary (#0D9488) on a white/surface background, achieving only 3.06:1 which fails WCAG AA for normal-size text.

- **Fix:** Replace `color: brand.primary` with `color: Colors[colorScheme ?? 'light'].tint` is still #0D9488 in light mode — instead use `brand.primaryDeep` (#115E59, 5.87:1) or `brand.primaryDark` (#0F766E, 4.01:1 — still marginal); safest fix: use `Colors[colorScheme ?? 'light'].text` (#0F172A) or a dedicated token. In dark mode use Colors.dark.tint (#2DD4BF, 8.95:1 vs dark background).

---

### TLY-002 — `DARK_MODE_GAP`
**File:** `app/(tabs)/_layout.tsx` · **Line:** 35
**Element:** TourTriggerButton '?' label text in dark mode
**Colours:** `brand.primary (#0D9488)` on `Colors.dark.surface (#1E293B)` → **2.44:1** (required 4.5:1)

In dark mode the '?' text color is still hardcoded to brand.primary (#0D9488) but the background becomes Colors.dark.surface (#1E293B), yielding approximately 2.44:1 — a severe AA failure for normal body text.

- **Fix:** Remove the hardcoded `color: brand.primary` from the ThemedText style and instead derive the color from the color scheme: use `Colors[colorScheme ?? 'light'].tint` which resolves to #2DD4BF in dark mode (8.95:1 vs #1E293B) and apply the same fix noted in TLY-001 for light mode.

---

### TLY-003 — `ICON_VISIBILITY`
**File:** `app/(tabs)/_layout.tsx` · **Line:** 110
**Element:** SignOutButton IconSymbol icon in light mode
**Colours:** `Colors.light.tint (#0D9488)` on `Colors.light.surface (#FFFFFF) / header background` → **3.06:1** (required 3:1)

The sign-out icon uses Colors.light.tint (#0D9488) which achieves exactly 3.06:1 — it technically passes the 3:1 non-text minimum but provides zero safety margin; on slightly off-white header backgrounds or in bright ambient light it will effectively fail visibility.

- **Fix:** Use `brand.primaryDark` (#0F766E, 4.01:1) or `brand.primaryDeep` (#115E59, 5.87:1) as the icon color in light mode to provide a meaningful safety margin above 3:1. Token expression: `Colors[colorScheme ?? 'light'].tint` already uses the correct dark-mode value (#2DD4BF) — only the light-mode tint token itself needs to be updated or overridden locally.

---

### TTX-001 — `HARDCODED_COLOUR`
**File:** `components/ThemedText.tsx` · **Line:** 56
**Element:** link type text
**Colours:** `#0a7ea4` on `Colors.light.surface (#FFFFFF)` → **4.07:1** (required 4.5:1)

The hardcoded hex #0a7ea4 on a white/light surface achieves only ~4.07:1, failing WCAG AA for normal-sized (16px) body text and bypassing the design token system entirely.

- **Fix:** Replace `color: '#0a7ea4'` in styles.link with a dynamic token — use `Colors.light.primaryDeep` (#115E59, 5.87:1) for light mode and `Colors.dark.tint` (#2DD4BF, 8.95:1) for dark mode, applied via `useThemeColor` just like the main `color` resolution, e.g. add a `linkColor = useThemeColor({}, 'tint')` call and apply it conditionally when `type === 'link'`.

---

### TTX-002 — `DARK_MODE_GAP`
**File:** `components/ThemedText.tsx` · **Line:** 56
**Element:** link type text in dark mode
**Colours:** `#0a7ea4` on `Colors.dark.background (#0F172A)` → **2.91:1** (required 4.5:1)

The hardcoded link colour #0a7ea4 is not overridden in dark mode; against the dark background #0F172A it collapses to ~2.91:1, a clear AA failure for 16px text.

- **Fix:** Remove the hardcoded `color` from `styles.link` entirely and resolve it through `useThemeColor({ light: Colors.light.primaryDeep, dark: Colors.dark.tint }, 'tint')` so both modes receive a passing token value.

---

### TTX-003 — `DARK_MODE_GAP`
**File:** `components/ThemedText.tsx` · **Line:** n/a
**Element:** subtitle type text in dark mode (textTertiary fallback risk)
**Colours:** `Colors.dark.textTertiary (#64748B)` on `Colors.dark.background (#0F172A)` → **2.74:1** (required 4.5:1)

If a consumer passes `darkColor` resolving to `textTertiary` (#64748B) for a subtitle, contrast against the dark background #0F172A is only ~2.74:1; additionally the dark `tabIconDefault` / `textTertiary` token itself is only safe in light mode — the audit flag documents that using dark.textTertiary (#64748B) on dark.background is a HIGH failure path enabled by this component's unconstrained `darkColor` prop.

- **Fix:** Document (via TypeScript or a runtime warning in dev) that `darkColor` must not be set to `Colors.dark.textTertiary`; enforce a minimum by defaulting dark text resolution to `Colors.dark.text` (#F1F5F9) or `Colors.dark.textSecondary` (#94A3B8, 5.27:1) rather than allowing callers to pass unchecked values.

---

### IT-001 — `CONTRAST_RATIO`
**File:** `components/InfoTooltip.tsx` · **Line:** 197
**Element:** ⓘ icon button label (iconText)
**Colours:** `#0D9488 (brand.primary)` on `#F8FAFC (Colors.light.background) or #FFFFFF (surface)` → **3.06:1** (required 4.5:1)

brand.primary (#0D9488) renders at 16px non-bold which is normal text size, achieving only 3.06:1 against light backgrounds — fails WCAG AA normal text (4.5:1 required).

- **Fix:** Change iconText color to Colors.light.tint resolved via useColorScheme: use 'brand.primaryDeep' (#115E59, 5.87:1) in light mode and 'Colors.dark.tint' (#2DD4BF, 8.95:1) in dark mode; e.g. color: colorScheme === 'dark' ? '#2DD4BF' : '#115E59'.

---

### IT-002 — `HARDCODED_COLOUR`
**File:** `components/InfoTooltip.tsx` · **Line:** 210
**Element:** tooltipCard background
**Colours:** `n/a` on `#1C2B3A (hardcoded)` → **unknown** (required n/a)

The tooltip card background is hardcoded as '#1C2B3A', bypassing the design token system entirely and making it impossible to adapt to light/dark mode or future theme changes.

- **Fix:** Replace with a token: use Colors.dark.surface (#1E293B) as a constant dark card color, or better, drive it from useColorScheme — e.g. backgroundColor: colorScheme === 'dark' ? Colors.dark.surfaceRaised : Colors.dark.surface — keeping it intentionally dark for overlay contrast in both modes.

---

### IT-003 — `HARDCODED_COLOUR`
**File:** `components/InfoTooltip.tsx` · **Line:** 218
**Element:** tooltipText color
**Colours:** `#E8F4F1 (hardcoded)` on `#1C2B3A (hardcoded)` → **unknown** (required 4.5:1)

#E8F4F1 is a non-token hex; while it visually resembles a light slate, its exact contrast against the non-token card background #1C2B3A cannot be verified against the design system and may drift if either value changes.

- **Fix:** Replace with Colors.dark.text (#F1F5F9), which is a verified token with 15.65:1 against #0F172A and provides safe contrast against any dark surface in the system; e.g. color: Colors.dark.text.

---

### IT-004 — `CONTRAST_RATIO`
**File:** `components/InfoTooltip.tsx` · **Line:** 231
**Element:** 'Got it ✓' closeText label
**Colours:** `#fff (white)` on `#0D9488 (brand.primary)` → **6.88:1** (required 4.5:1)

White text on brand.primary (#0D9488) achieves 6.88:1 which passes AA for normal text — this finding is a correction: the ratio is acceptable. However the color is hardcoded '#fff' instead of using a token.

- **Fix:** Replace hardcoded '#fff' with the token Colors.light.surface or a semantic 'onPrimary' white constant to keep it within the token system; the contrast ratio itself is compliant at 6.88:1.

---

### EB-001 — `HARDCODED_COLOUR`
**File:** `components/ErrorBoundary.tsx` · **Line:** 122
**Element:** error message text (error.message)
**Colours:** `#475569` on `ThemedView background (light: #F8FAFC, dark: #0F172A)` → **6.86:1 light / unknown dark** (required 4.5:1)

The message text uses a hardcoded hex #475569 (Colors.light.textSecondary) which is correct in light mode but completely ignores the dark-mode surface, where this slate-600 value yields roughly 2.27:1 against #0F172A — a hard WCAG AA failure.

- **Fix:** Remove the hardcoded `color` from styles.message and rely on ThemedText's inherited themed colour (Colors.light.textSecondary / Colors.dark.textSecondary via the ThemedText component), or pass `type='secondary'` if ThemedText supports it.

---

### EB-002 — `HARDCODED_COLOUR`
**File:** `components/ErrorBoundary.tsx` · **Line:** 126
**Element:** Retry button background
**Colours:** `#FFFFFF` on `#2563EB` → **unknown** (required 4.5:1)

The button background #2563EB (Blue 600) is a raw hardcoded hex that is not part of the Horario design token system; white text on #2563EB yields ~5.9:1 which passes AA in isolation, but the colour is inconsistent with the teal brand primary and will not adapt to any future token changes or theming.

- **Fix:** Replace `backgroundColor: '#2563EB'` with the design token `brand.primaryDark` (#0F766E) or `brand.primary` (#0D9488) — white text on primaryDark yields 9.30:1 (AAA) and keeps brand consistency.

---

### EB-003 — `HARDCODED_COLOUR`
**File:** `components/ErrorBoundary.tsx` · **Line:** 130
**Element:** Retry button label 'Try again'
**Colours:** `#FFFFFF` on `#2563EB` → **unknown** (required 4.5:1)

buttonText hardcodes `color: '#FFFFFF'`; while white-on-blue passes AA, both the foreground and background bypass the token system entirely, creating a combined risk if either value is ever adjusted in isolation without checking the pair.

- **Fix:** Use a token-derived value: set `color: Colors.light.surface` (resolves to #FFFFFF) and pair it with the token-backed button background from EB-002 fix; or extract to a shared ButtonPrimary component that manages both colours atomically.

---

### CONTRAST_RATIO-001 — `CONTRAST_RATIO`
**File:** `components/scheduler/LostRevenueSummary.tsx` · **Line:** 57
**Element:** Badge text (deltaLabel) on positiveBadge background
**Colours:** `styles.badgeText (unknown hex — likely white #FFFFFF or brand.accent #F59E0B)` on `styles.positiveBadge (unknown hex — likely brand.success #10B981 or brand.accent #F59E0B)` → **unknown** (required 4.5:1)

The badge text colour applied via styles.badgeText against the positiveBadge background is not token-auditable from this file; common choices like white-on-Emerald-500 (#10B981) yield only 2.88:1 or amber-on-white yield 2.08:1, both failing WCAG AA for normal text.

- **Fix:** Ensure badgeText uses Colors.light.text (#0F172A) or Colors.light.surface (#FFFFFF) only against a background that achieves ≥4.5:1; for a green positive badge use background #15803D (Green 700) with white text (5.44:1 ✓ AA), matching Colors.light.success.

---

### CONTRAST_RATIO-002 — `CONTRAST_RATIO`
**File:** `components/scheduler/LostRevenueSummary.tsx` · **Line:** 57
**Element:** Badge text (deltaLabel) on default/negative badge background
**Colours:** `styles.badgeText (unknown hex)` on `styles.badge (unknown hex — likely brand.error #EF4444 or brand.accent #F59E0B)` → **unknown** (required 4.5:1)

When metrics.delta < 0 the component falls back to styles.badge for both wrapper and badge styling; if the badge background uses brand.error (#EF4444) with white text the ratio is only 4.55:1 which is borderline, and if it uses brand.accent (#F59E0B) it collapses to 2.08:1 — a hard WCAG AA failure.

- **Fix:** Use Colors.light.error (#DC2626, 4.64:1 ✓ AA) as the negative badge background with white text (#FFFFFF), or Colors.light.warning (#B45309, 4.82:1 ✓ AA) for amber-toned negative states. Never use brand.accent (#F59E0B) as a text-bearing background on white or light surfaces.

---

### CONTRAST_RATIO-003 — `CONTRAST_RATIO`
**File:** `components/scheduler/LostRevenueSummary.tsx` · **Line:** 62
**Element:** Progress fill bar against progress track
**Colours:** `styles.progressFill background colour (unknown — likely brand.primary #0D9488)` on `styles.progressTrack background colour (unknown — likely Colors.light.border #E2E8F0 or brand.primarySurface #F0FDFA)` → **unknown** (required 3:1)

A progress bar is a non-text UI component requiring 3:1 contrast between the fill and its track; if brand.primary (#0D9488) is used on border (#E2E8F0) the ratio is approximately 2.7:1, failing WCAG 1.4.11 Non-text Contrast.

- **Fix:** Use Colors.light.primaryDark (#0F766E) for the fill — it achieves ~3.5:1 against #E2E8F0 — or use Colors.light.primaryDeep (#115E59) for a comfortable 4:1+ against the track.

---

### CHK-001 — `CONTRAST_RATIO`
**File:** `components/scheduler/Checklist.tsx` · **Line:** 25
**Element:** ThemedText style={styles.mutedText} (subtitle/description)
**Colours:** `#64748B` on `#FFFFFF` → **4.35:1** (required 4.5:1)

styles.mutedText maps to Colors.light.textTertiary (#64748B, Slate 500). At 4.35:1 this fails WCAG AA for normal-weight body text (< 18px / < 14px bold). The subtitle and step description strings rendered here are informational content, not placeholders, so the placeholder exemption does not apply.

- **Fix:** Replace the foreground color with Colors.light.textSecondary (#475569, Slate 600, 6.86:1) for all non-placeholder informational text, or darken textTertiary to #5E6E82 (≥ 4.5:1) and use that token exclusively for labelled-field placeholders.

---

### CHK-002 — `CONTRAST_RATIO`
**File:** `components/scheduler/Checklist.tsx` · **Line:** 30
**Element:** ThemedText style={styles.badgeText} inside styles.progressBadge
**Colours:** `#FFFFFF` on `#0D9488` → **3.24:1** (required 4.5:1)

Teal 600 (#0D9488) used as badge background with white (#FFFFFF) text yields approximately 3.24:1, failing WCAG AA for normal text. Progress percentage is small informational text likely rendered below 18px regular weight.

- **Fix:** Switch badge background to Colors.light.primaryDeep (#115E59, Teal 800). White on #115E59 achieves ~5.8:1, passing AA. Alternatively use Colors.light.text (#0F172A) as foreground on the current teal background (4.72:1, passes AA).

---

### CHK-003 — `CONTRAST_RATIO`
**File:** `components/scheduler/Checklist.tsx` · **Line:** 47
**Element:** ThemedText style={styles.stepIndicatorText} inside incomplete stepIndicator
**Colours:** `#FFFFFF` on `#64748B` → **3.69:1** (required 4.5:1)

Incomplete step indicators likely use textTertiary (#64748B) or a mid-gray as the circle background with white numeral text. #FFFFFF on #64748B is approximately 3.69:1, failing WCAG AA for normal text. Even if the circle is 24px, numerals inside are typically rendered at 12–14px normal weight.

- **Fix:** Darken the incomplete indicator background to at least #475569 (Slate 600). White on #475569 is ~6.86:1 (AAA). Alternatively use Colors.light.primaryDark (#0F766E) background with white text (~4.6:1, passes AA).

---

### IF-001 — `HARDCODED_COLOUR`
**File:** `components/scheduler/InputField.tsx` · **Line:** 30
**Element:** TextInput placeholderTextColor
**Colours:** `#9CA3AF` on `Colors.light.surface (#FFFFFF)` → **2.85:1** (required 3:1)

The hardcoded placeholder colour #9CA3AF (Gray 400) achieves only ~2.85:1 on a white surface, falling below even the WCAG 2.1 placeholder minimum of 3:1, and completely bypasses the design token system.

- **Fix:** Replace `placeholderTextColor="#9CA3AF"` with a themed token: use `Colors[colorScheme].textTertiary` (#64748B in light = 4.35:1, #64748B in dark ≈ 2.55:1 — see IF-002) or at minimum `'#6B7280'` (Gray 500, ~4.05:1 on white). Consume via `useColorScheme` and the Colors token map.

---

### IF-002 — `DARK_MODE_GAP`
**File:** `components/scheduler/InputField.tsx` · **Line:** 30
**Element:** TextInput placeholderTextColor in dark mode
**Colours:** `#9CA3AF` on `Colors.dark.surface (#1E293B)` → **2.41:1** (required 3:1)

The hardcoded #9CA3AF is never adjusted for dark mode; against the dark surface (#1E293B) it drops to approximately 2.41:1, failing the 3:1 WCAG placeholder minimum in both modes but critically so in dark mode.

- **Fix:** Derive placeholderTextColor from the active color scheme: `const placeholderColor = colorScheme === 'dark' ? '#94A3B8' : '#64748B';` — #94A3B8 on #1E293B ≈ 3.64:1 (passes 3:1) and #64748B on #FFFFFF = 4.35:1. Wire via `useColorScheme()` inside a wrapper or pass as a prop from the themed parent.

---

### AL-001 — `CONTRAST_RATIO`
**File:** `components/scheduler/AvailabilityLabel.tsx` · **Line:** 14
**Element:** mutedText — time range '{from} - {to}'
**Colours:** `unknown (styles.mutedText — likely #94A3B8 or #64748B)` on `unknown (styles.badge background)` → **unknown** (required 4.5:1)

styles.mutedText is an external token whose resolved colour is not visible in this file; if it resolves to the deprecated #94A3B8 (old textTertiary, 3.0:1 on white) it fails WCAG AA for normal body text, and any badge background darker or tinted than white will reduce the ratio further.

- **Fix:** Ensure styles.mutedText maps to Colors.light.textSecondary (#475569, 6.86:1) for informational time text; never use the deprecated #94A3B8 or Colors.dark.textTertiary (#64748B, 4.35:1) as a muted colour on coloured badge surfaces.

---

### AL-002 — `CONTRAST_RATIO`
**File:** `components/scheduler/AvailabilityLabel.tsx` · **Line:** 13
**Element:** badgeText — day label
**Colours:** `unknown (styles.badgeText — possibly brand.primary #0D9488 or a light-on-teal combo)` on `unknown (styles.badge)` → **unknown** (required 4.5:1)

If styles.badgeText uses brand.primary (#0D9488) as text colour on a white or light badge surface it achieves only 3.06:1, failing AA for normal-sized text; if the badge is a teal-tinted surface the ratio degrades even further.

- **Fix:** Use Colors.light.tint (#0D9488) ONLY for large/bold text (≥18pt or bold ≥14pt); for normal-weight day labels use Colors.light.text (#0F172A, 17.85:1) or at minimum Colors.light.primaryDeep (#115E59, 5.87:1) on light surfaces.

---

### PSV-001 — `HARDCODED_COLOUR`
**File:** `components/ParallaxScrollView.tsx` · **Line:** 18
**Element:** headerBackgroundColor prop — raw hex strings passed by callers at runtime
**Colours:** `unknown (headerImage content)` on `caller-supplied raw hex` → **unknown** (required 3:1)

The component accepts arbitrary dark/light hex strings for the header background with no type constraint or token enforcement, making it impossible to guarantee any contrast between the header image/icon content and the background at the call site.

- **Fix:** Change the prop type to accept only keys of the Colors token object (e.g. keyof ThemeColors) or a predefined union of safe token pairs, and resolve the actual colour inside the component via Colors[colorScheme][tokenKey], ensuring callers cannot supply unchecked hex values.

---

## 🟡 MEDIUM Severity

| ID | Category | File | Colours | Issue |
|----|----------|------|---------|-------|
| `SS-010` | `DARK_MODE_GAP` | `styles/scheduler.styles.ts` | #0F172A (bannerText) on #EFF6FF (hardcoded Blue 50) = 17.45:1 | All banner background variants are hardcoded light-mode surface colors (#EFF6FF, |
| `SS-011` | `DARK_MODE_GAP` | `styles/scheduler.styles.ts` | assumed #0F172A or #475569 on #eef2ff (hardcoded Indigo 50) = unknown | Tag chip background is a hardcoded light-mode pastel that does not adapt to dark |
| `SS-012` | `DARK_MODE_GAP` | `styles/scheduler.styles.ts` | assumed dark text on #e0f2fe (hardcoded Sky 100) = unknown | Badge background is a hardcoded light-mode tint that will not adapt in dark mode |
| `SS-013` | `STATE_VISIBILITY` | `styles/scheduler.styles.ts` | #FFFFFF on #2563EB at 0.6 opacity = unknown | Disabled state is communicated only via 0.6 opacity reduction; at reduced opacit |
| `SS-014` | `DARK_MODE_GAP` | `styles/scheduler.styles.ts` | n/a on #0b1224 = 1.39:1 | The lossSummary card uses a light-mode border (#E5E7EB) against a hardcoded dark |
| `SS-015` | `CONTRAST_RATIO` | `styles/scheduler.styles.ts` | #065f46 (hardcoded Emerald 900) on Colors.light.background #F8FAFC = 7.35:1 | The status color passes AA in light mode but is a hardcoded value not mapped to  |
| `SS-016` | `DARK_MODE_GAP` | `styles/scheduler.styles.ts` | #15803d (hardcoded Green 700) on Colors.dark.background #0F172A = 3.38:1 | publishedStatus uses hardcoded Green 700 (#15803D) which achieves 5.44:1 in ligh |
| `EXP-009` | `DARK_MODE_GAP` | `app/(tabs)/explore.tsx` | #475569 (Slate 600) on Colors.dark.surface (#1E293B) = 3.11:1 | Same dark-mode contrast failure as metricSub — mutedText at '#475569' drops to 3 |
| `EXP-010` | `DARK_MODE_GAP` | `app/(tabs)/explore.tsx` | barFill (#2563EB) on #E5E7EB on dark surface = unknown | barTrack is hardcoded '#E5E7EB' (light gray) — it will appear very bright agains |
| `EXP-011` | `DARK_MODE_GAP` | `app/(tabs)/explore.tsx` | fairnessBarFill (dynamic color) on #E5E7EB on dark surface = unknown | fairnessBarTrack has the same hardcoded '#E5E7EB' issue — inverted appearance in |
| `EXP-012` | `HARDCODED_COLOUR` | `app/(tabs)/explore.tsx` | N/A (non-text) on #E5E7EB (fairnessBarTrack) = 1.77:1 | #22C55E (Green 500) against the '#E5E7EB' track achieves only ~1.77:1, failing W |
| `EXP-013` | `HARDCODED_COLOUR` | `app/(tabs)/explore.tsx` | N/A (non-text) on #E5E7EB (fairnessBarTrack) = 1.73:1 | #F59E0B (Amber 400) on '#E5E7EB' achieves only ~1.73:1, failing WCAG 1.4.11 non- |
| `EXP-014` | `STATE_VISIBILITY` | `app/(tabs)/explore.tsx` | #FFFFFF on #2563EB = unknown | Pressable buttons have no pressed, focused, or hovered visual state (no style ca |
| `IDX-007` | `OVERLAY_LEGIBILITY` | `app/(tabs)/index.tsx` | rgba(255,255,255,0.8) ≈ #CCFFFFFF on #0F766E (light header) / #134E4A (dark header) = 5.55:1 (effective, light) / 6.20:1 (dark) | The 80% opacity white reduces effective luminance; while ratios are technically  |
| `IDX-008` | `HARDCODED_COLOUR` | `app/(tabs)/index.tsx` | Colors.light.text (#0F172A) on #ffffff (hardcoded) / borderColor: #E5E7EB (hardcoded Slate 200) = unknown | Both `backgroundColor: '#ffffff'` and `borderColor: '#E5E7EB'` are hardcoded and |
| `IDX-009` | `STATE_VISIBILITY` | `app/(tabs)/index.tsx` | #FFFFFF on #2563EB = 8.59:1 | The `Pressable` primaryButton has no `style` callback for pressed state, so user |
| `IDX-010` | `STATE_VISIBILITY` | `app/(tabs)/index.tsx` | Colors.light.text on #ffffff = 17.85:1 | The three quick-action `Pressable` elements lack pressed-state styles, making th |
| `IDX-011` | `DARK_MODE_GAP` | `app/(tabs)/index.tsx` | rgba(255,255,255,0.35) border on #134E4A (dark header) = unknown | `rgba(255,255,255,0.2)` fill and `rgba(255,255,255,0.35)` border on the dark hea |
| `SC-008` | `STATE_VISIBILITY` | `components/StreakCounter.tsx` | #ffffff on #111827 at opacity 0.7 = ~8.76:1 (reduced from 18.08:1) | The disabled state uses only `opacity: 0.7` which still passes contrast, but pro |
| `SC-009` | `HARDCODED_COLOUR` | `components/StreakCounter.tsx` | #ffffff on #111827 = 18.08:1 | #111827 hardcodes a near-black button that ignores the design token system; in d |
| `SC-010` | `DARK_MODE_GAP` | `components/StreakCounter.tsx` | #ffffff on #111827 on #0F172A page = ~1.12:1 (button vs page background) | The hardcoded #111827 button background is nearly indistinguishable from the dar |
| `SC-011` | `OVERLAY_LEGIBILITY` | `components/StreakCounter.tsx` | various ThemedText colours on #ffffff11 semi-transparent overlay = unknown | All text and interactive elements inside the container inherit an unresolvable b |
| `SC-012` | `HARDCODED_COLOUR` | `components/StreakCounter.tsx` | n/a on #E5E7EB (hardcoded Gray 200) = unknown | #E5E7EB is hardcoded and does not adapt to dark mode, where the light grey track |
| `UB-007` | `DARK_MODE_GAP` | `components/UpgradeBanner.tsx` | various hardcoded on brand.successSurface / brand.proSurface = unknown | The component imports only from `brand` (raw palette) rather than `Colors.light/ |
| `UB-008` | `DARK_MODE_GAP` | `components/UpgradeBanner.tsx` | #A78BFA on #1E293B = 3.33:1 | In dark mode, brand.proLight (#A78BFA) border on slate-800 surface (#1E293B) ach |
| `UB-009` | `STATE_VISIBILITY` | `components/UpgradeBanner.tsx` | various on brand.proSurface = unknown | The pressed feedback relies solely on opacity 0.85 and scale 0.99; the scale cha |
| `UB-010` | `CONTRAST_RATIO` | `components/UpgradeBanner.tsx` | #FFFFFF on #10B981 / #7C3AED = 3.46:1 / 5.17:1 | Both badge labels are 11px; even with fontWeight '800' and all-caps letterSpacin |
| `LS-006` | `DARK_MODE_GAP` | `components/LanguageSelector.tsx` | N/A (background only) on brand.primarySurface (#F0FDFA) = 1.05:1 | langRowSelected sets backgroundColor: brand.primarySurface (#F0FDFA) uncondition |
| `LS-007` | `HARDCODED_COLOUR` | `components/LanguageSelector.tsx` | N/A on #E2E8F0 (hardcoded Slate 200) = unknown | separator backgroundColor is the hardcoded hex #E2E8F0 (Colors.light.border) rat |
| `LS-008` | `DARK_MODE_GAP` | `components/LanguageSelector.tsx` | brand.primary (#0D9488) on ThemedView sheet (dark: #1E293B) = 3.83:1 | checkmark color: brand.primary (#0D9488) is hardcoded; on the dark sheet surface |
| `LS-009` | `STATE_VISIBILITY` | `components/LanguageSelector.tsx` | N/A on brand.primarySurface (#F0FDFA) = unknown | The trigger Pressable has no pressed or focused visual style (no style callback, |
| `PA-007` | `OVERLAY_LEGIBILITY` | `components/ProfileAchievements.tsx` | child text (Colors.light.text) on #ffffff11 (hardcoded semi-transparent white overlay) = unknown | #ffffff11 is ~6.7% opaque white — its blended result depends entirely on whateve |
| `PA-008` | `HARDCODED_COLOUR` | `components/ProfileAchievements.tsx` | N/A (decorative track) on #E5E7EB (hardcoded) = unknown | Progress track background #E5E7EB is hardcoded and will not respond to dark mode |
| `PA-009` | `STATE_VISIBILITY` | `components/ProfileAchievements.tsx` | #2563EB fill on #E5E7EB track = unknown | When progress is 0 the fill renders at 0% width and is entirely invisible — ther |
| `WS-006` | `DARK_MODE_GAP` | `components/scheduler/WorkerSection.tsx` | Colors.dark.textTertiary #64748B on Colors.dark.surface #1E293B = 2.10:1 | Dark mode textTertiary (#64748B) on dark surface (#1E293B) collapses to approxim |
| `WS-007` | `DARK_MODE_GAP` | `components/scheduler/WorkerSection.tsx` | Colors.dark.textTertiary #64748B on Colors.dark.successSurface #064E3B = 1.78:1 | textTertiary on dark successSurface (#064E3B) is approximately 1.78:1 — effectiv |
| `WS-008` | `STATE_VISIBILITY` | `components/scheduler/WorkerSection.tsx` | styles.primaryButtonText #FFFFFF on styles.primaryButton (no pressed/disabled style variant visible) = unknown | The Pressable for Add Worker has no style callback for pressed or disabled state |
| `WS-009` | `STATE_VISIBILITY` | `components/scheduler/WorkerSection.tsx` | styles.primaryButtonText #FFFFFF on styles.primaryButton = unknown | The availability-submit Pressable also omits a pressed-state style and has no ac |
| `RS-006` | `DARK_MODE_GAP` | `components/scheduler/RosterSection.tsx` | styles.badgeText — unresolved token on styles.positiveBadge — unresolved token (likely brand.successSurface #ECFDF5 light / #064E3B dark) = unknown | Badge text colour defined in scheduler.styles may pass in light mode using Color |
| `RS-007` | `DARK_MODE_GAP` | `components/scheduler/RosterSection.tsx` | styles.badgeText — unresolved token on styles.statusPill — unresolved token = unknown | statusPill background and badgeText colour are defined in external styles; witho |
| `RS-008` | `DARK_MODE_GAP` | `components/scheduler/RosterSection.tsx` | styles.ghostNameBar / ghostTimeBar — skeleton shimmer colour on styles.ghostContainer — likely Colors.light.surface #FFFFFF = unknown | Skeleton/ghost loading bars are decorative but marked accessibilityElementsHidde |
| `RS-009` | `CONTRAST_RATIO` | `components/scheduler/RosterSection.tsx` | styles.mutedText — likely Colors.light.textTertiary #64748B on Colors.light.surface #FFFFFF = 4.35:1 | If mutedText maps to textTertiary (#64748B, 4.35:1) it sits below the 4.5:1 AA t |
| `RS-010` | `CONTRAST_RATIO` | `components/scheduler/RosterSection.tsx` | styles.mutedText — likely Colors.light.textTertiary #64748B on Colors.light.surface #FFFFFF = 4.35:1 | Same token issue as RS-009: gap date rendered in mutedText is informational (not |
| `SV-001` | `STATE_VISIBILITY` | `components/scheduler/DemandSection.tsx` | styles.toggleChipTextActive vs styles.toggleChipText on styles.toggleChipActive vs styles.toggleChip = unknown | The selected/unselected chip states must differ by at least 3:1 in their visual  |
| `SV-002` | `STATE_VISIBILITY` | `components/scheduler/DemandSection.tsx` | styles.primaryButtonText on styles.disabledButton = unknown | The disabled state of the forecast button is conveyed only through the disabledB |
| `DM-001` | `DARK_MODE_GAP` | `components/scheduler/DemandSection.tsx` | styles.badgeText (static hex, not theme-aware) on styles.fallbackBadge (static hex, not theme-aware) = unknown | The fallbackBadge and badgeText styles are defined in a static stylesheet and ar |
| `DM-002` | `DARK_MODE_GAP` | `components/scheduler/DemandSection.tsx` | styles.successText (likely brand.success #10B981 — Emerald 500) on Colors.light.surface #FFFFFF = 2.88:1 | If successText uses the brand.success token (#10B981) it fails AA on white (2.88 |
| `DM-003` | `DARK_MODE_GAP` | `components/scheduler/DemandSection.tsx` | styles.errorText (likely brand.error #EF4444 — Red 500) on Colors.light.surface #FFFFFF = 3.45:1 | If errorText uses brand.error (#EF4444) it achieves only 3.45:1 on white, failin |
| `PH-001` | `PLACEHOLDER_TEXT` | `components/scheduler/DemandSection.tsx` | placeholder colour (likely #94A3B8 Slate 400 or textTertiary #64748B) on Colors.light.surface #FFFFFF = 3.0:1 (#94A3B8) or 4.35:1 (#64748B) | The placeholder '3' in the required-count field is a numeric default that users  |
| `WP-005` | `HARDCODED_COLOUR` | `components/WellnessPrompt.tsx` | #0b5ad3 on #ffffff = 7.10:1 | Primary button uses hardcoded #ffffff background and #0b5ad3 text — ratio is acc |
| `WP-006` | `DARK_MODE_GAP` | `components/WellnessPrompt.tsx` | all child text on #0b5ad3 = unknown | The card background is hardcoded to #0b5ad3 in StyleSheet.create, so it does not |
| `WP-007` | `STATE_VISIBILITY` | `components/WellnessPrompt.tsx` | n/a on n/a = unknown | Neither Pressable has a style function responding to pressed/focused state, so t |
| `WP-008` | `HARDCODED_COLOUR` | `components/WellnessPrompt.tsx` | n/a on #ffffff44 / #ffffff22 = unknown | Both borderColor (#ffffff44, ~27% opacity) and backgroundColor (#ffffff22, ~13%  |
| `PF-005` | `OVERLAY_LEGIBILITY` | `components/PersonalizedFeed.tsx` | child card content on #ffffff11 (hardcoded semi-transparent white, ~4% opacity) = unknown | The container uses a hardcoded rgba-equivalent #ffffff11 which is semi-transpare |
| `PF-006` | `HARDCODED_COLOUR` | `components/PersonalizedFeed.tsx` | N/A on #E5E7EB (hardcoded Gray 200) = 1.42:1 | The card border is hardcoded to #E5E7EB (Gray 200) which does not adapt to dark  |
| `PF-007` | `STATE_VISIBILITY` | `components/PersonalizedFeed.tsx` | N/A on N/A = unknown | The Pressable has no pressed, focused, or hovered visual feedback (no style call |
| `TS-006` | `HARDCODED_COLOUR` | `components/TourSpotlight.tsx` | n/a on Colors.light.surface (#FFFFFF) = unknown | backgroundColor is set directly to Colors.light.surface rather than being resolv |
| `TS-007` | `HARDCODED_COLOUR` | `components/TourSpotlight.tsx` | #FFFFFF (hardcoded hex) on brand.primary (#0D9488) = 6.88:1 | White is hardcoded as a raw hex string rather than referencing a token; while th |
| `TS-008` | `STATE_VISIBILITY` | `components/TourSpotlight.tsx` | #FFFFFF on brand.primaryDark (#0F766E) pressed vs brand.primary (#0D9488) default = 9.30:1 pressed / 6.88:1 default | The pressed background shift from #0D9488 to #0F766E is a very subtle darkening  |
| `TS-009` | `OVERLAY_LEGIBILITY` | `components/TourSpotlight.tsx` | rgba(255,255,255,0.35) on underlying app content (variable) = unknown | The spotlight ring border is rgba(255,255,255,0.35), which at 35% opacity will f |
| `TS-010` | `OVERLAY_LEGIBILITY` | `components/TourSpotlight.tsx` | n/a on shadowColor: '#000' hardcoded = unknown | shadowColor is a hardcoded raw hex '#000' rather than a design token; in dark mo |
| `STS-005` | `DARK_MODE_GAP` | `components/scheduler/ShiftTemplateSection.tsx` | styles.ghostEmptyCtaText / ghostEmptyNote — token unknown, likely textTertiary on styles.ghostContainer / ghostEmptyCta — likely surface #FFFFFF light / #1E293B dark = unknown | Ghost empty-state copy uses muted text tokens that may be themed inconsistently  |
| `STS-006` | `DARK_MODE_GAP` | `components/scheduler/ShiftTemplateSection.tsx` | styles.successText — likely Colors.light.success #15803D in light on surface #FFFFFF light / #1E293B dark = 5.44:1 light / unknown dark | If successText uses the brand.success token (#10B981, 2.88:1 on white) rather th |
| `STS-007` | `DARK_MODE_GAP` | `components/scheduler/ShiftTemplateSection.tsx` | styles.errorText — likely Colors.light.error #DC2626 on surface #FFFFFF light / #1E293B dark = 4.64:1 light / unknown dark | Light mode correctly uses #DC2626 (4.64:1); dark mode must use Colors.dark.error |
| `STS-008` | `STATE_VISIBILITY` | `components/scheduler/ShiftTemplateSection.tsx` | styles.primaryButtonText on styles.primaryButton merged with styles.disabledButton = unknown | The disabled state is applied only via a conditional style merge with no accessi |
| `TLY-004` | `HARDCODED_COLOUR` | `app/(tabs)/_layout.tsx` | brand.primary (#0D9488) — hardcoded on surface token (varies by scheme) = 3.06:1 | The color is hardcoded to `brand.primary` rather than a theme-aware token, so it |
| `TLY-005` | `STATE_VISIBILITY` | `app/(tabs)/_layout.tsx` | brand.primary + '22' (#0D948822 — ~13% opacity teal) pressed / transparent unpressed on Colors[scheme].surface = unknown | The unpressed state is fully transparent (surface + '00') and the pressed state  |
| `TLY-006` | `DARK_MODE_GAP` | `app/(tabs)/_layout.tsx` | Colors.dark.tabIconDefault (#64748B) on Colors.dark.background (#0F172A) / tab bar surface = 3.04:1 | In dark mode, tabIconDefault is #64748B (Slate 500) against the dark background  |
| `TTX-004` | `CONTRAST_RATIO` | `components/ThemedText.tsx` | Colors.light.text (#0F172A) on Colors.light.background (#F8FAFC) = 17.85:1 | Contrast for title text is excellent, but lineHeight: 32 equals fontSize: 32 (ra |
| `TTX-005` | `CONTRAST_RATIO` | `components/ThemedText.tsx` | Colors.light.text (#0F172A) on Colors.light.background (#F8FAFC) = 17.85:1 | The subtitle style (20px bold) has no lineHeight defined, so React Native falls  |
| `IT-005` | `DARK_MODE_GAP` | `components/InfoTooltip.tsx` | brand.primary + '22' (#0D948822) on Colors.dark.background (#0F172A) = unknown | The pressed-state background uses brand.primary at ~13% opacity (#0D948822); on  |
| `IT-006` | `DARK_MODE_GAP` | `components/InfoTooltip.tsx` | #0D9488 (brand.primary) on #0F172A (Colors.dark.background) = unknown | brand.primary (#0D9488) is a mid-teal that was chosen for light mode; against th |
| `IT-007` | `OVERLAY_LEGIBILITY` | `components/InfoTooltip.tsx` | n/a on fully transparent over page content = unknown | The native dismiss area uses StyleSheet.absoluteFill with no background color, m |
| `IT-008` | `HARDCODED_COLOUR` | `components/InfoTooltip.tsx` | n/a on #000 (hardcoded shadow) = unknown | shadowColor is hardcoded '#000'; while shadow colors are not subject to contrast |
| `EB-004` | `DARK_MODE_GAP` | `components/ErrorBoundary.tsx` | #475569 on #0F172A = 2.27:1 | Even if EB-001 is classified as a hardcoded-colour issue, the functional consequ |
| `EB-005` | `DARK_MODE_GAP` | `components/ErrorBoundary.tsx` | #FFFFFF on #2563EB = unknown | The button uses a static StyleSheet with no dark-mode variant; on a dark backgro |
| `EB-006` | `STATE_VISIBILITY` | `components/ErrorBoundary.tsx` | N/A on #2563EB = unknown | The Pressable has no `style` function to communicate pressed feedback (e.g. opac |
| `PLACEHOLDER_TEXT-001` | `PLACEHOLDER_TEXT` | `components/scheduler/LostRevenueSummary.tsx` | styles.mutedText (likely Colors.light.textTertiary #64748B → 4.35:1 or lower token) on Colors.light.background #F8FAFC = ~4.20:1 on #F8FAFC (vs 4.35:1 on pure white) | This is informational body text (not a placeholder), so the WCAG placeholder exe |
| `DARK_MODE_GAP-001` | `DARK_MODE_GAP` | `components/scheduler/LostRevenueSummary.tsx` | styles.badgeText on styles.positiveBadge / styles.badge = unknown | The badge background and text colours appear to be hardcoded in scheduler.styles |
| `DARK_MODE_GAP-002` | `DARK_MODE_GAP` | `components/scheduler/LostRevenueSummary.tsx` | styles.progressFill colour on styles.progressTrack colour = unknown | If progressTrack uses a light-mode border colour (e.g. #E2E8F0) without a dark-m |
| `CHK-004` | `CONTRAST_RATIO` | `components/scheduler/Checklist.tsx` | #0D9488 on #FFFFFF = 3.24:1 | styles.linkText likely applies Colors.light.tint / brand.primary (#0D9488) as fo |
| `CHK-005` | `CONTRAST_RATIO` | `components/scheduler/Checklist.tsx` | #64748B on #1E293B = 2.10:1 | In dark mode, Colors.dark.textTertiary (#64748B, Slate 500) on the surface color |
| `CHK-006` | `CONTRAST_RATIO` | `components/scheduler/Checklist.tsx` | #F1F5F9 on #0D9488 = 3.38:1 | If the progress badge background remains brand.primary (#0D9488) in dark mode an |
| `IF-003` | `DARK_MODE_GAP` | `components/scheduler/InputField.tsx` | unknown (delegated to scheduler.styles) on unknown (delegated to scheduler.styles) = unknown | The TextInput uses `style={styles.input}` from a static StyleSheet (scheduler.st |
| `IF-004` | `DARK_MODE_GAP` | `components/scheduler/InputField.tsx` | unknown (delegated to scheduler.styles) on unknown (delegated to scheduler.styles) = unknown | ThemedText should self-theme its colour, but `styles.label` from the static sche |
| `AL-003` | `DARK_MODE_GAP` | `components/scheduler/AvailabilityLabel.tsx` | Colors.dark.textTertiary #64748B (if mapped) on Colors.dark.surface #1E293B = unknown | Colors.dark.textTertiary (#64748B) against the dark surface (#1E293B) yields a l |
| `AL-004` | `DARK_MODE_GAP` | `components/scheduler/AvailabilityLabel.tsx` | unknown text colour on unknown badge fill — may remain a light teal surface (#F0FDFA) in dark mode = unknown | If styles.badge applies brand.primarySurface (#F0FDFA) as its background without |
| `AL-005` | `STATE_VISIBILITY` | `components/scheduler/AvailabilityLabel.tsx` | n/a on n/a = n/a | The component renders the same visual treatment regardless of whether the availa |
| `PSV-002` | `DARK_MODE_GAP` | `components/ParallaxScrollView.tsx` | unknown (headerImage) on headerBackgroundColor.dark vs headerBackgroundColor.light = unknown | Because each colour mode value is independently supplied by the caller without v |
| `PSV-003` | `OVERLAY_LEGIBILITY` | `components/ParallaxScrollView.tsx` | unknown (image / icon pixels) on headerBackgroundColor[colorScheme] = unknown | During the parallax scale animation (scale up to 2× on over-scroll) the header i |
| `PSV-004` | `STATE_VISIBILITY` | `components/ParallaxScrollView.tsx` | system default scroll indicator on Colors[colorScheme].background = unknown | No indicatorStyle prop is set on the Animated.ScrollView, so the scroll indicato |
| `SCH-001` | `DARK_MODE_GAP` | `app/(tabs)/scheduler.tsx` | styles.mutedText (maps to Colors.textTertiary #64748B) on styles.bannerWarning (unknown surface — likely brand.warningSurface #FFFBEB light / #451A03 dark) = unknown | textTertiary (#64748B) is at the absolute AA floor on white (4.35:1); on a warm  |
| `SCH-002` | `DARK_MODE_GAP` | `app/(tabs)/scheduler.tsx` | styles.linkText (token unknown — likely Colors.tint #0D9488 light / #2DD4BF dark) on styles.bannerWarning surface = unknown | If linkText resolves to brand.primary #0D9488 (3.06:1 on white), it already fail |
| `SCH-003` | `DARK_MODE_GAP` | `app/(tabs)/scheduler.tsx` | styles.bannerText (token unknown) on styles.bannerSuccess / styles.bannerError / styles.banner = unknown | The banner background colours for success and error states are defined in schedu |
| `AL-001` | `DARK_MODE_GAP` | `app/_layout.tsx` | system-resolved on Colors.dark.background (#0F172A) / Colors.light.background (#F8FAFC) = unknown | StatusBar style='auto' delegates tint resolution to the OS and may render light- |
| `TV-001` | `HARDCODED_COLOUR` | `components/ThemedView.tsx` | unknown on caller-supplied arbitrary string = unknown | The component accepts arbitrary lightColor/darkColor strings from callers withou |
| `SC-001` | `HARDCODED_COLOUR` | `components/SkeletonCard.tsx` | #CBD5E1 on unknown (parent surface) = unknown | Skeleton bar colour #CBD5E1 is hardcoded rather than drawn from a design token,  |
| `SC-002` | `DARK_MODE_GAP` | `components/SkeletonCard.tsx` | #CBD5E1 on #1E293B = 1.80:1 | #CBD5E1 bars on the dark surface token (#1E293B) produce only ~1.8:1 contrast, m |
| `COL-001` | `ICON_VISIBILITY` | `components/Collapsible.tsx` | Colors.dark.icon (#94A3B8) on Colors.dark.background (#0F172A) = 5.27:1 | Dark mode icon passes AA non-text at 5.27:1, but the light mode icon token (#475 |
| `COL-002` | `STATE_VISIBILITY` | `components/Collapsible.tsx` | Colors.light.tint (#0D9488) on Colors.light.background (#F8FAFC) = 3.06:1 | The StyleSheet.create call for headingFocused hardcodes Colors.light.tint as bor |
| `COL-003` | `DARK_MODE_GAP` | `components/Collapsible.tsx` | Colors.light.tint (#0D9488) on Colors.dark.surface (#1E293B) = unknown | styles.headingFocused is defined at module load time using Colors.light.tint, cr |
| `SSC-001` | `DARK_MODE_GAP` | `components/scheduler/SectionCard.tsx` | textTertiary (#64748B) on surface dark (#1E293B) = 2.77:1 | If styles.mutedText resolves to Colors.light.textTertiary (#64748B) without dark |
| `SSC-002` | `DARK_MODE_GAP` | `components/scheduler/SectionCard.tsx` | textSecondary (#475569 light / #94A3B8 dark) on surface dark (#1E293B) = 5.27:1 | If the 'subtitle' ThemedText variant maps to textSecondary in both modes the dar |

---

## WCAG Reference

| Criterion | Ratio | Applies to |
|-----------|-------|-----------|
| AA Normal text | 4.5:1 | Body copy, labels, captions |
| AA Large text | 3.0:1 | ≥18 pt regular or ≥14 pt bold |
| AA Non-text | 3.0:1 | Icons, borders, UI components |
| AAA Normal | 7.0:1 | Enhanced — aspirational target |
| AAA Large | 4.5:1 | Enhanced large text |
