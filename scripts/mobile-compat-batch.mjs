/**
 * mobile-compat-batch.mjs
 *
 * iOS/Android/mobile-web compatibility + i18n compliance + UI/UX polish
 * Model: claude-sonnet-4-6  (Batch API — 50% off)
 *
 * 6 requests:
 *   1. Build config   → metro.config.js (NEW) + app.json + eas.json updates
 *   2. Locale + RTL   → hooks/useLocale.ts (device detection, RTL, formatters)
 *                     + scripts/locale-capability-snippet.txt (new en keys)
 *   3. Responsive sys → hooks/useResponsive.ts (NEW) breakpoints + safe area
 *   4. Hardcoded str  → CapabilityMatrix.tsx + AdvancedControls.tsx full rewrites
 *                       with all user-facing strings through t()
 *   5. Keyboard/form  → WorkerSection.tsx + ShiftTemplateSection.tsx
 *                       consistent KeyboardAvoidingView + ScrollView wrapping
 *   6. Browser safety → RosterSection.tsx WebPortal + usePrintStyles SSR guard
 *
 * Usage:
 *   node --env-file=.env.local scripts/mobile-compat-batch.mjs
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function read(relPath) {
  const abs = path.join(ROOT, relPath);
  return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : `// FILE NOT FOUND: ${relPath}`;
}

function write(relPath, content) {
  const abs = path.join(ROOT, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
  console.log(`  ✓ wrote ${relPath}`);
}

function stripFences(text) {
  return text
    .replace(/^```(?:typescript|tsx|ts|jsx|js|mjs|json|jsonc|javascript)?\s*/im, '')
    .replace(/\s*```\s*$/m, '')
    .trim();
}

function splitFiles(text) {
  const parts = {};
  const segments = text.split(/===FILE_\d+:\s*/);
  for (const seg of segments) {
    const lineEnd = seg.indexOf('\n');
    if (lineEnd < 0) continue;
    const header = seg.slice(0, lineEnd).replace(/===$/, '').trim();
    const body = stripFences(seg.slice(lineEnd + 1).trim());
    if (header && body) parts[header] = body;
  }
  return parts;
}

// ─── Source snapshots ─────────────────────────────────────────────────────────

const APP_JSON           = read('app.json');
const EAS_JSON           = read('eas.json');
const USE_LOCALE_TS      = read('hooks/useLocale.ts');
const WORKER_SECTION_TSX = read('components/scheduler/WorkerSection.tsx');
const SHIFT_TPL_TSX      = read('components/scheduler/ShiftTemplateSection.tsx');
const ROSTER_TSX         = read('components/scheduler/RosterSection.tsx');
const CAPABILITY_TSX     = read('components/CapabilityMatrix.tsx');
const ADVANCED_CTRL_TSX  = read('components/scheduler/AdvancedControls.tsx');
const COLORS_TS          = read('constants/Colors.ts').slice(0, 1000);
const LOCALE_EN_SNIPPET  = read('locales/en.ts').slice(0, 5000); // first 5k for structure

const client = new Anthropic();

const requests = [

  // ── 1. Build Config ────────────────────────────────────────────────────────
  {
    custom_id: 'build-config',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 5120,
      messages: [{ role: 'user', content: `
You are a React Native / Expo build configuration expert. Fix the build configuration files for the Horario app (Expo SDK 53, RN 0.79.2, Expo Router v5, targeting iOS + Android + web via Vercel).

## Current app.json
\`\`\`json
${APP_JSON}
\`\`\`

## Current eas.json
\`\`\`json
${EAS_JSON}
\`\`\`

## Problems to fix:

### app.json:
1. Add \`"bundleIdentifier": "com.horario.app"\` under \`ios\`
2. Add \`"package": "com.horario.app"\` under \`android\`
3. Add \`"minSdkVersion": 24\` under \`android\` (Android 7.0+, required for modern crypto)
4. Add iOS minimum deployment target by adding \`"buildNumber": "1"\` and \`"deploymentTarget": "16.0"\` under \`ios\`
5. Add a privacy manifest stub: under \`ios\`, add \`"privacyManifests": { "NSPrivacyAccessedAPITypes": [] }\`
6. Add \`"adaptiveIcon"\` background color to match brand: \`"backgroundColor": "#0F766E"\`
7. Keep all existing fields intact.

### eas.json:
1. Add \`"android"\` to the \`development\` profile: \`{ "buildType": "apk", "gradleCommand": ":app:assembleDebug" }\`
2. Add a \`"preview"\` Android config: \`{ "buildType": "apk" }\`
3. Add \`"production"\` ios profile: \`{ "autoIncrement": true }\`
4. Add \`"production"\` android profile: \`{ "buildType": "app-bundle" }\`
5. Add \`"env"\` block to production profile documenting required env vars (EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY, etc.) as comments.

### metro.config.js (NEW file — does not yet exist):
Create a metro.config.js that:
1. Extends Expo's default Metro config via \`require('expo/metro-config').getDefaultConfig(__dirname)\`
2. Configures \`resolver.platforms\` to include \`['ios', 'android', 'web', 'native']\` (explicit priority order: native-specific overrides first)
3. Adds \`resolver.assetExts\` extension for \`ttf\` fonts (already used in the project)
4. Configures \`transformer.minifierConfig\` to \`{ compress: { drop_console: process.env.NODE_ENV === 'production' } }\` to strip console.log in prod builds
5. Adds a comment explaining the \`newArchEnabled: true\` requirement (already set in app.json)
6. Does NOT add any undocumented or experimental flags

Output format:
===FILE_1: app.json===
[complete updated app.json content]

===FILE_2: eas.json===
[complete updated eas.json content]

===FILE_3: metro.config.js===
[complete new metro.config.js content]

No markdown fences inside file content sections. Return valid JSON for JSON files.
` }],
    },
  },

  // ── 2. Locale + RTL ────────────────────────────────────────────────────────
  {
    custom_id: 'locale-rtl',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 6144,
      messages: [{ role: 'user', content: `
You are an i18n expert for React Native / Expo apps. Update the Horario useLocale hook for device locale detection and RTL support.

## Current hooks/useLocale.ts
\`\`\`typescript
${USE_LOCALE_TS}
\`\`\`

## Current locales/en.ts structure (excerpt)
\`\`\`typescript
${LOCALE_EN_SNIPPET}
\`\`\`

## Supported languages
en, es, de, fr, it, zh, sw, tl, hi

## Changes required:

### hooks/useLocale.ts — full rewrite:
1. **Device locale detection on first launch**: When no language is saved in AsyncStorage, detect the device locale using \`expo-localization\` (\`import { getLocales } from 'expo-localization'\`). Map the device's BCP-47 language code to the nearest supported LangCode (e.g., 'en-US' → 'en', 'es-MX' → 'es', 'zh-CN' → 'zh', 'hi-IN' → 'hi'). Fall back to 'en' if no match.
2. **RTL support**: After applyLanguage resolves, call \`import { I18nManager } from 'react-native'\` and set \`I18nManager.forceRTL(isRTL)\` where \`isRTL = ['ar', 'he', 'fa', 'ur'].includes(code)\`. For now hi/sw/tl/zh are LTR — only future RTL languages trigger this. Include a comment saying RTL reload requires restart.
3. **Date/number formatters**: Export helper \`formatDate(date: Date | string, langCode: LangCode, options?: Intl.DateTimeFormatOptions): string\` — uses \`Intl.DateTimeFormat\` with the BCP-47 code for the langCode (map: \`{ en: 'en-US', es: 'es-MX', de: 'de-DE', fr: 'fr-FR', it: 'it-IT', zh: 'zh-CN', sw: 'sw-KE', tl: 'tl-PH', hi: 'hi-IN' }\`). Also export \`formatNumber(n: number, langCode: LangCode): string\` using \`Intl.NumberFormat\`.
4. **t() fallback safety**: When a translation key is missing AND the English base is also missing, return \`''\` (empty string) instead of the raw key path. This ensures no dot-path variable names are ever shown to users.
5. **Pluralization helper**: Export \`tPlural(path: string, count: number, params?: Record<string,string>): string\` — appends \`_one\` or \`_other\` to the path based on count, falls back to base path.
6. Keep all existing exports and behavior intact (AsyncStorage persistence, stale-request guard, setLanguage, isLoading).

### scripts/locale-capability-snippet.txt (NEW):
A text file containing TypeScript snippet showing the new locale keys that must be added to ALL 9 locale files (en.ts, es.ts, de.ts, fr.ts, it.ts, zh.ts, sw.ts, tl.ts, hi.ts). Include these keys under a \`capability\` namespace:
- capability.header.feature: 'Feature'
- capability.header.free: 'Free'
- capability.header.pro: 'Pro'
- capability.unlimitedWorkers: 'Unlimited workers'
- capability.shiftTemplates: 'Shift templates'
- capability.availabilityTracking: 'Availability tracking'
- capability.rosterAssignment: 'Roster assignment'
- capability.demandTargets: 'Demand targets'
- capability.posCsvImport: 'POS CSV import'
- capability.autoAssign: 'Auto-assign'
- capability.advancedAnalytics: 'Advanced analytics'
- capability.multiLocation: 'Multi-location'
- capability.messaging: 'Messaging & comms'
- capability.prioritySupport: 'Priority support'
- capability.upgrade.title: 'Unlock Pro features'
- capability.upgrade.body: 'Remove restrictions and access advanced tools.'
- capability.upgrade.cta: 'Upgrade to Pro'
- capability.upgrade.ctaHint: 'Opens the billing page to start your Pro subscription'
- capability.upgrade.price: 'Plans start at \$12/mo · Cancel anytime'
Also include advanced controls keys:
- advancedControls.title: 'Advanced controls'
- advancedControls.constraints.title: 'Shift constraints'
- advancedControls.constraints.minRest: 'Min rest hours between shifts'
- advancedControls.constraints.maxWeekly: 'Max weekly hours'
- advancedControls.constraints.minShift: 'Min shift length (hours)'
- advancedControls.presets.title: 'Industry presets'
- advancedControls.presets.restaurant: 'Restaurant'
- advancedControls.presets.retail: 'Retail'
- advancedControls.presets.cafe: 'Café'
- advancedControls.presets.hotel: 'Hotel'
- advancedControls.multiLocation.title: 'Multi-location'
- advancedControls.multiLocation.toggle: 'Enable per-location scheduling'
- advancedControls.multiLocation.locations: 'Location names (comma-separated)'

Format:
===FILE_1: hooks/useLocale.ts===
[complete rewrite]

===FILE_2: scripts/locale-capability-snippet.txt===
[TypeScript object snippet showing all new keys for copy-paste into locale files]

No markdown fences inside file content sections.
` }],
    },
  },

  // ── 3. Responsive system ───────────────────────────────────────────────────
  {
    custom_id: 'responsive-system',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 5120,
      messages: [{ role: 'user', content: `
You are a React Native responsive design expert. Create a responsive design system hook for the Horario app (Expo SDK 53, RN 0.79.2, supports iOS + Android + web).

## constants/Colors.ts (excerpt)
\`\`\`typescript
${COLORS_TS}
\`\`\`

Create ONE file:

===FILE_1: hooks/useResponsive.ts===

Requirements:
1. **Breakpoints** (screen width-based):
   \`\`\`
   xs: width < 360    (small Android phones)
   sm: width < 414    (iPhone SE, standard phones)
   md: width < 768    (large phones, foldables)
   lg: width < 1024   (tablets, iPad mini)
   xl: width >= 1024  (iPad Pro, desktop web)
   \`\`\`
2. Export \`useResponsive()\` hook returning:
   - \`breakpoint: 'xs'|'sm'|'md'|'lg'|'xl'\`
   - \`width: number\`, \`height: number\`
   - \`isTablet: boolean\` (lg or xl)
   - \`isPhone: boolean\` (!isTablet)
   - \`isLandscape: boolean\` (width > height)
   - \`isWideLayout: boolean\` (same as current width >= 768 for backward compat)
   - \`safeTop: number\`, \`safeBottom: number\`, \`safeLeft: number\`, \`safeRight: number\` — from \`react-native-safe-area-context\`
   - \`contentPaddingH: number\` — horizontal padding: xs/sm=16, md=20, lg/xl=32
   - \`contentMaxWidth: number\` — max content width: phone=100%, tablet=720, xl=960
   - \`fontScale: (base: number) => number\` — scale font size proportionally: xs*0.9, sm*1.0, md*1.0, lg*1.05, xl*1.1; always clamp between 10 and 48
3. Export \`responsive\` object (non-hook static utility for StyleSheet.create contexts):
   - \`spacing: { xs:4, sm:8, md:12, lg:16, xl:24, xxl:32, xxxl:48 }\`
   - \`radius: { sm:4, md:8, lg:12, xl:16, pill:999 }\`
   - \`fontSize: { xs:11, sm:13, md:15, lg:17, xl:20, xxl:24, display:32 }\`
4. Export \`useKeyboardOffset()\` hook returning the correct KeyboardAvoidingView behavior string and estimated offset:
   - iOS: \`{ behavior: 'padding' as const, keyboardVerticalOffset: 0 }\`
   - Android: \`{ behavior: 'height' as const, keyboardVerticalOffset: 0 }\`
   - Web: \`{ behavior: undefined, keyboardVerticalOffset: 0 }\`
5. All TypeScript strict mode, no \`any\`.
6. Imports: \`useWindowDimensions\` from react-native; \`useSafeAreaInsets\` from react-native-safe-area-context; \`Platform\` from react-native.

No markdown fences inside the file content section.
` }],
    },
  },

  // ── 4. Hardcoded strings audit ─────────────────────────────────────────────
  {
    custom_id: 'hardcoded-strings',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      messages: [{ role: 'user', content: `
You are an i18n compliance expert. Rewrite two React Native components to ensure ZERO hardcoded user-facing strings — all text must go through the t() translation function.

## components/CapabilityMatrix.tsx (current — has hardcoded English fallback strings directly in JSX)
\`\`\`typescript
${CAPABILITY_TSX}
\`\`\`

## components/scheduler/AdvancedControls.tsx (current — has hardcoded preset names and labels)
\`\`\`typescript
${ADVANCED_CTRL_TSX}
\`\`\`

## constants/Colors.ts (excerpt)
\`\`\`typescript
${COLORS_TS}
\`\`\`

## i18n locale keys available (the new capability.* and advancedControls.* keys added in this batch):
- capability.header.feature, capability.header.free, capability.header.pro
- capability.unlimitedWorkers, capability.shiftTemplates, capability.availabilityTracking
- capability.rosterAssignment, capability.demandTargets, capability.posCsvImport
- capability.autoAssign, capability.advancedAnalytics, capability.multiLocation
- capability.messaging, capability.prioritySupport
- capability.upgrade.title, capability.upgrade.body, capability.upgrade.cta
- capability.upgrade.ctaHint, capability.upgrade.price
- advancedControls.title, advancedControls.constraints.title
- advancedControls.constraints.minRest, advancedControls.constraints.maxWeekly
- advancedControls.constraints.minShift, advancedControls.presets.title
- advancedControls.presets.restaurant, advancedControls.presets.retail
- advancedControls.presets.cafe, advancedControls.presets.hotel
- advancedControls.multiLocation.title, advancedControls.multiLocation.toggle
- advancedControls.multiLocation.locations

## Rules:
1. Every string visible to the user MUST use \`t('some.key')\` — NO hardcoded English in JSX or accessibilityLabel.
2. The \`fallback\` field in FeatureRow is ONLY for developer debugging — do NOT render it directly; always use \`t(row.i18nKey)\` (which internally falls back to English if the key is missing in the locale file).
3. No dot-path keys should ever be rendered to users (t() must return '' not the key path when missing — but that is handled in useLocale.ts).
4. All \`accessibilityLabel\`, \`accessibilityHint\`, \`accessibilityRole\` values must also use t() or meaningful computed strings.
5. Keep ALL existing prop types, styles, and functional logic 100% intact.
6. Only change strings — do not refactor logic.

Output:
===FILE_1: components/CapabilityMatrix.tsx===
[full rewrite — same logic, all strings through t()]

===FILE_2: components/scheduler/AdvancedControls.tsx===
[full rewrite — same logic, all strings through t()]

No markdown fences inside file content sections.
` }],
    },
  },

  // ── 5. Keyboard / form UX ──────────────────────────────────────────────────
  {
    custom_id: 'keyboard-form-ux',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      messages: [{ role: 'user', content: `
You are a React Native UX expert. Fix keyboard avoidance, ScrollView wrapping, and focus management in two scheduler form section components.

## components/scheduler/WorkerSection.tsx (current)
\`\`\`typescript
${WORKER_SECTION_TSX}
\`\`\`

## components/scheduler/ShiftTemplateSection.tsx (current)
\`\`\`typescript
${SHIFT_TPL_TSX}
\`\`\`

## constants/Colors.ts (excerpt)
\`\`\`typescript
${COLORS_TS}
\`\`\`

## Changes required (apply to BOTH files):

1. **Consistent KeyboardAvoidingView**:
   - Wrap the section's View in \`<KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>\`
   - Import \`KeyboardAvoidingView, Platform\` from \`react-native\`

2. **ScrollView wrapping**:
   - The form fields inside the section must be inside a \`<ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>\`
   - This prevents fields from being hidden under the keyboard on small phones

3. **Focus management between fields** (Worker section only — it has name → role → skills → add):
   - Use \`useRef<TextInput | null>(null)\` for each field
   - Pass \`ref\` and \`returnKeyType\` to InputField via a \`forwardRef\` if InputField supports it, OR use \`onSubmitEditing\` on each field to call \`.focus()\` on the next ref
   - Last field ('skills') gets \`returnKeyType="done"\` and \`onSubmitEditing={Keyboard.dismiss}\`

4. **Accessibility**:
   - Add \`accessibilityHint\` to each \`InputField\` describing the expected input format (e.g., "Enter the worker's full name", "Enter their job role such as Barista")
   - All existing accessibilityLabel values must be preserved

5. **Keep ALL existing props, logic, styles, and translations intact** — only add keyboard/focus improvements.

Output:
===FILE_1: components/scheduler/WorkerSection.tsx===
[full rewrite with keyboard + scroll + focus fixes]

===FILE_2: components/scheduler/ShiftTemplateSection.tsx===
[full rewrite with keyboard + scroll fixes]

No markdown fences inside file content sections.
` }],
    },
  },

  // ── 6. Browser API safety (RosterSection) ──────────────────────────────────
  {
    custom_id: 'browser-api-safety',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      messages: [{ role: 'user', content: `
You are a React Native web-compatibility expert. Fix SSR safety and browser API usage in the RosterSection component.

## components/scheduler/RosterSection.tsx (current — first 250 lines shown)
\`\`\`typescript
${ROSTER_TSX.slice(0, 8000)}
\`\`\`

## Problems to fix:

1. **WebFullscreenPortal (lines 170–200)**: The \`document.createElement('div')\` and \`document.body.appendChild(div)\` calls must be guarded with \`typeof document !== 'undefined'\` to prevent crashes during SSR / Expo Router server rendering. Update the useEffect in WebFullscreenPortal to:
   \`\`\`typescript
   useEffect(() => {
     if (Platform.OS !== 'web' || typeof document === 'undefined') return;
     const div = document.createElement('div');
     // ... rest of setup
   }, []);
   \`\`\`

2. **usePrintStyles (lines 205–225)**: Same guard — \`typeof document !== 'undefined'\` before \`document.createElement('style')\` and \`document.head.appendChild(styleEl)\`.

3. **require('react-dom') (line 196)**: Wrap in try/catch and add \`typeof document !== 'undefined'\` guard:
   \`\`\`typescript
   if (typeof document === 'undefined') return null;
   try {
     const ReactDOM = require('react-dom') as typeof import('react-dom');
     return ReactDOM.createPortal(children, containerRef.current);
   } catch {
     return null;
   }
   \`\`\`

4. **Event listener cleanup**: Verify that every \`document.addEventListener\` / \`window.addEventListener\` added in a useEffect has a corresponding cleanup in the return function.

5. **containerRef type**: Change \`useRef<HTMLDivElement | null>(null)\` to \`useRef<HTMLDivElement | null>(null)\` but guard all accesses with \`if (Platform.OS !== 'web') return;\`.

6. **Keep ALL other component logic, styles, and translations 100% intact.** Only fix the SSR/browser-API safety issues described above.

Output — the COMPLETE file with all fixes applied:
===FILE_1: components/scheduler/RosterSection.tsx===
[complete file]

No markdown fences inside file content section.
` }],
    },
  },
];

