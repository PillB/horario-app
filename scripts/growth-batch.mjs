/**
 * growth-batch.mjs
 *
 * Batch API implementation of 5 growth/conversion feature stubs.
 * Model: claude-sonnet-4-6  (Batch API — 50% off standard pricing)
 *
 * Tasks batched:
 *   1. Outcome-first onboarding  → hooks/useActivationMilestone.ts  (NEW)
 *   2. Microcopy localization    → scripts/growth-locale-snippets.txt (review & merge)
 *   3. Referral loop upgrade     → services/referralService.ts  (NEW)
 *   4. Production analytics      → services/analytics.ts  (REWRITE)
 *   5. Reliability UX            → components/SyncStatusBar.tsx  (NEW)
 *
 * Usage:
 *   node --env-file=.env.local scripts/growth-batch.mjs
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function read(relPath) {
  const abs = path.join(ROOT, relPath);
  return fs.existsSync(abs)
    ? fs.readFileSync(abs, 'utf8')
    : `// FILE NOT FOUND: ${relPath}`;
}

function write(relPath, content) {
  const abs = path.join(ROOT, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
  console.log(`  ✓ wrote ${relPath}`);
}

function stripFences(text) {
  return text
    .replace(/^```(?:typescript|tsx|ts|jsx|js|mjs|json|sql|markdown|md)?\s*/im, '')
    .replace(/\s*```\s*$/m, '')
    .trim();
}

// ─── Read source files ────────────────────────────────────────────────────────

const ONBOARDING_PROGRESS_TS = read('services/onboardingProgress.ts');
const USE_SCHEDULER_HANDLERS_TS = read('hooks/useSchedulerHandlers.ts');
const CHECKLIST_TSX = read('components/scheduler/Checklist.tsx');
const ANALYTICS_TS = read('services/analytics.ts');
const USE_TEAM_INVITE_TS = read('hooks/useTeamInvite.ts');
const TEAM_INVITE_MODAL_TSX = read('components/TeamInviteModal.tsx');
const INDEX_TSX_HEAD = read('app/(tabs)/index.tsx').slice(0, 3000); // first ~3k chars for structure
const SIGN_UP_TSX_HEAD = read('app/(auth)/sign-up.tsx').slice(0, 3000);
const LOCALE_CONTEXT_TSX = read('contexts/LocaleContext.tsx');

const client = new Anthropic();

// ─── Batch requests ───────────────────────────────────────────────────────────

const requests = [

  // ── 1: useActivationMilestone.ts — outcome-first onboarding hook ─────────
  {
    custom_id: '1-useActivationMilestone',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 5120,
      messages: [{
        role: 'user',
        content: `You are writing a NEW React Native (TypeScript strict) hook for a scheduling app.
FILE: hooks/useActivationMilestone.ts

## Business context
The current onboarding is "feature-first" (checklist of tasks). We need to shift to
"outcome-first": the single activation milestone is "first published shift with zero
uncovered staffing gaps for the selected day". Reaching this milestone = product value
proved. We want to track how long it takes (time_to_activation_ms) and surface a
success state the home screen can render.

## Existing onboardingProgress.ts (reference — do NOT modify, just import):
\`\`\`typescript
${ONBOARDING_PROGRESS_TS}
\`\`\`

## What this hook must do

### State it manages (all in React useState, also persisted to AsyncStorage key "horario:activation"):
\`\`\`typescript
type ActivationState = {
  activation_target_defined: boolean;  // user has at least 1 worker + 1 template
  activation_reached: boolean;         // first publish with zero uncovered gaps
  time_to_activation_ms: number | null; // ms from first app open to activation_reached
  first_open_ts: number | null;         // Unix ms of first open (set once, never reset)
  activated_at_ts: number | null;       // Unix ms when activation_reached flipped true
};
\`\`\`

### Exports
\`\`\`typescript
export type ActivationState = { ... }; // as above

export type UseActivationMilestoneReturn = {
  activationState: ActivationState;
  /** Call after adding first worker + first template — sets activation_target_defined=true */
  markTargetDefined: () => Promise<void>;
  /** Call after a successful publish with zero gaps — sets activation_reached, records timing */
  markActivationReached: () => Promise<void>;
  /** True when the success banner/feedback should be shown (activation_reached && not yet dismissed) */
  showSuccessFeedback: boolean;
  /** Dismiss the success banner */
  dismissSuccessFeedback: () => void;
  /** Loading state while reading AsyncStorage on mount */
  isLoading: boolean;
};

export function useActivationMilestone(): UseActivationMilestoneReturn
\`\`\`

### Persistence
- On mount: read from AsyncStorage key "horario:activation" and hydrate state.
- Set first_open_ts on mount if not already set (first time the hook runs).
- On every state change: write to AsyncStorage (fire-and-forget, never throw).
- markActivationReached(): idempotent — if already reached, do nothing.
  When called for the first time: set activated_at_ts = Date.now(),
  compute time_to_activation_ms = activated_at_ts - first_open_ts (or null if first_open_ts missing),
  set activation_reached = true.
- showSuccessFeedback: true after activation_reached AND until dismissSuccessFeedback() is called.
  Use a separate local boolean state "feedbackDismissed" (not persisted).

### Imports (use only these):
- React, { useCallback, useEffect, useState } from 'react'
- AsyncStorage from '@react-native-async-storage/async-storage'

No Supabase, no server calls — this is purely client-side.
TypeScript strict mode. No 'any'. All state transitions via useCallback.
Return ONLY the complete file. No markdown fences. No explanatory text.`,
      }],
    },
  },

  // ── 2: Locale snippets for microcopy/conversion copy ─────────────────────
  {
    custom_id: '2-locale-microcopy',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 6144,
      messages: [{
        role: 'user',
        content: `You are auditing a React Native scheduling app for hardcoded user-facing strings and
producing locale key additions to migrate all conversion-critical copy to the i18n system.

## i18n system
\`\`\`typescript
${LOCALE_CONTEXT_TSX}
\`\`\`
Keys are nested TypeScript objects (e.g. t('home.hero.tagline1')).
Translation files live at locales/en.ts, locales/es.ts, and 7 other locale files.

## Files to audit (snippets)

### app/(auth)/sign-up.tsx (first 3000 chars):
\`\`\`typescript
${SIGN_UP_TSX_HEAD}
\`\`\`

### app/(tabs)/index.tsx (first 3000 chars):
\`\`\`typescript
${INDEX_TSX_HEAD}
\`\`\`

### components/TeamInviteModal.tsx (first 3000 chars):
\`\`\`typescript
${TEAM_INVITE_MODAL_TSX.slice(0, 3000)}
\`\`\`

## Your task
Output a single structured locale-key addition document (plain text, no markdown fences)
in the following format. For every hardcoded string you find OR every conversion-critical
string that needs a dedicated persuasion copy key, output an entry.

Required categories to cover:
1. signup — hero value prop, trust proof ("free to start, no credit card"), error messages,
   CTA labels, verification instructions
2. teamInvite — manager mode headline + CTA + share message, worker mode headline + CTA,
   join-success message, risk-reversal copy
3. home.quickStart — new Quick Start card: title, subtitle (outcome-focused),
   CTA label ("Publish today's schedule in <10 min"), success title + body
4. home.activation — activation milestone banner: title, body, next-action CTA

Format each entry as:
KEY: full.dotted.key
EN:  English value
ES:  Spanish translation
CATEGORY: [signup | teamInvite | home.quickStart | home.activation]
PERSUASION_TYPE: [value_prop | trust_proof | risk_reversal | cta | helper | error | success]

Separate entries with a blank line.
Output ONLY the entries in this format. No markdown. No headers. No explanatory prose.`,
      }],
    },
  },

  // ── 3: referralService.ts — attributed referral with Supabase ────────────
  {
    custom_id: '3-referralService',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 6144,
      messages: [{
        role: 'user',
        content: `You are writing a NEW TypeScript service for a React Native scheduling app.
FILE: services/referralService.ts

## Current invite approach (replace this pattern)
\`\`\`typescript
${USE_TEAM_INVITE_TS}
\`\`\`
The current code generates random 6-char codes in AsyncStorage only — no server attribution,
no abuse controls, no deep-link continuity. We need backend-issued tokens.

## Existing onboarding service pattern to follow for server calls:
\`\`\`typescript
${ONBOARDING_PROGRESS_TS}
\`\`\`
Pattern: all writes go through \`EXPO_PUBLIC_SECURE_PROXY_URL\` (POST), reads use Supabase anon client.

## Supabase table schema to assume (already migrated — do not emit SQL):
\`\`\`sql
-- referrals
CREATE TABLE referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_code text UNIQUE NOT NULL,
  referrer_user_id text NOT NULL,
  referred_user_id text,
  status text NOT NULL DEFAULT 'sent',
  -- status values: sent | opened | installed | activated | rewarded
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  account_id text NOT NULL
);
\`\`\`

## What this service must export

### Types
\`\`\`typescript
export type ReferralStatus = 'sent' | 'opened' | 'installed' | 'activated' | 'rewarded';

export type Referral = {
  id: string;
  referralCode: string;
  referrerUserId: string;
  referredUserId: string | null;
  status: ReferralStatus;
  createdAt: string;
  accountId: string;
};
\`\`\`

### Functions

1. \`createReferral(referrerUserId: string, accountId: string): Promise<Referral | null>\`
   - POST to secure proxy: action='createReferral', referrerUserId, accountId
   - Proxy generates a unique 8-char alphanumeric code server-side (never client)
   - Returns the created Referral or null on error

2. \`redeemReferral(referralCode: string, referredUserId: string, accountId: string): Promise<Referral | null>\`
   - POST to secure proxy: action='redeemReferral', referralCode, referredUserId, accountId
   - Updates status → 'installed' if current status is 'sent'|'opened'
   - Returns updated Referral or null

3. \`getReferralByCode(referralCode: string): Promise<Referral | null>\`
   - Read via Supabase anon client (getSupabaseClient)
   - Query referrals table where referral_code = referralCode
   - Returns null if not found or on error

4. \`markReferralOpened(referralCode: string): Promise<void>\`
   - POST to secure proxy: action='markReferralOpened', referralCode
   - Fire-and-forget — never throws

5. \`getUserReferrals(referrerUserId: string): Promise<Referral[]>\`
   - Read via Supabase anon client
   - Query referrals where referrer_user_id = referrerUserId, order by created_at desc
   - Returns [] on error

### Error handling
Never throw. Return null / empty array on failure, log with console.warn.
Always use try/catch around async operations.

### Imports (use only these):
- { getSupabaseClient } from './supabaseClient'
- { getSessionToken } from '@/services/authToken'

TypeScript strict mode. No 'any'. snake_case DB columns map to camelCase TS properties.
Return ONLY the complete file. No markdown fences. No explanatory text.`,
      }],
    },
  },

  // ── 4: analytics.ts — production funnel schema ────────────────────────────
  {
    custom_id: '4-analytics',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 5120,
      messages: [{
        role: 'user',
        content: `You are REWRITING an existing TypeScript analytics service for a React Native scheduling app.
FILE: services/analytics.ts

## Current file (replace this entirely):
\`\`\`typescript
${ANALYTICS_TS}
\`\`\`

## Requirements for the new version

### Extended AnalyticsEvent union — add ALL of the following to the existing events:
\`\`\`typescript
// Acquisition
| 'sign_up_started'
| 'sign_up_completed'
// Onboarding funnel
| 'onboarding_step_completed'       // exists, keep
| 'onboarding_target_defined'       // worker + template both added
| 'onboarding_quick_start_opened'   // Quick Start card CTA tapped
// Activation
| 'activation_reached'              // first publish with 0 gaps
| 'activation_banner_dismissed'
// Referral funnel
| 'share_sent'
| 'invite_opened'
| 'install_attributed'
| 'activation_attributed'
| 'reward_issued'
// Publish cycle
| 'schedule_published'              // exists, keep
| 'publish_failed'
| 'publish_retry'
// Worker / template / assign — keep existing
| 'worker_added'
| 'template_added'
| 'shift_assigned'
| 'auto_assign_used'
// Upgrade
| 'upgrade_cta_tapped'
// Friction / reliability
| 'retry_action'
| 'error_displayed'
| 'form_step_abandoned'
\`\`\`

### EventProps — typed payload shape per event:
Add a mapped type \`EventProps\` that constrains the \`props\` param for key events:
\`\`\`typescript
type EventProps = {
  activation_reached: { time_to_activation_ms: number };
  onboarding_step_completed: { step: string };
  publish_failed: { reason: string };
  publish_retry: { attempt: number };
  retry_action: { action: string; attempt: number };
  error_displayed: { code: string; screen: string };
  form_step_abandoned: { form: string; step: string };
  share_sent: { channel: string };
  reward_issued: { reward_type: string };
  // all other events: props is optional Record<string,string|number|boolean>
};
\`\`\`

Use a conditional type / overload so that:
- For events listed in EventProps, props is required and typed
- For all other events, props remains optional Record<string,string|number|boolean>

### Provider-backed export (new behaviour)
Add a \`setAnalyticsProvider\` function:
\`\`\`typescript
type AnalyticsProvider = {
  track: (event: string, props?: Record<string, string | number | boolean>) => void;
};
let _provider: AnalyticsProvider | null = null;
export function setAnalyticsProvider(p: AnalyticsProvider): void { _provider = p; }
\`\`\`
In \`trackEvent\`: after writing to AsyncStorage, also call \`_provider?.track(event, props)\`.
This allows PostHog / Segment / Mixpanel to be wired in without changing call sites.

### Keep all existing behaviour:
- STORAGE_KEY = 'horario:analytics:events'
- MAX_EVENTS = 200
- fire-and-forget (never throws)
- getTrackedEvents() unchanged

TypeScript strict mode. No 'any'. Return ONLY the complete file. No markdown fences. No explanatory text.`,
      }],
    },
  },

  // ── 5: SyncStatusBar.tsx — reliability-first saving/loading/error UI ─────
  {
    custom_id: '5-SyncStatusBar',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 5120,
      messages: [{
        role: 'user',
        content: `You are writing a NEW React Native component for a scheduling app.
FILE: components/SyncStatusBar.tsx

## Business context
Users complain about not knowing if their changes were saved, seeing silent failures, and
having no recovery path when an action fails. This component surfaces saving/saved/error
states explicitly, with retry support and a "last synced" timestamp.

## Props
\`\`\`typescript
export type SyncStatus = 'idle' | 'saving' | 'saved' | 'error';

export type SyncStatusBarProps = {
  status: SyncStatus;
  /** Friendly message — e.g. "Publishing schedule…" or "Saved at 14:32" */
  message?: string;
  /** When status='error', show this actionable error copy */
  errorMessage?: string;
  /** When status='error', call this to retry */
  onRetry?: () => void;
  /** Unix ms of last successful sync (show as "Last saved HH:MM") */
  lastSyncedAt?: number | null;
};
\`\`\`

## Visual spec

Layout: full-width horizontal bar, 36px tall, positioned at the bottom of whichever
parent View it is placed in. Renders null when status='idle' AND lastSyncedAt is null.

Status → visual mapping:
- idle (with lastSyncedAt): subtle grey bar, "Last saved HH:MM" in muted text (no icon)
- saving: brand.primary background, white text, ActivityIndicator (size=small, color=white) on left, message || t('sync.saving')
- saved: #15803D (green) background, white text, "✓" icon on left, message || t('sync.saved'), auto-fades to idle after 3 seconds
- error: #DC2626 (red) background, white text, "⚠" icon on left, errorMessage || t('sync.error'), "Retry" Pressable on right (calls onRetry)

Transition: saved→idle auto-dismiss uses useEffect + setTimeout (3000ms).
When status changes back to 'saving' or 'error', clear any pending dismiss timer.

Accessibility:
- accessibilityRole="status" on the bar View
- accessibilityLiveRegion="polite" when saving/saved
- accessibilityLiveRegion="assertive" when error
- accessibilityLabel: built from current status text + lastSyncedAt if present

Locale keys to use (call t() for each):
- t('sync.saving') → "Saving…"
- t('sync.saved')  → "Saved"
- t('sync.error')  → "Could not save changes"
- t('sync.retry')  → "Retry"
- t('sync.lastSaved') → "Last saved" (prefix before HH:MM)

## Imports (use only these):
- React, { useEffect, useRef, useState } from 'react'
- { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native'
- { ThemedText } from '@/components/ThemedText'
- { Colors, brand, type ThemeColors } from '@/constants/Colors'
- { useColorScheme } from '@/hooks/useColorScheme'
- { useT } from '@/contexts/LocaleContext'

TypeScript strict mode. No 'any'. Use StyleSheet.create. No anonymous inline styles.
Return ONLY the complete file. No markdown fences. No explanatory text.`,
      }],
    },
  },

];

