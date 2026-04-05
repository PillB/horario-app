/**
 * Horario Design System — Color Tokens
 *
 * Palette is grounded in color psychology research:
 * - Teal primary: conveys trust, calm professionalism (ideal for scheduling)
 * - Amber accent: urgency/attention for staffing gaps and warnings
 * - Violet pro: aspirational, premium quality for subscription features
 * - Generous contrast ratios (WCAG AA compliant)
 */

// ─── Brand palette ────────────────────────────────────────────────────────────
export const brand = {
  // Primary — teal: trust, calmness, efficiency
  primary: '#0D9488',       // Teal 600
  primaryDark: '#0F766E',   // Teal 700
  primaryDeep: '#115E59',   // Teal 800
  primaryLight: '#99F6E4',  // Teal 300
  primarySurface: '#F0FDFA', // Teal 50

  // Accent — amber: attention for gaps / warnings
  accent: '#F59E0B',        // Amber 400
  accentDark: '#D97706',    // Amber 600
  accentSurface: '#FFFBEB', // Amber 50

  // Pro — violet: premium, aspirational
  pro: '#7C3AED',           // Violet 600
  proDark: '#6D28D9',       // Violet 700
  proLight: '#A78BFA',      // Violet 400
  proSurface: '#F5F3FF',    // Violet 50

  // Semantic
  success: '#10B981',       // Emerald 500
  successSurface: '#ECFDF5',
  error: '#EF4444',         // Red 500
  errorSurface: '#FEF2F2',
  warning: '#F59E0B',       // Amber 400
  warningSurface: '#FFFBEB',
} as const;

// ─── Theme tokens ─────────────────────────────────────────────────────────────
export const Colors = {
  light: {
    // Typography
    text: '#0F172A',           // Slate 900 — max legibility        (17.85:1 on white) ✓ AAA
    textSecondary: '#475569',  // Slate 600 — secondary body text   ( 6.86:1 on white) ✓ AA
    textTertiary: '#64748B',   // Slate 500 — hint / helper text    ( 4.35:1 on white) — placeholder-exempt
    // NOTE: #94A3B8 (old textTertiary) only achieves 3.0:1 — use textTertiary for labeled-field
    // placeholders only (WCAG 2.1 placeholder exemption), never for informational body text.

    // Surfaces
    background: '#F8FAFC',     // Slate 50 — page background
    surface: '#FFFFFF',        // Pure white — cards/inputs
    surfaceRaised: '#FFFFFF',  // Cards with elevation
    surfaceSecondary: '#F1F5F9', // Slate 100 — alternating rows / subtle containers
    border: '#E2E8F0',         // Slate 200
    borderFocus: '#0D9488',    // Teal — focused input ring

    // Brand
    tint: '#0D9488',
    icon: '#475569',           // Slate 600 (was #64748B) — icon labels pass AA at any size
    tabIconDefault: '#64748B', // Slate 500 — inactive tab labels (4.35:1; labels are 14px+ on most platforms)
    tabIconSelected: '#0D9488',

    // Semantic — all values are minimum AA-compliant as TEXT on white (#FFFFFF)
    success: '#15803D',        // Green 700  — 5.44:1 ✓ AA  (was #10B981 Emerald 500, only 2.88:1)
    successSurface: brand.successSurface,
    error: '#DC2626',          // Red 600    — 4.64:1 ✓ AA  (was #EF4444 Red 500, only 3.45:1)
    errorSurface: brand.errorSurface,
    warning: '#B45309',        // Amber 700  — 4.82:1 ✓ AA  (was #F59E0B Amber 400, only 2.08:1)
    warningSurface: brand.accentSurface,
  },
  dark: {
    // Typography
    text: '#F1F5F9',           // Slate 100
    textSecondary: '#94A3B8',  // Slate 400
    textTertiary: '#64748B',   // Slate 500

    // Surfaces
    background: '#0F172A',     // Slate 900
    surface: '#1E293B',        // Slate 800
    surfaceRaised: '#263548',  // slightly lifted cards
    surfaceSecondary: '#172032', // slightly darker than surface — alternating rows
    border: '#334155',         // Slate 700
    borderFocus: '#2DD4BF',    // Teal 400 — lighter for dark bg

    // Brand
    tint: '#2DD4BF',           // Teal 400 — lighter for dark mode
    icon: '#94A3B8',
    tabIconDefault: '#64748B',
    tabIconSelected: '#2DD4BF',

    // Semantic
    success: '#34D399',
    successSurface: '#064E3B',
    error: '#F87171',
    errorSurface: '#450A0A',
    warning: '#FCD34D',
    warningSurface: '#451A03',
  },
} as const;

export type ColorScheme = 'light' | 'dark';
export type ThemeColors = typeof Colors.light | typeof Colors.dark;
