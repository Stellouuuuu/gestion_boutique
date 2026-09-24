// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// expo-sqlite (web) charge son moteur wa-sqlite en WebAssembly.
config.resolver.assetExts.push('wasm');

module.exports = config;
