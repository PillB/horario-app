# CLAUDE.md — Horario App

> **READ THIS FIRST at the start of every session.**
> Also read `Claude_changes.md` in parallel for all prior decisions and considerations.

---

## 1. Project Purpose

**Horario** (Spanish for "schedule") is a production-targeted mobile/web scheduling and shift-optimization app built with Expo (React Native). Its goals:

- Fair, efficient assignment of shifts/turns to workers considering availability, skills, preferences, labor-law constraints, and demand forecasts.
- Real-time staffing gap visibility and revenue-exposure tracking.
- Notifications, analytics, and scalability to multi-tenant enterprise use.

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Mobile/Web framework | Expo SDK 53, React Native 0.79.2, React 19 |
| Routing | Expo Router v5 (file-based) |
| Language | TypeScript 5.8 (strict) |
| Backend/DB | Supabase (PostgreSQL, RLS, realtime) |
| Local storage | AsyncStorage (RN) / localStorage (web) |
| Secure server actions | Expo Router API routes (`app/api/`) acting as a secure proxy with service-role Supabase key |
| Styling | React Native `StyleSheet` (no external CSS library) |
| Tests | Jest + jest-expo, react-test-renderer |
| Lint | ESLint with eslint-config-expo |
| Icons | @expo/vector-icons + expo-symbols |
| Animations | react-native-reanimated 3, expo-haptics |
| Auto-assign solver | HiGHS via npm `highs` 1.15.3 (MIT, single-threaded WebAssembly, web Worker only) |

---

## 3. Architecture Overview

```
horario-app/
├── app/
│   ├── _layout.tsx             Root layout (Stack navigator)
│   ├── +not-found.tsx          404 fallback
│   ├── (tabs)/
│   │   ├── _layout.tsx         Tab bar layout (Home, Scheduler, Explore)
│   │   ├── index.tsx           Home dashboard (static + hooks)
│   │   ├── scheduler.tsx       Core scheduling UI (~600+ lines — needs splitting)
│   │   ├── schedulerMetrics.ts Uncovered-loss computation (pure function)
│   │   └── explore.tsx         Placeholder tab (not yet built out)
│   └── api/
│       └── secure-proxy/
│           └── route.ts        Server-side Expo Router API route (service-role Supabase proxy)
├── components/                 Shared UI components
├── constants/Colors.ts         Theme color tokens
├── hooks/                      Custom React hooks (forecast, streak, wellness, etc.)
├── services/
│   ├── demandForecast.ts       Client-side forecast service (history via secure proxy, fit on the client)
│   ├── forecasting/            Statistical forecaster: models, backtest selection, intervals
│   ├── onboardingProgress.ts   Onboarding fetch/upsert (client-side + secure proxy)
│   └── supabaseClient.ts       Anon Supabase client factory
├── supabase/migrations/        SQL migration files
└── docs/                       Supabase setup + env docs
```

### Data Flow

```
Client (Expo App)
  → services/demandForecast.ts (anon-key or no-key calls)
  → app/api/secure-proxy+api.ts  ← service-role key lives HERE ONLY
  → Supabase (PostgreSQL)
      ├── shifts             (historical shifts for forecasting)
      ├── external_signals   (demand boost signals)
      ├── demand_targets     (AI/manual demand forecasts)
      ├── locations          (confirmed jurisdiction + IANA zone per business location)
      └── onboarding_progress, workers, roster, …

Location setup (components/locations/LocationSetupCard.tsx)
  → GET app/api/geo-hint+api.ts  (echoes validated x-vercel-ip-* headers; all null in local dev)
  + expo-localization device region / time zone
  → suggestion only; the user confirms → upsertLocation (server re-checks the jurisdiction)
```

---

## 4. Current Feature Status

> Rows marked "re-verified" were checked against the code on that date; others may be stale.

