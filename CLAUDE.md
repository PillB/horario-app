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
│   ├── demandForecast.ts       Client-side forecast service (calls secure proxy)
│   ├── onboardingProgress.ts   Onboarding fetch/upsert (client-side + secure proxy)
│   └── supabaseClient.ts       Anon Supabase client factory
├── supabase/migrations/        SQL migration files
└── docs/                       Supabase setup + env docs
```

### Data Flow

```
Client (Expo App)
  → services/demandForecast.ts (anon-key or no-key calls)
  → app/api/secure-proxy/route.ts  ← service-role key lives HERE ONLY
  → Supabase (PostgreSQL)
      ├── shifts             (historical shifts for forecasting)
      ├── external_signals   (demand boost signals)
      ├── demand_targets     (AI/manual demand forecasts)
      └── onboarding_progress
```

---

## 4. Current Feature Status

> Rows marked "re-verified" were checked against the code on that date; others may be stale.

| Feature | Status | Notes |
|---|---|---|
| Home dashboard | Partial | Static hardcoded data; no live queries |
| Scheduler UI | Partial | Works but all state is in-memory, resets on reload |
| Worker management (add/view) | Partial | In-memory only, no DB persistence |
| Shift template management | Partial | In-memory only, no DB persistence |
| Roster (shift assignment) | Partial | In-memory only; fake persistence functions |
| Availability tracking | Partial | In-memory, validated, no DB |
| Demand forecasting (AI proxy) | Working | Requires EXPO_PUBLIC_FORECAST_API_URL + Supabase setup |
| Demand target overrides | Working | Persisted to Supabase via proxy |
| Uncovered-loss metric | Working | Pure function, well-tested |
| Onboarding checklist | Working | Persisted to Supabase via proxy |
| Streak counter | Working | Persisted to AsyncStorage |
| Session wellness prompts | Working | In-memory, no persistence |
| Personalized feed | Working | In-memory ranking, no server |
| Push notifications | Missing | `notified` flag exists but no actual push |
| Authentication | Working | Clerk sign-in; API routes verify Clerk session JWTs and fail closed (`server/proxyAuth.ts`) — re-verified 2026-10-18 |
| Real-time updates | Missing | No Supabase realtime subscriptions |
| Shift optimization algorithm | Partial | Greedy + 2-opt auto-assign (`services/shiftAssigner.ts`), overnight-aware, reports shortfalls; CP-SAT optimizer planned (step 3) |
| Analytics screen | Missing | explore.tsx is placeholder |
| Labor-law constraint engine | Partial | Optional max daily/weekly hours and min rest in the assigner; per-jurisdiction rule packs planned (step 3) |
| Multi-tenant support | Working | Tenant = Clerk org id, else user id; enforced in the proxy and by RLS (`20261018000001_tenant_isolation.sql`) — re-verified 2026-10-18 |
| Date/time picker components | Missing | Raw text inputs only |
| Error boundaries | Partial | ErrorBoundary used in `app/_layout.tsx` and some screens |
| CI/CD pipeline | Working | `ci.yml` (typecheck, lint, tests, web export, local-Supabase RLS + isolation tests); `migrate.yml` (dev on merge, prod manual) |
| EAS build config | Partial | `eas.json` exists; not re-verified |

---

## 5. Database Schema (Supabase)

### Tables that exist (via migrations/docs):
- `shifts` — historical shift data (date, role, worker_id, hours)
- `external_signals` — demand boost signals (date, role, signal_type, weight)
- `demand_targets` — model/override demand forecasts (date, role, required, source, …)
- `onboarding_progress` — account-level onboarding flags

### Tables that need to be created:
- `workers` — worker profiles (id, name, role, skills, account_id)
- `availability` — worker availability windows (worker_id, day_of_week, from_time, to_time)
- `shift_templates` — reusable shift templates (id, name, role, start, end, coverage, account_id)
- `roster` — assigned shifts (id, date, worker_id, template_id, location, status, notified, account_id)
- `accounts` — tenant accounts
- `users` / auth integration — Supabase Auth

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
Manual assignment with client-side validation:
- Role match (worker role must equal template role)
- Availability coverage (worker's availability window must contain the template window)
- No time overlap per worker per day

### Target approach (future phases)
Constraint-based auto-assignment using a greedy/heuristic engine:
1. **Hard constraints** (must satisfy):
   - Worker availability covers shift window
   - Worker role matches template role
   - No overlapping shifts per worker
   - Max daily/weekly hours per worker
   - Minimum rest time between shifts (labor law)
2. **Soft constraints** (optimize for):
   - Fairness (equal hours distribution)
   - Worker preferences (day-of-week preferences)
   - Skill matching (prefer workers with exact skill match)
   - Continuity (prefer same worker for same recurring shift)
3. **Algorithm**: Greedy first-fit descending by priority score, with local-search improvement (2-opt swap). Full ILP (Integer Linear Programming) deferred until scale demands it.

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
| `services/supabaseClient.ts` | Anon client factory |
| `services/onboardingProgress.ts` | Onboarding persistence |
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
11. `businessTimezoneOffsetMinutes` is always the device timezone — not a business setting.
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
