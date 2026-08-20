// Learn more: https://docs.expo.dev/guides/customizing-metro/
const { getDefaultConfig } = require('expo/metro-config');

/**
 * The only reason this file exists: `inlineRequires`.
 *
 * Metro defaults it to false (metro-config/src/defaults/index.js) and Expo
 * does not override it, so every module in the bundle is evaluated at startup
 * whether or not the driver ever reaches it. `RootNavigator` imports all ~35
 * screens at module load, which pulls in their queries, their SVG charts and
 * both WebView maps before the first frame — for a shift in which roughly
 * thirty of those screens are never opened.
 *
 * With this on, a module's factory runs the first time something actually
 * reads from it rather than when the bundle loads. Nothing is downloaded
 * differently — React Native ships one bundle either way — but the parse and
 * initialisation cost moves off the startup path and onto first use.
 *
 * The caveat, and why this is a deliberate change rather than a default:
 * modules whose *import* has a side effect that must happen in order stop
 * being safe, because the import may now happen later or not at all. The
 * app's two such modules are listed below.
 */
const config = getDefaultConfig(__dirname);

config.transformer.getTransformOptions = async () => ({
  transform: {
    inlineRequires: {
      /**
       * These must be evaluated at load, in order, not on first read.
       *
       * `react-native-gesture-handler` installs its native handlers as an
       * import side effect and its own docs require it to be first in the
       * entry file; the drawer navigator depends on that having happened.
       * `react-native-reanimated` likewise sets up its babel-injected runtime
       * on import — it is a transitive dependency of the drawer here rather
       * than something the app imports itself, which makes a deferred
       * initialisation harder to spot, not easier.
       */
      blockList: {
        [require.resolve('react-native-gesture-handler')]: true,
        [require.resolve('react-native-reanimated')]: true,
      },
    },
  },
});

module.exports = config;