| Feature | Status | Notes |
|---|---|---|
| Home dashboard | Partial | Static hardcoded data; no live queries |
| Scheduler UI | Partial | Works but all state is in-memory, resets on reload |
| Worker management (add/view) | Partial | Persisted through the proxy (`useWorkers`); labor attributes birth date, night worker, weekly-limit opt-out, no fixed hours (`20261020000002_worker_labor_attributes.sql`, `utils/workerLaborValidation.ts`, 13+ and real past date checked server-side) — re-verified 2026-10-20; no edit/delete UI |
| Shift template management | Partial | In-memory only, no DB persistence |
| Roster (shift assignment) | Partial | In-memory only; fake persistence functions |
| Availability tracking | Partial | In-memory, validated, no DB |
| Demand forecasting | Working | Statistical forecaster fitted in the client (`services/forecasting/`): seasonal naive, weekday profile with recency weighting, Holt-Winters (additive weekly season, damped trend); chosen per role by rolling-origin backtest on MASE vs. seasonal naive; intervals from backtest-error quantiles; `required` = forecast at the service level (default P80), rounded up. Proxy only pages history (`forecastHistory`, `listForecastSignals`). External API (EXPO_PUBLIC_FORECAST_API_URL) optional, tried first — added 2026-10-20 (CHG-086) |
| Demand target overrides | Working | Persisted to Supabase via proxy |
| Uncovered-loss metric | Working | Pure function, well-tested |
| Onboarding checklist | Working | Persisted to Supabase via proxy |
| Streak counter | Working | Persisted to AsyncStorage |
| Session wellness prompts | Working | In-memory, no persistence |
| Personalized feed | Working | In-memory ranking, no server |
| Push notifications | Missing | `notified` flag exists but no actual push |
| Authentication | Working | Clerk sign-in; API routes verify Clerk session JWTs and fail closed (`server/proxyAuth.ts`) — re-verified 2026-10-18 |
| Real-time updates | Missing | No Supabase realtime subscriptions |
| Shift optimization algorithm | Working (web) / Partial (native) | Web: exact ILP (`services/optimizer/`, HiGHS 1.15 WASM, single-threaded) in a Web Worker, lexicographic coverage → fairness → continuity, 2 s budget, compared with the greedy and never worse; falls back to the greedy on no Worker / WASM failure / timeout (CHG-085). Native: greedy + 2-opt only (`services/shiftAssigner.ts`, no WebAssembly in Hermes). Both overnight-aware, IANA time zone, elapsed-time hours and rest, every shortfall reported with a reason — added 2026-10-20 (CHG-085). Not run in a real browser yet |
| Analytics screen | Missing | explore.tsx is placeholder |
| Labor-law constraint engine | Partial | Rule engine + jurisdiction packs (`services/labor/`). Scheduler shows findings for the visible roster week, grouped by verdict with citations and per-shift markers (`hooks/useCompliance.ts`, `components/scheduler/CompliancePanel.tsx`); a shift uses its roster entry's location, else the account's only location, else a set-up prompt. Auto-assign merges the location's legal hard limits with business limits and uses its IANA zone (`utils/autoAssignSettings.ts`) — re-verified 2026-10-20. Location overrides (`services/labor/overrides.ts`: rest minimum, daily / weekly maximum, break minutes) must be stricter than the pack on save (400 otherwise) and are applied stricter-wins in `evaluateShifts` (`EvaluationContext.overrides`) and `legalConstraintsFor`; a shift inside a spring-forward gap moves after the gap with its wall-clock length, as in the assigner (`zonedShiftSpan`) — added 2026-10-21 (CHG-089). No consent, publish time, breaks or school days fed to the engine yet |
| Business locations / jurisdiction | Working | `locations` table + `listLocations` / `upsertLocation` / `deleteLocation` (admin) proxy actions; country detected from IP (`/api/geo-hint`) and device, always confirmed by the user; setup card on Home until a location exists, management on Profile — added 2026-10-20 (CHG-076). Change history: `location_history`, written by a trigger on every insert / update / delete (who, when, old / new jurisdiction, zone, industry, headcount, overrides); deletes go through `delete_location()` to record the actor; `listLocationHistory` proxy action; read-only list in the Profile LocationsManager — added 2026-10-21 (CHG-089) |
| Multi-tenant support | Working | Tenant = Clerk org id, else user id; enforced in the proxy and by RLS (`20261018000001_tenant_isolation.sql`) — re-verified 2026-10-18 |
| Date/time picker components | Missing | Raw text inputs only |
| Error boundaries | Partial | ErrorBoundary used in `app/_layout.tsx` and some screens |
| CI/CD pipeline | Working | `ci.yml` (typecheck, lint, tests, web export, local-Supabase RLS + isolation tests); `migrate.yml` (dev on merge, prod manual) |
| EAS build config | Partial | `eas.json` exists; not re-verified |

