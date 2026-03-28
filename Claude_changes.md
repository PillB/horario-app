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

### [SUMMARY] — 2026-03-27 23:10 UTC
**Last CHG completed:** CHG-001
**Current state:** Expo SDK 53 / React Native app with Supabase backend. Core scheduling UI (`scheduler.tsx`, ~600 lines, monolithic) works but ALL worker/template/roster state is in-memory only — resets on reload. Demand forecasting + onboarding progress + streak counter ARE persisted. No auth, no push notifications, no real-time. `explore.tsx` is a placeholder. 6 test files (unit/component only). Secure proxy has no rate limiting. agent.md.pdf is a code-review agent prompt (created by ChatGPT via WeasyPrint) specifying: React scheduling app for subcontracted workers, demand from sales data, Supabase backend, anti-vibe-coding, security-first, TDD.
**Active decisions:** (1) DB persistence before auth — env-var userId is valid MVP placeholder. (2) Split scheduler.tsx before adding features. (3) Service-role key stays in secure proxy only. (4) Greedy+local-search algorithm (no ILP yet). (5) SMB focus per user instruction.
**Next action:** Output Phase 1 prioritized XML plan and pause for approval.
**Watch out for:** `persistShiftStatus`/`persistShiftNotification` are stubs. Sample dates hardcoded to Dec 2024. `businessTimezoneOffsetMinutes` = device TZ not business TZ. Secure proxy has no auth/rate-limit. `scheduler.tsx` exports `findCoveringAvailability`/`getWeekdayFromDate`/`ShiftTemplate`/`Worker` — these must stay exported during refactor (tests import them directly).

---

### [SUMMARY] — 2026-03-27 23:30 UTC
**Last CHG completed:** CHG-002
**Current state:** Phase 1 done. Plan approved. 29/29 tests pass, lint clean. node_modules installed. All worker/template/roster state is in-memory (resets on reload). Demand targets + onboarding persisted. No auth. Secure proxy has no rate-limit/auth. scheduler.tsx is 600-line monolith.
**Active decisions:** DB persistence before auth. Service-role key stays in proxy only. Greedy algorithm (no ILP). SMB focus. scheduler.tsx exports (findCoveringAvailability, getWeekdayFromDate, ShiftTemplate, Worker) must stay accessible after refactor.
**Next action:** Execute Phase 2A (hygiene), then 2B (schema), 2C (proxy CRUD), 2D (hooks + wire-up). All in this session.
**Watch out for:** babel.config.js line 5 has deprecated plugin. useSessionWellness has timer leak (force-exit on test). Dates hardcoded to Dec 2024. scheduler.tsx line ~115-123 has stub persist functions. .env.example is incomplete.

---

### CHG-005 — 2026-03-28 01:00:00 UTC
**Type:** CHANGE
**Files changed:** `app/api/secure-proxy/route.ts` (extended — 13 new switch cases), `services/rosterService.ts` (created), `services/__tests__/rosterService.test.ts` (created)
**Reasoning:** Phase 2C — Secure proxy CRUD + rosterService. (1) Added 13 new `case` blocks to the `switch(payload.action)` handler in route.ts covering all workers/availability/templates/roster actions. All DB functions (`dbListWorkers`, `dbUpsertWorker`, `dbDeleteWorker`, `dbUpsertAvailability`, `dbDeleteAvailability`, `dbListShiftTemplates`, `dbUpsertShiftTemplate`, `dbDeleteShiftTemplate`, `dbListRoster`, `dbUpsertRosterShift`, `dbUpdateShiftStatus`, `dbMarkShiftNotified`, `dbDeleteRosterShift`) were added in the previous session along with validators, row types, row-to-domain mappers, and the extended `ProxyRequest` union. (2) Created `services/rosterService.ts` — client-side service mirroring `demandForecast.ts` pattern; all 13 CRUD functions route through `proxyPost()`. (3) Created `services/__tests__/rosterService.test.ts` — 23 tests written TDD-first; covers happy path, proxy errors, network failures, and payload verification.
**Expected result:** 52/52 tests pass, lint clean. All roster CRUD is now wired end-to-end from the React client through the secure proxy to Supabase.
**Future considerations:**
- Phase 2D next: create `hooks/useWorkers.ts`, `hooks/useShiftTemplates.ts`, `hooks/useRoster.ts` — replace in-memory useState in scheduler.tsx with DB-backed hooks. Write tests first.
- `dbUpsertWorker` uses `onConflict: 'id'` — if id is absent a new row is inserted (correct). If id is present the row is updated (upsert). This matches the client expectation.
- The proxy validates all inputs before hitting Supabase — HH:MM regex, day_of_week enum, status enum, ISO date regex. Any invalid input returns 400 before a DB call is made.
**References:** CHG-004

