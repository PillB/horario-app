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
    text: '#0F172A',           // Slate 900 — max legibility
    textSecondary: '#64748B',  // Slate 500 — secondary
    textTertiary: '#94A3B8',   // Slate 400 — placeholders/hints

    // Surfaces
    background: '#F8FAFC',     // Slate 50 — page background
    surface: '#FFFFFF',        // Pure white — cards/inputs
    surfaceRaised: '#FFFFFF',  // Cards with elevation
    border: '#E2E8F0',         // Slate 200
    borderFocus: '#0D9488',    // Teal — focused input ring

    // Brand
    tint: '#0D9488',
    icon: '#64748B',
    tabIconDefault: '#94A3B8',
    tabIconSelected: '#0D9488',

    // Semantic
    success: brand.success,
    successSurface: brand.successSurface,
    error: brand.error,
    errorSurface: brand.errorSurface,
    warning: brand.accent,
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
export type ThemeColors = typeof Colors.light;