---

## 5. Database Schema (Supabase)

### Tables that exist (via migrations; every one has `account_id` and the tenant RLS policy):
- `shifts` — historical shift data (date, role, worker_id, hours)
- `external_signals` — demand boost signals (date, role, signal_type, weight)
- `demand_targets` — model/override demand forecasts (date, role, required, source, …)
- `onboarding_progress` — account-level onboarding flags
- `workers`, `worker_availability`, `shift_templates`, `roster` — core scheduling data
- `usage_limits`, `pos_sales`, `subscriptions`, `referrals`, `referral_redemptions`, `shift_messages`
- `locations` — business locations: country / region / city codes, confirmed `jurisdiction_code` (from `services/labor/jurisdictions.ts`), IANA `time_zone`, `industry`, `employer_headcount`, `locations_count`, `detected_hint`, `overrides`, `confirmed_by` / `confirmed_at` (`20261020000001_locations.sql`). Law follows the work location: the jurisdiction is stored here, never per user or device. `overrides` is an array of typed stricter-only limits (`services/labor/overrides.ts`).
- `location_history` — audit log of `locations` (`20261021000089_location_history.sql`): written only by the `locations_history` trigger (SECURITY DEFINER); `changed_by` = transaction setting `horario.actor` (set by `delete_location()`), else `confirmed_by`. anon / authenticated / service_role cannot insert or update it; tenant RLS SELECT.

### Tables that need to be created:
- `accounts` — tenant accounts (today the tenant is the Clerk org / user id)

---

## 6. Coding Standards

### General
- **TypeScript strict mode** — never use `any` without explicit justification.
- **Functional components only** — no class components.
- **No vibe-coding** — read files before changing them; no speculation.
- **Minimal surface area** — don't add features, abstractions, or helpers not needed for the current task.
- **TDD preferred** — write or update tests before or alongside implementation.

