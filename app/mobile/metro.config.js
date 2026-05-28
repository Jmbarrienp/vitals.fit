// eslint-disable-next-line @typescript-eslint/no-var-requires
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const projectRoot = path.resolve(__dirname);
const config = getDefaultConfig(projectRoot);

module.exports = withNativeWind(config, { input: './global.css' });