---

### CHG-004 — 2026-03-28 00:05:00 UTC
**Type:** CHANGE
**Files changed:** `supabase/migrations/20260327000001_core_tables.sql` (created), `docs/SETUP_SUPABASE.md` (updated)
**Reasoning:** Phase 2B — Database Schema. Created migration with 4 new tables: `workers` (uuid PK, account_id, name, role, skills[], created_at), `worker_availability` (FK→workers, day_of_week enum, from/to_time with HH:MM validation and time-order constraint), `shift_templates` (uuid PK, account_id, name, role, start/end_time, coverage), `roster` (FK→workers+shift_templates, date, status enum Draft/Published, notified, updated_at trigger). All 4 tables have RLS enabled: anon=SELECT only, service_role=ALL. Indexes added for all common query patterns. Updated SETUP_SUPABASE.md to describe all 7 tables and reference both migration files. References: CHG-003.
**Expected result:** Supabase project can have this migration applied to gain the core scheduling schema. All 4 new tables are ready to back the hooks in Phase 2D.
**Future considerations:**
- Phase 4A (auth) will add FK from roster/workers to auth.users and tighten RLS to per-user policies using auth.uid()
- The `worker_availability.from_time < to_time` constraint is enforced at DB level AND will be enforced in the proxy validator (Phase 2C)
- roster.worker_id uses `on delete restrict` (not cascade) — must delete roster shifts before deleting a worker
- uuid PKs chosen over bigint for future multi-region/distributed support
**References:** CHG-003

---

### CHG-003 — 2026-03-27 23:45:00 UTC
**Type:** CHANGE
**Files changed:** `babel.config.js`, `app/(tabs)/__tests__/scheduler.test.tsx`, `app/(tabs)/scheduler.tsx`, `app/(tabs)/index.tsx`, `.env.example`, `package-lock.json`
**Reasoning:** Phase 2A — Hygiene & Quick Wins. (1) Removed deprecated `expo-router/babel` plugin from babel.config.js (already covered by babel-preset-expo per SDK 50+ docs). (2) Added `act(() => { tree!.unmount(); })` before warnSpy.mockRestore() in scheduler.test.tsx — clears the useSessionWellness setInterval, eliminating the force-exit warning. (3) Added `isoDate()` module-level helper to scheduler.tsx; replaced all 5 hardcoded Dec 2024 dates with `isoDate(0..3)` calls. (4) Added `offsetDate()` module-level helper to index.tsx; replaced hardcoded 'Dec 12'/'Dec 15' strings in upcomingShifts and staffingGaps. (5) Updated .env.example with all 7 required env vars with usage comments. (6) npm audit fix reduced vulnerabilities from 23→6 (remaining 6 require --force/breaking changes; deferred). References: CHG-002.
**Expected result:** 29/29 tests pass, no force-exit warning, lint clean, no stale dates in UI.
**Future considerations:**
- Remaining 6 npm vulnerabilities (5 low, 1 moderate: brace-expansion ReDoS) are in transitive deps of jest-expo/expo — cannot fix without breaking changes. Monitor for upstream fixes.
- isoDate() is a module-level function in scheduler.tsx — will move to utils/schedulerUtils.ts during Phase 3A refactor.
- Phase 2B next: SQL schema migration for workers, worker_availability, shift_templates, roster tables.
**References:** CHG-002

---

### CHG-002 — 2026-03-27 23:20:00 UTC
**Type:** CHANGE
**Files changed:** `Claude_changes.md` (updated with [SUMMARY] + this entry)
**Reasoning:** Phase 1 complete. Full codebase + agent.md.pdf analyzed. agent.md.pdf is a ChatGPT-generated code-review agent spec (WeasyPrint) describing: React scheduling app for subcontracted workers, demand from sales data, Supabase backend, anti-vibe-coding mandate, security-first. 29/29 tests pass. Lint clean. node_modules was not installed. Identified 23 gaps across critical/high/medium/low priority. Produced 14-phase prioritized execution plan. [SUMMARY] written before plan output.
**Expected result:** Approved plan becomes the execution roadmap for all future phases.
**Future considerations:**
- Phase 2A first — hygiene fixes unblock clean development (babel plugin, timer leak, stale dates)
- node_modules must be installed with `npm install` at the start of any new environment
- `scheduler.tsx` exports are test dependencies — must be re-exported after refactor (Phase 3A)
- Keep [SUMMARY] entries at the top of each new phase execution block
- SMB focus: prioritize UX clarity and data persistence over algorithmic complexity
**References:** CHG-001 | [SUMMARY-2026-03-27]

---
