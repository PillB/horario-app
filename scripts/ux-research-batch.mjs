/**
 * ux-research-batch.mjs
 *
 * Batch API implementation of 6 UX-research-driven improvement tasks.
 * Model: claude-sonnet-4-6  (Batch API — 50% off standard pricing)
 *
 * Tasks:
 *   1. Speed-to-schedule KPI hook     → hooks/useTimeToSchedule.ts (NEW)
 *   2. Reliability sync hardening     → services/syncQueue.ts (NEW)
 *   3. Core-ops bundle capability map → components/CapabilityMatrix.tsx (NEW)
 *   4. Progressive-complexity controls→ components/scheduler/AdvancedControls.tsx (NEW)
 *   5. Shift-context comms primitives → services/shiftMessaging.ts + components/ShiftMessageActions.tsx (NEW)
 *   6. Production referral backend    → app/api/referrals+api.ts + hooks/useReferral.ts (REWRITE)
 *
 * Usage:
 *   node --env-file=.env.local scripts/ux-research-batch.mjs
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

const ANALYTICS_TS       = read('services/analytics.ts');
const TRANSPORT_TS       = read('services/analyticsTransport.ts');
const SYNC_STATUS_TSX    = read('components/SyncStatusBar.tsx');
const SCHEDULER_TSX      = read('app/(tabs)/scheduler.tsx').slice(0, 4000);
const SCHEDULER_METRICS  = read('app/(tabs)/schedulerMetrics.ts');
const DEMAND_TSX         = read('components/scheduler/DemandSection.tsx').slice(0, 2000);
const ROSTER_TSX         = read('components/scheduler/RosterSection.tsx').slice(0, 2000);
const CHECKLIST_TSX      = read('components/scheduler/Checklist.tsx');
const UPGRADE_BANNER_TSX = read('components/UpgradeBanner.tsx');
const TEAM_INVITE_TSX    = read('components/TeamInviteModal.tsx');
const USE_TEAM_INVITE_TS = read('hooks/useTeamInvite.ts');
const REFERRAL_SERVICE   = read('services/referralService.ts');
const SECURE_PROXY       = read('app/api/secure-proxy+api.ts').slice(0, 2000);
const SIGN_UP_TSX        = read('app/(auth)/sign-up.tsx').slice(0, 3000);
const SIGN_IN_TSX        = read('app/(auth)/sign-in.tsx').slice(0, 2000);
const INDEX_TSX          = read('app/(tabs)/index.tsx').slice(0, 3000);
const COLORS_TS          = read('constants/Colors.ts').slice(0, 1000);
const LOCALE_CTX         = read('contexts/LocaleContext.tsx').slice(0, 1000);
const IDENTITY_CTX       = read('contexts/IdentityContext.tsx').slice(0, 1000);

const client = new Anthropic();

// ─── Batch requests ───────────────────────────────────────────────────────────

const requests = [
  // ── Task 1: Time-to-schedule KPI hook ──────────────────────────────────────
  {
    custom_id: 'task-1-time-to-schedule',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: `Generate a TypeScript hook \`hooks/useTimeToSchedule.ts\` that measures and tracks the "time-to-first-schedule" KPI.

Context files:
\`\`\`typescript
// services/analytics.ts
${ANALYTICS_TS}
\`\`\`

\`\`\`typescript
// app/(tabs)/schedulerMetrics.ts
${SCHEDULER_METRICS}
\`\`\`

Requirements:
1. Track \`scheduleSessionStart\` timestamp when user navigates to scheduler tab.
2. Track \`schedulePublishedAt\` timestamp when first roster entry is saved in the session.
3. Compute \`timeToFirstScheduleMs\` = published - start; persist to AsyncStorage key \`"horario:ttfs"\`.
4. Export \`useTimeToSchedule()\` hook returning: \`{ startSession, markSchedulePublished, sessionDurationMs, totalSessions, avgTimeMs }\`.
5. Call \`trackEvent('first_schedule_published', { time_to_activation_ms: ... })\` when published for the first time.
6. Include a \`resetSession()\` for testing.
7. TypeScript strict mode, no \`any\`, imports from \`@react-native-async-storage/async-storage\` and \`@/services/analytics\`.
8. Return ONLY the TypeScript file content, no markdown fences.`,
      }],
    },
  },

  // ── Task 2: Sync-queue with retry + user-visible controls ─────────────────
  {
    custom_id: 'task-2-sync-queue',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 6144,
      messages: [{
        role: 'user',
        content: `Generate a TypeScript service \`services/syncQueue.ts\` that provides reliable write-retry for failed Supabase operations.

Context files:
\`\`\`typescript
// services/analyticsTransport.ts (reference for queue/retry pattern)
${TRANSPORT_TS}
\`\`\`

\`\`\`typescript
// components/SyncStatusBar.tsx (UI component that will consume sync status)
${SYNC_STATUS_TSX}
\`\`\`

Requirements:
1. Define \`SyncOperation\` type: \`{ id: string; table: string; operation: 'upsert'|'delete'; payload: Record<string,unknown>; accountId: string; createdAt: number; retries: number; maxRetries: number }\`.
2. Export \`enqueueSyncOp(op: Omit<SyncOperation,'id'|'retries'|'createdAt'>): void\` — adds to in-memory queue (max 200), persists to AsyncStorage key \`"horario:syncQueue"\`.
3. Export \`configureSyncQueue({ proxyUrl: string; getAuthToken: () => Promise<string|null> }): void\`.
4. Internal flush every 8 seconds via setInterval: POST each op to the proxy URL, retry up to \`maxRetries\` on 5xx/network-error, discard on 4xx.
5. Export \`useSyncStatus(): { status: SyncStatus; pendingCount: number; lastSyncedAt: number|null; retryNow: () => void }\` (React hook) where \`SyncStatus = 'idle'|'saving'|'saved'|'error'\`.
6. Export \`getSyncStatus(): { pendingCount: number; lastSyncedAt: number|null; hasErrors: boolean }\` (non-hook for non-React contexts).
7. Emit analytics event \`'retry_action'\` on retry, \`'error_displayed'\` on final failure.
8. TypeScript strict mode, no \`any\`, imports from \`@react-native-async-storage/async-storage\`, \`react\`, and \`@/services/analytics\`.
9. Return ONLY the TypeScript file content, no markdown fences.`,
      }],
    },
  },

  // ── Task 3: Capability matrix component ───────────────────────────────────
  {
    custom_id: 'task-3-capability-matrix',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 5120,
      messages: [{
        role: 'user',
        content: `Generate a React Native component \`components/CapabilityMatrix.tsx\`.

Context files:
\`\`\`typescript
// components/UpgradeBanner.tsx
${UPGRADE_BANNER_TSX}
\`\`\`

\`\`\`typescript
// constants/Colors.ts (excerpt)
${COLORS_TS}
\`\`\`

\`\`\`typescript
// contexts/LocaleContext.tsx (excerpt)
${LOCALE_CTX}
\`\`\`

Requirements:
1. Show a 3-column table: Feature | Free | Pro — listing Horario's key capabilities.
2. Features to include (use i18n key pattern \`capability.X\` for labels, provide English fallbacks inline):
   - Unlimited workers, Shift templates, Availability tracking, Roster assignment, Demand targets, POS CSV import (free)
   - Auto-assign, Advanced analytics, Multi-location, Messaging/comms, Priority support (pro-only, show lock icon)
3. Props: \`{ onUpgradePress?: () => void; highlightMissing?: string[] }\` — highlight rows listed in \`highlightMissing\` in amber.
4. Show a "Upgrade to Pro" CTA button at bottom when any pro-only row is highlighted.
5. Use \`ThemedText\`, \`ThemedView\`, \`StyleSheet.create\`, \`Colors\` from \`@/constants/Colors\`.
6. \`accessibilityRole\` on interactive elements, accessible table structure.
7. TypeScript strict mode, no \`any\`.
8. Return ONLY the TypeScript file content, no markdown fences.`,
      }],
    },
  },

  // ── Task 4: Advanced controls section ─────────────────────────────────────
  {
    custom_id: 'task-4-advanced-controls',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 6144,
      messages: [{
        role: 'user',
        content: `Generate a React Native component \`components/scheduler/AdvancedControls.tsx\`.

Context files:
\`\`\`typescript
// app/(tabs)/scheduler.tsx (excerpt — structure reference)
${SCHEDULER_TSX}
\`\`\`

\`\`\`typescript
// components/scheduler/DemandSection.tsx (excerpt)
${DEMAND_TSX}
\`\`\`

\`\`\`typescript
// constants/Colors.ts (excerpt)
${COLORS_TS}
\`\`\`

Requirements:
1. A collapsible "Advanced controls" section (collapsed by default) rendered below the basic scheduler sections.
2. Contains three sub-sections, each independently collapsible:
   a. **Shift constraints**: min rest hours between shifts (number input, default 8h), max weekly hours per worker (number input, default 40h), min shift length (number input, default 2h).
   b. **Industry preset packs**: buttons for "Restaurant", "Retail", "Café", "Hotel" — each applies a preset to the constraint fields above.
   c. **Multi-location rules**: a toggle to enable per-location scheduling, and a text input for location names (comma-separated).
3. Props: \`{ onConstraintsChange: (c: ShiftConstraints) => void; initialConstraints?: Partial<ShiftConstraints> }\`.
4. Export \`ShiftConstraints\` type: \`{ minRestHours: number; maxWeeklyHours: number; minShiftHours: number; locationMode: 'single'|'multi'; locations: string[] }\`.
5. Use animated height collapse (react-native-reanimated LayoutAnimation or Animated.Value).
6. Use \`ThemedText\`, \`ThemedView\`, \`StyleSheet.create\`.
7. All inputs have proper \`accessibilityLabel\`.
8. TypeScript strict mode, no \`any\`.
9. Return ONLY the TypeScript file content, no markdown fences.`,
      }],
    },
  },

  // ── Task 5: Shift messaging primitives ────────────────────────────────────
  {
    custom_id: 'task-5-shift-messaging',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 7168,
      messages: [{
        role: 'user',
        content: `Generate TWO files for shift-context communication primitives.

## File 1: services/shiftMessaging.ts

Context:
\`\`\`typescript
// services/analytics.ts
${ANALYTICS_TS}
\`\`\`

\`\`\`typescript
// app/api/secure-proxy+api.ts (excerpt — proxy pattern)
${SECURE_PROXY}
\`\`\`

Requirements for shiftMessaging.ts:
1. Define types:
   - \`ShiftMessage\`: \`{ id: string; shiftId: string; templateId?: string; date: string; role: string; type: 'broadcast'|'coverage_request'|'swap_request'; body: string; sentBy: string; createdAt: number; status: 'sent'|'delivered'|'claimed'; claimedBy?: string }\`
   - \`MessageTemplate\`: \`{ id: string; label: string; body: string; type: ShiftMessage['type'] }\`
2. Export 5 preset message templates: "Need replacement [shift details]", "Shift available to pick up", "Urgent: coverage needed today", "Reminder: shift tomorrow", "Schedule change notice".
3. Export \`sendShiftMessage(msg: Omit<ShiftMessage,'id'|'createdAt'|'status'>, proxyUrl: string, authToken: string|null): Promise<ShiftMessage>\` — POST to proxy.
4. Export \`getShiftMessages(shiftId: string, supabaseUrl: string, anonKey: string): Promise<ShiftMessage[]>\` — GET from Supabase (table: \`shift_messages\`).
5. Export \`claimCoverage(messageId: string, workerId: string, proxyUrl: string, authToken: string|null): Promise<void>\`.
6. Emit analytics: \`'schedule_published'\` (type: broadcast), \`'shift_assigned'\` (type: coverage claimed).
7. TypeScript strict mode, no \`any\`.

## File 2: components/ShiftMessageActions.tsx

Context:
\`\`\`typescript
// constants/Colors.ts (excerpt)
${COLORS_TS}
\`\`\`

Requirements for ShiftMessageActions.tsx:
1. Props: \`{ shiftId: string; date: string; role: string; startTime: string; endTime: string; onMessageSent?: (msg: ShiftMessage) => void }\`.
2. Renders a row of 3 quick-action buttons: "Request coverage", "Notify eligible staff", "Confirm replacement".
3. Tapping "Request coverage" opens a bottom sheet/modal with the 5 preset templates (from shiftMessaging.ts) + free-text option.
4. Tapping "Notify eligible staff" sends a broadcast immediately using the "Shift available to pick up" template.
5. Show send confirmation ("Message sent") for 2s after success.
6. Use \`ThemedText\`, \`StyleSheet.create\`, \`Pressable\`, import from \`@/services/shiftMessaging\`.
7. TypeScript strict mode, no \`any\`.

Return BOTH files concatenated with a separator line:
===FILE_1: services/shiftMessaging.ts===
[content]
===FILE_2: components/ShiftMessageActions.tsx===
[content]

No markdown fences.`,
      }],
    },
  },

  // ── Task 6: Production referral backend + hook ─────────────────────────────
  {
    custom_id: 'task-6-referral-backend',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      messages: [{
        role: 'user',
        content: `Generate TWO files for the production-grade referral system.

## File 1: app/api/referrals+api.ts  (Expo Router API route)

Context:
\`\`\`typescript
// app/api/secure-proxy+api.ts (Clerk auth + Supabase service-role pattern)
${SECURE_PROXY}
\`\`\`

Requirements for referrals+api.ts:
1. Use the same Clerk JWT verification pattern as secure-proxy.
2. Handle 4 actions via POST body \`{ action, ... }\`:
   - \`create\`: generate a 8-char alphanumeric referral code, insert into \`referrals\` table (\`id, referral_code, referrer_user_id, status='pending', created_at, account_id, channel, max_redemptions=5, expires_at=+30days\`). Return \`{ referralCode }\`.
   - \`redeem\`: look up code, check not expired/maxed, mark as accepted, set \`referred_user_id\` + \`accepted_at\`. Return \`{ success, referrerId }\`.
   - \`list\`: return all referrals for the authenticated user. Return \`{ referrals: [...] }\`.
   - \`stats\`: return \`{ sent: number, accepted: number, pending: number }\` for the authenticated user.
3. All writes use the Supabase service-role client (never expose key to client).
4. Return 401 if unauthenticated, 400 for invalid action/params, 200 with JSON on success.
5. TypeScript strict mode, no \`any\`.

## File 2: hooks/useReferral.ts

Context:
\`\`\`typescript
// hooks/useTeamInvite.ts (pattern reference for invite hooks)
${USE_TEAM_INVITE_TS}
\`\`\`

\`\`\`typescript
// services/analytics.ts
${ANALYTICS_TS}
\`\`\`

\`\`\`typescript
// contexts/IdentityContext.tsx (excerpt)
${IDENTITY_CTX}
\`\`\`

Requirements for useReferral.ts:
1. Export \`useReferral()\` hook.
2. State: \`{ referralCode: string|null; stats: { sent: number; accepted: number; pending: number }|null; loading: boolean; error: string|null }\`.
3. \`createReferral(channel: 'link'|'email'|'sms'): Promise<string>\` — POST to \`/api/referrals\` action=create, returns the code.
4. \`redeemReferral(code: string): Promise<boolean>\` — POST to \`/api/referrals\` action=redeem.
5. \`refreshStats(): Promise<void>\` — POST to \`/api/referrals\` action=stats.
6. Auto-refresh stats on mount.
7. Emit \`trackEvent('invite_sent', { channel })\` on create, \`trackEvent('invite_accepted', { channel: 'direct' })\` on successful redeem.
8. Use \`useIdentity()\` to get \`userId\` and Clerk \`useAuth()\` for the bearer token.
9. TypeScript strict mode, no \`any\`.

Return BOTH files concatenated with a separator line:
===FILE_1: app/api/referrals+api.ts===
[content]
===FILE_2: hooks/useReferral.ts===
[content]

No markdown fences.`,
      }],
    },
  },
];

// ─── Submit batch ─────────────────────────────────────────────────────────────

console.log(`Submitting batch of ${requests.length} requests to claude-sonnet-4-6…`);

const batch = await client.messages.batches.create({ requests });
console.log(`Batch ID: ${batch.id}  status: ${batch.processing_status}`);

const metaPath = path.join(ROOT, 'scripts', 'ux-research-batch-meta.json');
fs.writeFileSync(metaPath, JSON.stringify({ batchId: batch.id, createdAt: Date.now(), requests: requests.map(r => r.custom_id) }, null, 2));
console.log(`Meta saved → ${metaPath}`);

// ─── Poll until complete ──────────────────────────────────────────────────────

let done = false;
while (!done) {
  await new Promise(r => setTimeout(r, 15_000));
  const status = await client.messages.batches.retrieve(batch.id);
  const counts = status.request_counts;
  console.log(`[${new Date().toISOString()}] processing=${counts.processing} succeeded=${counts.succeeded} errored=${counts.errored}`);
  if (status.processing_status === 'ended') done = true;
}

// ─── Retrieve and write results ───────────────────────────────────────────────

console.log('\nRetrieving results…');

const outputDir = path.join(ROOT, 'scripts', 'ux-research-batch-output');
fs.mkdirSync(outputDir, { recursive: true });

for await (const result of await client.messages.batches.results(batch.id)) {
  const id = result.custom_id;

  if (result.result.type !== 'succeeded') {
    console.error(`  ✗ ${id}: ${result.result.type}`);
    continue;
  }

  const raw = result.result.message.content[0].text;
  // Save raw output for debugging
  fs.writeFileSync(path.join(outputDir, `${id}.txt`), raw, 'utf8');

  const clean = stripFences(raw);

  if (id === 'task-1-time-to-schedule') {
    write('hooks/useTimeToSchedule.ts', clean);
  }

  if (id === 'task-2-sync-queue') {
    write('services/syncQueue.ts', clean);
  }

  if (id === 'task-3-capability-matrix') {
    write('components/CapabilityMatrix.tsx', clean);
  }

  if (id === 'task-4-advanced-controls') {
    write('components/scheduler/AdvancedControls.tsx', clean);
  }

  if (id === 'task-5-shift-messaging') {
    // Split on the separator lines
    const file1Match = clean.match(/===FILE_1:[^=]+===\s*([\s\S]*?)(?====FILE_2:)/);
    const file2Match = clean.match(/===FILE_2:[^=]+===\s*([\s\S]*?)$/);
    if (file1Match) write('services/shiftMessaging.ts', stripFences(file1Match[1].trim()));
    else console.warn(`  ⚠ task-5: FILE_1 separator not found — check ${id}.txt`);
    if (file2Match) write('components/ShiftMessageActions.tsx', stripFences(file2Match[1].trim()));
    else console.warn(`  ⚠ task-5: FILE_2 separator not found — check ${id}.txt`);
  }

  if (id === 'task-6-referral-backend') {
    const file1Match = clean.match(/===FILE_1:[^=]+===\s*([\s\S]*?)(?====FILE_2:)/);
    const file2Match = clean.match(/===FILE_2:[^=]+===\s*([\s\S]*?)$/);
    if (file1Match) write('app/api/referrals+api.ts', stripFences(file1Match[1].trim()));
    else console.warn(`  ⚠ task-6: FILE_1 separator not found — check ${id}.txt`);
    if (file2Match) write('hooks/useReferral.ts', stripFences(file2Match[1].trim()));
    else console.warn(`  ⚠ task-6: FILE_2 separator not found — check ${id}.txt`);
  }
}

console.log('\n✅ All done. Files written to project.');
