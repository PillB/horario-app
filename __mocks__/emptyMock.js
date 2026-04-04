// Empty mock for Expo SDK 53 winter runtime polyfills.
// These polyfills use lazy globalThis property registration via PolyfillFunctions
// which is incompatible with Jest's module scope. Mocking them as no-ops prevents
// the "import outside scope" ReferenceError across all test suites.
module.exports = {};
