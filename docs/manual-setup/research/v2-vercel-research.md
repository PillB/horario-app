# Vercel — Research Findings (v2)

I'll run all five searches simultaneously to gather information on the integration gotchas.
Now let me fetch the most relevant pages for deeper detail:
It seems the persistent state keeps getting lost. Let me do everything in one code block:
Now I have enough information to write the research summary. Let me compile the findings:
Now I have comprehensive information. Let me write the research summary.

---

## Findings

### Vercel Node.js Runtime & Function Limits (2025)
- 
Vercel now defaults to **Node.js 24.x** for new projects, with 22.x and 20.x also available. Only major versions are selectable; Vercel auto-rolls minor/patch updates.
 **⚠️ This is a significant change** — the existing manual references Node.js runtime but doesn't specify a version pin. Node 24.x may introduce breaking changes for dependencies expecting Node 20/22.
  - Source: https://vercel.com/docs/functions/runtimes/node-js/node-js-versions

- 
Hobby plan max function duration is 300s (configurable up to 300s), Pro/Enterprise up to 800s. If Fluid Compute is enabled, these values increase across plans.

  - Source: https://vercel.com/docs/functions/limitations

- 
The maximum payload size for request body or response body of a Vercel Function is **4.5 MB**. Exceeding it returns error 413: `FUNCTION_PAYLOAD_TOO_LARGE`.
 Workaround: use streaming functions (no limit) or upload directly to source (e.g., Supabase Storage presigned URLs).
  - Source: https://vercel.com/docs/functions/limitations

- 
The limit of Environment Variables per environment per project is 1000. The total size of Environment Variables (names and values) is limited to **64KB** for Node.js projects.

  - Source: https://vercel.com/docs/limits

### Expo Router API Routes on Vercel — Deployment Configuration
- 
The Expo docs now show a **vercel.json v3** format that uses `buildCommand`, `outputDirectory`, `functions`, and `rewrites` — replacing the older v2 format that used `version`, `builds`, and `routes`.
 The documented v3 config pins `"runtime": "@vercel/node@5.1.8"` with `"includeFiles": "dist/server/**"`.
  - Source: https://docs.expo.dev/router/reference/api-routes/

- 
Expo's API route docs carry a warning: "Third-party adapters are subject to breaking changes. We have no continuous tests against them."
 This means the Vercel adapter (`expo-server/adapter/vercel`) can break without notice between Expo releases.
  - Source: https://docs.expo.dev/router/reference/api-routes/

- **Known Limitations** (still current in Expo docs):
  - 
API Routes bundle all code (minus Node.js built-ins) into a single file, meaning external dependencies with platform binaries (e.g., `sharp`) cannot be used.

  - 
ESM is not supported in the bundled output — all code is transpiled to CommonJS. The docs recommend writing ESM anyway for future compatibility.

  - Source: https://docs.expo.dev/router/reference/api-routes/

### POST Timeout Bug on Vercel (Expo Router API Routes)
- 
Issue #35763 (March 2025, SDK 52) reports that POST requests to Expo API routes on Vercel result in `FUNCTION_INVOCATION_TIMEOUT` errors with `SyntaxError: JSON Parse error`, while the same routes work fine on EAS Hosting and GET requests work fine on Vercel.
 This issue was assigned to Expo engineers (`@kitten`, `@krystofwoldrich`) and is in "needs review" status.
  - Source: https://github.com/expo/expo/issues/35763

### ESM Deployment Failure
- 
Issue #30423 reports that Expo API Router Vercel deployment fails with ESM-related errors.
 This aligns with the documented limitation that ESM is not supported in the server bundle.
  - Source: https://github.com/expo/expo/issues/30423

### Raw Body for Webhook Signature Verification (Stripe/Clerk)
- 
Vercel's updated guidance (November 2025) shows that for Web API–style route handlers, you simply use `await request.text()` to get the raw body for webhook signature validation.
 No special body parser disabling config is needed with the modern Web API approach.
  - Source: https://vercel.com/kb/guide/how-do-i-get-the-raw-body-of-a-serverless-function

### EXPO_PUBLIC_ Environment Variables Bug
- 
Issue #36767 (May 2025) reports Expo not correctly picking up all `EXPO_PUBLIC_` environment variables defined in `.env` files — only the first variable loads, requiring the user to add a new variable to trigger re-export of all variables.
 This is an intermittent caching/loading bug in the Expo CLI.
  - Source: https://github.com/expo/expo/issues/36767

### Clerk Core 3 Breaking Changes (affects "Clerk v3" in the manual)
- 
**Package rename:** `@clerk/clerk-expo` becomes `@clerk/expo`.

- 
`publishableKey` prop is now **required** in `ClerkProvider` for Expo apps — it no longer falls back to `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` from environment variables, because environment variables inside `node_modules` are not inlined during production builds in React Native/Expo.

- 
`getToken()` now throws `ClerkOfflineError` when offline and uses proactive background refresh.

- 
**Node.js 20.9.0+ is required** for all Clerk packages.

- 
`Protect`, `SignedIn`, and `SignedOut` components are replaced by a single `Show` component.

  - Source: https://clerk.com/docs/guides/development/upgrading/upgrade-guides/core-3

### Expo SDK 53 / Router v5 Specifics
- 
SDK 53 enables the **New Architecture by default** in all projects (opt-out available).

- 
React Server Functions support is now in beta, deployed via `EXPO_UNSTABLE_DEPLOY_SERVER` environment variable with EAS Hosting.