// ─── Submit batch ─────────────────────────────────────────────────────────────

console.log(`Submitting ${requests.length} batch requests…`);
const batch = await client.messages.batches.create({ requests });
console.log(`Batch id: ${batch.id}  status: ${batch.processing_status}`);

// ─── Poll until complete ──────────────────────────────────────────────────────

let current = batch;
while (current.processing_status !== 'ended') {
  await new Promise((r) => setTimeout(r, 10_000));
  current = await client.messages.batches.retrieve(batch.id);
  const { processing, errored, succeeded } = current.request_counts;
  console.log(`  polling… succeeded=${succeeded} processing=${processing} errored=${errored}`);
}
console.log('Batch complete.');

// ─── Collect results ──────────────────────────────────────────────────────────

const results = {};
for await (const result of await client.messages.batches.results(batch.id)) {
  if (result.result.type === 'succeeded') {
    const text = result.result.message.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
    results[result.custom_id] = text;
    console.log(`  ✓ ${result.custom_id} (${text.length} chars)`);
  } else {
    console.error(`  ✗ ${result.custom_id}: ${result.result.type}`);
  }
}

// ─── Write files ──────────────────────────────────────────────────────────────

console.log('\nWriting files…');

if (results['1-useActivationMilestone']) {
  write('hooks/useActivationMilestone.ts', stripFences(results['1-useActivationMilestone']));
}

