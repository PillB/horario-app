/**
 * Vercel serverless entry for the Expo Router server output.
 *
 * Follows the official Expo guide for SDK 53
 * (https://docs.expo.dev/router/reference/api-routes/, "Vercel"): every request
 * Vercel does not serve from `dist/client` is rewritten to this function, which
 * hands it to `@expo/server`. The adapter reads `dist/server/_expo/routes.json`,
 * so new pages and `+api` routes work without editing vercel.json.
 *
 * The file location (repo-root `api/index.ts`) and the build path are both
 * required by that guide. `dist/server` is bundled in via `includeFiles`.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createRequestHandler } = require('@expo/server/adapter/vercel');

module.exports = createRequestHandler({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  build: require('path').join(__dirname, '../dist/server'),
});