- 
Expo Router v5 introduces server redirects/rewrites configurable in `app.json`.

  - Source: https://expo.dev/changelog/sdk-53

---

## New Gotchas (not in existing manual)

1. **Node.js 24.x is now Vercel's default** — New Vercel projects will use Node 24.x unless explicitly pinned. Since Clerk Core 3 requires Node.js ≥20.9.0 and the Expo server adapter was developed against Node 20/22, there may be compatibility issues. The manual should recommend pinning Node.js version in Vercel project settings (Settings → Build & Deployment → Node.js Version → 22.x).

2. **POST requests to Expo API routes may timeout on Vercel** (Issue #35763) — This is an open, unresolved bug as of March 2025 where POST requests fail with `FUNCTION_INVOCATION_TIMEOUT` while GET works fine. The same endpoints work on EAS Hosting. Affects the `app/api/secure-proxy+api.ts` pattern documented in the manual. **Workaround:** Verify POST routes are working after deployment; if not, consider EAS Hosting as fallback or test with SDK 53 (issue was reported on SDK 52).

3. **Clerk Core 3 package rename: `@clerk/clerk-expo` → `@clerk/expo`** — The manual references "Clerk v3" but may still use the old package name. The new package name is mandatory in Core 3.

4. **`publishableKey` now required as explicit prop** — Clerk no longer auto-reads `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` from env vars inside `ClerkProvider`. You must pass it explicitly. This is a production crash risk if missed.

5. **Clerk `SignedIn`/`SignedOut`/`Protect` → `Show` component** — If the existing codebase uses these components, they've been replaced by a single `Show` component in Clerk Core 3.

6. **EXPO_PUBLIC_ env var loading bug** (Issue #36767) — Intermittent issue where only the first `EXPO_PUBLIC_` variable from `.env` files gets loaded by Expo CLI. Workaround: add a dummy new variable to force re-export, or clear Metro cache (`npx expo start --clear`).

7. **4.5 MB payload limit on Vercel Functions** — Both request and response bodies are capped at 4.5 MB. For file uploads proxied through `secure-proxy+api.ts`, this could be a silent failure point. Workaround: use Supabase Storage presigned URLs for direct uploads, or use streaming responses.

8. **64 KB total env var size limit** — Vercel limits the combined size of all environment variable names and values to 64KB per deployment. With Clerk + Supabase + Stripe + Culqi keys, this is unlikely to hit but worth noting for projects that grow.

---

## Outdated Steps (needs update)

1. **vercel.json configuration may need update** — The Expo docs now show a v3 format for vercel.json. If the manual documents the v2 format (with `"version": 2`, `"builds"`, `"routes"`), it should be updated to the v3 format using `"buildCommand"`, `"outputDirectory"`, `"functions"`, and `"rewrites"`.

2. **`@vercel/node` version pin** — The Expo docs pin `"runtime": "@vercel/node@5.1.8"`. If the manual references a different version or doesn't pin at all, update accordingly. Pinning prevents surprise breakage from Vercel runtime updates.

3. **Node.js version recommendation** — Manual should explicitly recommend pinning Node.js 22.x in Vercel project settings, since the default is now 24.x and Expo SDK 53 / RN 0.79 may not be fully tested against it.

4. **Clerk package name** — If the manual references `@clerk/clerk-expo`, update to `@clerk/expo` for Core 3.

5. **ClerkProvider configuration** — Manual should show explicit `publishableKey` prop being passed to `<ClerkProvider>`, not relying on automatic env var fallback (which no longer works in Core 3 for Expo).

6. **Raw body for webhooks** — If the manual documents any complex body-parser-disabling configuration for Stripe webhook verification, this can be simplified. Modern Vercel Functions using Web API handlers just need `await request.text()`.

7. **Hobby plan timeout value** — Verify the manual states 300s max (not 10s or 60s which were older limits). Hobby plan now allows up to 300s configurable duration.

---

## Key URLs

| Resource | URL |
|---|---|
| Expo API Routes (official, incl. Vercel config) | https://docs.expo.dev/router/reference/api-routes/ |
| Expo Environment Variables guide | https://docs.expo.dev/guides/environment-variables/ |
| Vercel Functions Limits (current) | https://vercel.com/docs/functions/limitations |
| Vercel Supported Node.js Versions | https://vercel.com/docs/functions/runtimes/node-js/node-js-versions |
| Vercel General Limits (env vars, etc.) | https://vercel.com/docs/limits |
| Vercel Raw Body for Webhooks | https://vercel.com/kb/guide/how-do-i-get-the-raw-body-of-a-serverless-function |
| Vercel 4.5MB Body Size Bypass | https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions |
| Vercel Max Duration Config | https://vercel.com/docs/functions/configuring-functions/duration |
| Clerk Core 3 Upgrade Guide | https://clerk.com/docs/guides/development/upgrading/upgrade-guides/core-3 |
| Clerk Expo SDK Reference | https://clerk.com/docs/reference/expo/overview |
| Clerk Vercel Deployment Guide | https://clerk.com/docs/guides/development/deployment/vercel |
| Expo SDK 53 Changelog | https://expo.dev/changelog/sdk-53 |
| Expo Router v5 Blog Post | https://expo.dev/blog/expo-router-v5 |
| **BUG:** POST timeout on Vercel (Issue #35763) | https://github.com/expo/expo/issues/35763 |
| **BUG:** ESM deployment failure (Issue #30423) | https://github.com/expo/expo/issues/30423 |
| **BUG:** EXPO_PUBLIC_ loading issue (Issue #36767) | https://github.com/expo/expo/issues/36767 |