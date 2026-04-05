# Horario — Smart Scheduling App

Horario (Spanish for "schedule") is a production-targeted mobile and web scheduling app built with Expo. It handles shift assignment, availability tracking, demand forecasting, and staffing-gap visibility for teams of any size.

## Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Framework | Expo (React Native) | 53.0.x |
| Routing | Expo Router (file-based) | 5.0.x |
| Language | TypeScript (strict) | 5.8.x |
| UI runtime | React / React Native | 19.0.0 / 0.79.2 |
| Backend / DB | Supabase (PostgreSQL + RLS) | `@supabase/supabase-js` 2.84.x |
| Auth | Clerk | `@clerk/expo` 3.1.x |
| Animations | react-native-reanimated | 3.17.x |
| Tests | Jest + jest-expo | 29.x |

## Prerequisites

- Node.js 20 LTS or later
- A [Supabase](https://supabase.com) project
- A [Clerk](https://clerk.com) application

## Getting Started

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env.local

# Fill in your values (see Environment Variables below)
# then start the dev server:
npx expo start
```

Press `i` for iOS simulator, `a` for Android emulator, or `w` for web.

## Environment Variables

Create `.env.local` in the project root. **Never commit this file.**

```env
# Supabase — public (safe to include in client bundle)
EXPO_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT-ID.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_anon_key

# Clerk — public
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_...
EXPO_PUBLIC_CLERK_FRONTEND_API=https://YOUR-INSTANCE.clerk.accounts.dev

# App
EXPO_PUBLIC_SECURE_PROXY_URL=http://localhost:8081/api/secure-proxy
EXPO_PUBLIC_APP_ORIGIN=http://localhost:8081
EXPO_PUBLIC_ACCOUNT_ID=your-account-uuid

# Server-only secrets — NEVER use EXPO_PUBLIC_ prefix for these
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
CLERK_SECRET_KEY=sk_live_...
CLERK_JWKS_URL=https://YOUR-INSTANCE.clerk.accounts.dev/.well-known/jwks.json
```

See [docs/supabase.md](docs/supabase.md) for a full variable reference and safe-handling guidelines.

## Database Setup

The app requires Supabase tables for scheduling data, demand forecasting, and onboarding. Apply migrations in order:

```bash
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

Or follow the step-by-step guide in [docs/SETUP_SUPABASE.md](docs/SETUP_SUPABASE.md).

## Security

All writes to Supabase go through a server-side API route (`app/api/secure-proxy+api.ts`) that holds the service-role key. The client-side app uses only the anon key.

- Row Level Security (RLS) is enabled on all tables.
- Clerk JWTs are verified server-side using RS256 and the JWKS endpoint.
- CORS is restricted to an explicit origin allowlist (no wildcard `*`).

See [docs/SECURITY_REMEDIATION.md](docs/SECURITY_REMEDIATION.md) for the security checklist, and [docs/COMPLIANCE_AUDIT.md](docs/COMPLIANCE_AUDIT.md) for open findings.

## Running Tests

```bash
# Run all tests
npm test

# Lint
npm run lint
```

Tests live under `__tests__/` directories co-located with the code they cover. The suite currently has 352 tests across 29 suites, all passing.

## Project Structure

```
horario-app/
├── app/
│   ├── (auth)/             Sign-in / sign-up screens (Clerk)
│   ├── (tabs)/             Main tab screens + scheduling logic
│   └── api/
│       ├── secure-proxy+api.ts   Server-side Supabase proxy (service-role key)
│       └── referrals+api.ts      Referral code API
├── components/             Shared UI components
├── constants/Colors.ts     Design system color tokens (WCAG AA compliant)
├── contexts/               React contexts (auth, locale, identity)
├── hooks/                  Custom hooks (forecast, streak, wellness, feed)
├── services/               Client-facing service layer
├── supabase/migrations/    SQL migration files (apply with supabase db push)
└── docs/                   Setup, security, and compliance guides
```

## Deployment

The app deploys to Vercel (web) and can be built for iOS/Android with EAS Build.

For Vercel deployment, configure all environment variables listed above under **Settings → Environment Variables**. The `secure-proxy` and `referrals` functions require Node.js 20.x runtime.

See [docs/MCP_COMPLIANCE.md](docs/MCP_COMPLIANCE.md) for the full deployment and compliance verification checklist.

## Contributing

Read [CLAUDE.md](CLAUDE.md) before making any changes. All commits require:

1. A `CHG-###` entry appended to `Claude_changes.md`
2. Tests passing (`npm test`)
3. Lint passing (`npm run lint`)
