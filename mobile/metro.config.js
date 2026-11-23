const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// The scanning logic is the extension's own source, imported in place (src/core/ext.ts), so Metro must watch it.
config.watchFolders = [path.resolve(__dirname, '../tools/extension-wasm/lib')];
// Those files sit outside this folder, so the packages their compiled code needs are looked up here.
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')];

module.exports = config;
