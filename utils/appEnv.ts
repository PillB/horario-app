/**
 * App-environment flags read from EXPO_PUBLIC_APP_ENV.
 *
 * EXPO_PUBLIC_APP_ENV is inlined into the bundle at build time by Metro, so it
 * must be set in the Vercel/EAS environment before `expo export` runs. Use
 * `production` for production builds; anything else (or unset) is treated as
 * a non-production build.
 *
 * The variable is read inside the function (not at module load) so tests can
 * change it; Metro still inlines the `process.env.EXPO_PUBLIC_*` reference.
 */
export function isProductionApp(): boolean {
  return process.env.EXPO_PUBLIC_APP_ENV === 'production';
}

/** Support diagnostics are only reachable in non-production builds. */
export function isDiagnosticsEnabled(): boolean {
  return !isProductionApp();
}