if (results['2-locale-microcopy']) {
  write('scripts/growth-locale-snippets.txt', results['2-locale-microcopy']);
  console.log('  → Review scripts/growth-locale-snippets.txt then merge keys into all locales/*.ts');
}

if (results['3-referralService']) {
  write('services/referralService.ts', stripFences(results['3-referralService']));
}

if (results['4-analytics']) {
  write('services/analytics.ts', stripFences(results['4-analytics']));
}

if (results['5-SyncStatusBar']) {
  write('components/SyncStatusBar.tsx', stripFences(results['5-SyncStatusBar']));
}

// ─── Save raw results ─────────────────────────────────────────────────────────

write('scripts/growth-results.json', JSON.stringify(
  Object.fromEntries(
    Object.entries(results).map(([k, v]) => [k, v.slice(0, 400) + '…'])
  ),
  null,
  2
));

console.log('\nDone. Next steps:');
console.log('  1. Review scripts/growth-locale-snippets.txt and merge into all 9 locales/*.ts');
console.log('  2. Add sync.* keys to locales before using SyncStatusBar');
console.log('  3. Wire useActivationMilestone into useSchedulerHandlers (on publish success)');
console.log('  4. Wire setAnalyticsProvider() in app root with your analytics SDK');
console.log('  5. Run: npm test && npm run lint');
