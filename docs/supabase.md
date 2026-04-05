# Supabase — Environment Variables & Configuration

This project uses Supabase as the backend database. The Expo client uses the **anon key** for read-only access. All writes go through the server-side secure proxy (`app/api/secure-proxy+api.ts`), which holds the **service-role key** and never exposes it to the client.

## Environment Variables

| Variable | Where used | Required |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | Client + proxy | Yes |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Client (read-only queries) | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only (proxy) | Yes |

> **Critical:** `SUPABASE_SERVICE_ROLE_KEY` must **never** appear in an `EXPO_PUBLIC_*` variable. Expo's Metro bundler performs compile-time substitution of all `EXPO_PUBLIC_*` references, embedding the value in the client JavaScript bundle.

## Local Development

1. Copy the template and fill in your values:

   ```bash
   cp .env.example .env.local
   ```

2. Start Expo — it reads `EXPO_PUBLIC_*` variables automatically from `.env.local`:

   ```bash
   npx expo start
   ```

   > Expo SDK 50+ reads `.env.local` natively via the `expo/env` module — no `dotenv` import required in `app.config.ts`.

3. The dev Expo Router server also reads server-only variables (without `EXPO_PUBLIC_` prefix) from `.env.local` for API routes.

## CI / Production

- Set all variables in your CI provider's secret management (GitHub Actions secrets, Vercel environment variables, etc.)
- **Never** commit `.env.local` or any file containing real keys. Verify `.env.local` is in `.gitignore`:
  ```bash
  git ls-files | grep "\.env"
  # Expected: only .env.example
  ```
- For EAS Build, add variables under **Build → Environment variables** in the Expo dashboard, or in `eas.json` under the `env` block (public vars only).
- For Vercel, set variables under **Settings → Environment Variables**. Mark server-only vars as **not exposed to the browser**.

## Key Rotation

If a key is exposed or compromised:

1. Go to your Supabase project → **Settings → API** → reset the affected key.
2. Update the value in all deployment environments (Vercel, EAS, CI secrets).
3. Update your local `.env.local`.
4. Restart Expo with cache cleared: `npx expo start -c`.
5. If the service-role key was exposed, audit your Supabase logs for unexpected writes.

## Safe-Handling Checklist

- [ ] `.env.local` is in `.gitignore` (Expo adds this by default)
- [ ] Service-role key is only read in `app/api/` files
- [ ] No `EXPO_PUBLIC_*` variable contains a secret key
- [ ] Different anon keys used for development and production environments
- [ ] Keys rotated if `.env.local` was accidentally committed (see [SECURITY_REMEDIATION.md](SECURITY_REMEDIATION.md))
