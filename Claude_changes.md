# Claude Changes Log

> This file is the persistent memory for all Claude-assisted changes to horario-app.
> Read it in full at the start of every session. Append a new entry before every commit.
> Never delete old entries — only append.

---

### CHG-000 — 2026-03-27 22:30:00 UTC

**Files changed:** `CLAUDE.md` (created), `Claude_changes.md` (created)

**Reasoning:** Phase 0 — Initial exploration and grounding. No CLAUDE.md or Claude_changes.md existed. Performed full codebase analysis to establish baseline documentation and change log before any implementation work begins.

**Current state of the codebase (snapshot):**
- Expo SDK 53, React Native 0.79.2, React 19, TypeScript 5.8, Expo Router v5
- Supabase backend with 4 tables: `shifts`, `external_signals`, `demand_targets`, `onboarding_progress`
- Secure proxy pattern: `app/api/secure-proxy/route.ts` holds service-role key, all writes go through it
- Core scheduling UI is `app/(tabs)/scheduler.tsx` (~600+ lines, monolithic)
- All worker, template, and roster state is in-memory only — never persisted to Supabase
- Demand forecasting is functional: calls secure proxy → Supabase historical data → optional external AI API → local fallback
- Onboarding progress, streak counter, and demand targets ARE persisted (Supabase/AsyncStorage)
- `persistShiftStatus` and `persistShiftNotification` are stubs (console.log + setTimeout)
- Home screen `upcomingShifts` and `staffingGaps` are hardcoded static arrays
- No authentication, no push notifications, no real-time subscriptions
- `explore.tsx` is a placeholder (default Expo boilerplate)
- Tests: ~6 test files, all unit/component level — no integration or e2e tests

**Expected result / output:** Project now has authoritative documentation that future sessions can ground themselves in. Phase 1 analysis and planning is unblocked.

**Future considerations for next changes:**
- The single most impactful quick win is DB persistence for workers, templates, and roster (currently all in-memory)
- Authentication must be designed before any multi-user or multi-tenant features are added
- `scheduler.tsx` must be split before adding more features to avoid a maintenance nightmare
- The secure proxy currently has no rate limiting or request authentication — should add in an early phase
- Labor law constraints (max hours, minimum rest) must be designed with the data model in mind
- Phase 1 planning should evaluate whether to add Supabase Auth first or DB persistence first (recommendation: DB persistence first, auth second, since the current env-var userId is a valid temporary solution for a single-user MVP)

**References:** (none — initial entry)

---

### CHG-001 — 2026-03-27 22:45:00 UTC

**Files changed:** `CLAUDE.md` (updated — Section 13 added), `Claude_changes.md` (updated)

**Reasoning:** User mandated proactive context compression as a hard rule. Added Section 13 "Context Compression Protocol" to CLAUDE.md defining when and how to write [SUMMARY] and [TEMP] entries in Claude_changes.md. This prevents context degradation from silently corrupting future decisions without the change log reflecting the actual state of the project.

**Expected result / output:** Future sessions will proactively write [SUMMARY] or [TEMP] entries before heavy phases rather than waiting for context to overflow. The rules are now codified and enforceable.

**Future considerations for next changes:**
- Apply the [SUMMARY] pattern at the start of Phase 1 (analysis) and Phase 2 (execution) to validate the pattern works.
- Keep [SUMMARY] entries terse — the goal is navigation, not repetition of the full CLAUDE.md.

**References:** CHG-000

---