// ─── Submit ────────────────────────────────────────────────────────────────────

console.log(`Submitting ${requests.length} requests to claude-sonnet-4-6 (Batch API)…`);
const batch = await client.messages.batches.create({ requests });
console.log(`Batch ID: ${batch.id}  status: ${batch.processing_status}`);

const metaPath = path.join(ROOT, 'scripts', 'mobile-compat-batch-meta.json');
fs.writeFileSync(metaPath, JSON.stringify({ batchId: batch.id, createdAt: Date.now(), requests: requests.map(r => r.custom_id) }, null, 2));
console.log(`Meta saved → ${metaPath}`);

// ─── Poll ──────────────────────────────────────────────────────────────────────

let done = false;
while (!done) {
  await new Promise(r => setTimeout(r, 15_000));
  const status = await client.messages.batches.retrieve(batch.id);
  const c = status.request_counts;
  console.log(`[${new Date().toISOString()}] processing=${c.processing} succeeded=${c.succeeded} errored=${c.errored}`);
  if (status.processing_status === 'ended') done = true;
}

// ─── Write results ─────────────────────────────────────────────────────────────

console.log('\nRetrieving results…');
const outDir = path.join(ROOT, 'scripts', 'mobile-compat-output');
fs.mkdirSync(outDir, { recursive: true });

for await (const result of await client.messages.batches.results(batch.id)) {
  const id = result.custom_id;
  if (result.result.type !== 'succeeded') {
    console.error(`  ✗ ${id}: ${result.result.type}`);
    continue;
  }
  const raw = result.result.message.content[0].text;
  fs.writeFileSync(path.join(outDir, `${id}.txt`), raw, 'utf8');

  const files = splitFiles(raw);
  const keys = Object.keys(files);
  if (keys.length === 0) console.warn(`  ⚠ ${id}: no FILE_N separators found`);
  else console.log(`  [${id}] → ${keys.join(', ')}`);

  for (const [relPath, content] of Object.entries(files)) {
    write(relPath, content);
  }
}

console.log('\n✅ Mobile compatibility batch complete.');
