// metro.config.js
//
// Metro bundler configuration for the Horario app.
//
// NOTE — New Architecture (Fabric + TurboModules):
//   `newArchEnabled: true` is already set in app.json.
//   Metro itself requires no extra flags to support the New Architecture;
//   the bridge-free runtime is activated at the native build level by that
//   app.json flag together with the Expo SDK 53 / RN 0.79.2 defaults.
//   Do not add undocumented experimental Metro flags here to "enable" it.

const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

// Explicit platform resolution priority.
// Metro will look for platform-specific files in this order, e.g.:
//   Foo.native.ts  →  Foo.ios.ts / Foo.android.ts  →  Foo.web.ts  →  Foo.ts
// Placing 'native' before 'ios'/'android' lets shared native overrides take
// precedence over platform-specific ones while still falling back to web/ts.
config.resolver.platforms = ['ios', 'android', 'native', 'web'];

// Ensure .ttf font files are treated as static assets so that custom fonts
// loaded via expo-font / @expo-google-fonts resolve correctly on all targets.
if (!config.resolver.assetExts.includes('ttf')) {
  config.resolver.assetExts.push('ttf');
}

// HiGHS's WebAssembly binary (npm `highs`, used by the auto-assign Web Worker,
// services/optimizer/solverWorker.ts) is served as a static asset; on web,
// require('highs/runtime') resolves to its URL.
if (!config.resolver.assetExts.includes('wasm')) {
  config.resolver.assetExts.push('wasm');
}

// ---------------------------------------------------------------------------
// Transformer
// ---------------------------------------------------------------------------

config.transformer = config.transformer ?? {};

// Strip console.* calls from production bundles to reduce bundle size and
// avoid leaking debug output. In development and preview builds all console
// output is preserved unchanged.
config.transformer.minifierConfig = {
  compress: {
    drop_console: process.env.NODE_ENV === 'production',
  },
};

// ---------------------------------------------------------------------------

module.exports = config;