### React / React Native
- Use `useMemo`/`useCallback` for expensive computations or stable references passed as props.
- Prefer controlled inputs; avoid uncontrolled refs for form state.
- All interactive elements must have `accessibilityRole`, `accessibilityLabel`, and `accessibilityHint`.
- Use `ThemedText` and `ThemedView` instead of raw `Text`/`View` for theming consistency.
- Avoid anonymous inline styles; use `StyleSheet.create`.
- Checkable state on web: pass `aria-checked` (radios, checkboxes, switches). react-native-web 0.20 drops `accessibilityState` except `disabled`. Wrap radios in a labelled `accessibilityRole="radiogroup"`.
- Every literal `t('…')` key must exist in `locales/en.ts` (`t()` returns `''` for a missing key; `hooks/__tests__/localeKeys.test.ts` enforces it).
- Teal text and icons use `colors.tintText` / `brand.primaryDark` (#0F766E). `brand.primary` / `colors.tint` (#0D9488) is for fills and borders only (3.74:1 as text).
- Web pages are rendered to HTML at build time: text from the clock, time zone or browser locale renders after mount (`useHasMounted`), or hydration fails (React #418).
- Every route screen renders `<PageTitle title=… />` (document `<title>`).

### Security
- **Service-role key NEVER leaves the server** (`app/api/secure-proxy/route.ts`).
- All write operations to Supabase must go through the secure proxy.
- Validate all user inputs on both client and server.
- Never store secrets in `EXPO_PUBLIC_*` env vars.
- Sanitize all form data before constructing Supabase queries.
- RLS policies must be active on all tables.

### Performance
- Pagination / limit all Supabase list queries (default: 500 max).
- Use `Promise.all` for parallel independent fetches.
- Guard async state updates with request-ID refs (see `useDemandForecast.ts` pattern).
- Memoize derived computations with `useMemo`.

### Naming Conventions
- Files: `camelCase.ts` / `PascalCase.tsx` for components.
- Types/interfaces: `PascalCase`.
- Constants: `SCREAMING_SNAKE_CASE`.
- Hooks: `useCamelCase`.
- DB columns: `snake_case` (Supabase convention).
- TypeScript types: `camelCase` for properties (mapped from DB `snake_case`).

---

## 7. Testing Strategy

- **Unit tests**: Pure functions (metrics, validators, utils) — co-located in `__tests__/`.
- **Component tests**: Use `react-test-renderer` + `act` for async flows.
- **Integration tests**: Key hook interactions mocking the secure proxy fetch.
- **No e2e yet**: Playwright/Detox to be added in a later phase.
- **Run tests**: `npm test`
- **Lint**: `npm run lint`

### Test File Location Convention
- `app/(tabs)/__tests__/` for screen tests
- `hooks/__tests__/` for hook tests
- `components/__tests__/` for component tests
- `services/__tests__/` for service tests (to be added)

---

## 8. Scheduling / Optimization Domain Knowledge

### Current approach
Manual assignment with client-side validation, plus auto-assign (suggestions the manager applies):
- Times are wall-clock times in the business IANA zone (`utils/zonedTime.ts`); durations, overlap and rest are measured in elapsed time (a 22:00–06:00 night is 9 h on a fall-back night, 7 h on spring-forward); a span the spring-forward gap would make zero or negative (02:00–03:00 New York on 2026-03-08) moves to after the gap with its wall-clock length (`zonedSpan`, CHG-087); weekdays and calendar days come from the local date key
- **Hard constraints** (both engines, one definition: `checkEligibility` in `services/shiftAssigner.ts`): role match; availability covers the shift (overnight and split slots); no overlap with any shift of the worker, and never two positions of one slot (a zero-length interval occupies its instant); minimum rest between shifts; max daily hours (by start date) and ISO-weekly hours. Limits are the location's legal hard limits (with its stricter-only overrides applied) merged with the business's (`utils/autoAssignSettings.ts`, stricter wins).
- **Greedy + 2-opt** (`assignShifts`): first-fit by fairness score, 2-opt swaps, refill. Runs inline; the only engine on native.
- **ILP** (`services/optimizer/assignmentModel.ts`, CHG-085): binary x[w,s] for every (worker, slot) pair that passes the single-shift checks against the existing roster; coverage rows Σx ≤ required; per worker, one row per maximal clique of slots that overlap or are closer than the minimum rest (an interval graph on [start, end + rest)); daily and weekly hour rows in minutes. Objective is **lexicographic, solved as three stages**: (1) maximize filled positions; (2) with coverage fixed, minimize Σ over role groups of the largest |hours − group mean| (hours in the run's ISO weeks, existing + new; linear because the mean is linear); (3) with both fixed, maximize continuity (same template on the same weekday before = 2, same template = 1). Workers have no preference fields yet, so continuity is the only soft preference.
- **Run** (`services/optimizer/shiftOptimizer.ts`): greedy first, then the ILP stages within a shared time budget (default 2 s); every solver assignment is re-checked, open slots any worker can still take are filled, shortfalls get the greedy's reason codes, and the best of greedy and ILP schedules by (coverage, spread, continuity) is returned. `solver.engine` / `fallbackReason` say which won and why.
- **Where it runs** (`services/optimizer/autoAssignClient.ts`): web → a shared Web Worker (`solverWorker.ts`, bundled by Metro via `require.unstable_resolveWorker`; `highs` loaded with `require` to get its CommonJS build, because the ESM build's `import.meta` breaks classic scripts; the WASM is a Metro asset, `wasm` in `metro.config.js` assetExts). Client timeout = budget + 8 s grace, then terminate and run the greedy inline; AbortSignal cancels. Native or no Worker → greedy inline. `useAutoAssign`, `useDemandAwareSchedule` and the scheduler's `handleAutoAssign` all go through `runAutoAssign`.
- **Bench**: `npm run bench:assign` (not in CI).

### Next
- Location picker for auto-assign (today only the account's only location applies).
- Day-of-week preferences and skills once workers carry them; feed them into stage 3.
- Week-at-once auto-assign in the UI (`OptimizeInput.dates` is supported by the model and the client).

---

## 9. Environment Variables

| Variable | Location | Purpose |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | Client | Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Client | Supabase anon public key |
| `EXPO_PUBLIC_SECURE_PROXY_URL` | Client | URL of the secure proxy API route |
| `EXPO_PUBLIC_FORECAST_API_URL` | Client | Optional: External AI forecast API URL |
| `EXPO_PUBLIC_ACCOUNT_ID` | Client | Current account/tenant ID |
| `EXPO_PUBLIC_USER_ID` | Client | Current user ID (pre-auth placeholder) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Service-role key — NEVER expose to client |
| `CLERK_JWKS_URL` | Server only | Clerk JWKS URL; required — API routes return 503 without it |
| `CLERK_ISSUER` | Server only | Optional; expected `iss` (defaults to the JWKS URL origin) |
| `CLERK_AUTHORIZED_PARTIES` | Server only | Optional comma-separated `azp` allow-list |
| `HORARIO_INSECURE_DEV_AUTH` / `HORARIO_DEV_ACCOUNT_ID` | Server, local dev only | Skip Clerk with one fixed tenant; refused when NODE_ENV=production |
| `EXPO_PUBLIC_APP_ENV` | Client (build time) | `production` hides diagnostics |

---

## 10. Key Files to Know

| File | Purpose |
|---|---|
| `app/(tabs)/scheduler.tsx` | Main scheduling UI (needs splitting) |
| `app/(tabs)/schedulerMetrics.ts` | Pure uncovered-loss metric functions |
| `app/api/secure-proxy/route.ts` | Server-side Supabase proxy (service role) |
| `services/demandForecast.ts` | Client-facing forecast service |
| `services/forecasting/` | Forecast models (`models.ts`), backtest selection and intervals (`selection.ts`), per-role pipeline (`statisticalForecast.ts`) |
| `utils/locationValidation.ts` | Location validation shared by client and proxy (jurisdiction must match the place) |
| `components/locations/LocationSetupCard.tsx` | Location / jurisdiction confirmation form (detection pre-fills only) |
| `services/supabaseClient.ts` | Anon client factory |
| `services/onboardingProgress.ts` | Onboarding persistence |
| `hooks/useCompliance.ts` | Labor-rule findings for the visible roster week, per location |
| `utils/autoAssignSettings.ts` | Legal + business constraints and time zone for an auto-assign run |
| `services/labor/overrides.ts` | Location override schema, stricter-only validation, `applyOverrides` |
| `services/optimizer/autoAssignClient.ts` | `runAutoAssign`: Web Worker ILP with timeout / cancel, greedy fallback |
| `services/optimizer/assignmentModel.ts` | ILP model and LP text (HiGHS) for auto-assign |
| `utils/workerLaborValidation.ts` | Worker labor attributes validation shared by client and proxy |
| `hooks/useDemandForecast.ts` | Forecast state management hook |
| `hooks/useStreak.ts` | Streak counter with AsyncStorage |
| `hooks/useSessionWellness.ts` | Break-prompt wellness hook |
| `hooks/usePersonalizedFeed.ts` | Feed ranking hook |
| `hooks/useEthicalReward.ts` | Reward tier logic |

---

## 11. Known Technical Debt & Issues

1. `scheduler.tsx` is ~600+ lines — must be split into sub-components/hooks.
2. Workers, templates, and roster are entirely in-memory; they reset on every reload.
3. `persistShiftStatus` and `persistShiftNotification` are stubs (just `console.log` + setTimeout).
4. Home screen data (upcomingShifts, staffingGaps) is hardcoded; no live queries.
5. Form inputs use raw text for dates and times — no date/time picker components.
6. No authentication — `accountId` and `userId` are hardcoded env vars.
7. No error boundaries in the component tree.
8. The `explore.tsx` tab is the default Expo placeholder with no real content.
9. Sample shift dates are hardcoded to December 2024 (past dates).
10. No rate limiting or authentication validation on the secure proxy.
11. ~~`businessTimezoneOffsetMinutes`~~ removed (CHG-077). The assigner takes an IANA `timeZone`; callers pass `getBusinessTimeZone(location)` (`utils/businessTimeZone.ts`), which returns the location's `time_zone` when valid, else the device zone (CHG-082). The scheduler's auto-assign only has a location when the account has exactly one (no location picker yet). `timezoneOffsetMinutes` on `AssignmentInput` is a deprecated fixed-offset fallback (no DST).
12. The `shifts` table in Supabase is for historical data only; the live roster is never persisted.

---

## 12. Phase Execution Rules

- Always read `CLAUDE.md` + `Claude_changes.md` in parallel at the start of every session.
- Never write code without reading the relevant files first.
- Append a new `CHG-###` entry to `Claude_changes.md` before every commit.
- Tests must pass (`npm test`) before committing any code change.
- Lint must pass (`npm run lint`) before committing.
- All changes must be committed with the CHG-### ID in the commit message.

---

## 13. Context Compression Protocol (MANDATORY)

**Proactive context compression is required** — do not wait until context is full.

### When to compress
- Before starting any new phase or multi-file change when the conversation has grown large.
- Whenever the context feels heavy (many files read, long reasoning chains, many tool calls accumulated).
- When switching focus area (e.g., from backend work to UI work).
- At the end of a session before summarizing results to the user.

### How to compress

**[SUMMARY] entry** — append to `Claude_changes.md` before making changes in a new session or phase:
```markdown
### [SUMMARY] — YYYY-MM-DD HH:MM UTC
**Last CHG completed:** CHG-###
**Current state:** one-paragraph snapshot of where the project stands right now
**Active decisions:** key architectural/design decisions made that are still in force
**Next action:** the exact next step to be taken
**Watch out for:** specific gotchas, stale data, or incomplete items to keep in mind
```

**[TEMP] entry** — append mid-session when context is getting heavy but work is not yet at a commit point:
```markdown
### [TEMP] — YYYY-MM-DD HH:MM UTC
**Context dump:** brief bullet list of what has been read/decided so far in this session
**Files in flight:** list of files being actively changed
**Resumption point:** where to pick up if context resets
```

### Rules
- Write the [SUMMARY] or [TEMP] entry **before** the next tool call that would add more context.
- Never skip compression when starting a Phase 2+ execution block.
- [TEMP] and [SUMMARY] entries do NOT get a CHG-### ID — they are navigation aids only.
- After writing a [SUMMARY], re-read only `CLAUDE.md` + `Claude_changes.md` (not the whole codebase) to re-ground.
