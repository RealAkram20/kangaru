const { withAndroidManifest } = require('expo/config-plugins');

/**
 * Lets a job offer draw over the lock screen, the way a call does
 * (ADR-0049 §2).
 *
 * ## Why a plugin at all, and why this one is ours
 *
 * `react-native-notify-kit` can attach a full-screen intent to a
 * notification. It cannot make that intent *do anything* — its README says so
 * outright: *"The plugin does not configure Firebase, does not add
 * `USE_EXACT_ALARM`, does not add `USE_FULL_SCREEN_INTENT`, and does not
 * choose a foreground service type by default."*
 *
 * That is the correct call on their side. `USE_FULL_SCREEN_INTENT` is a Play
 * Store policy commitment, not a build detail, and a notification library that
 * silently added it would be signing an app up for a review category its
 * authors never chose. So the two manifest edits below are the app's to make,
 * and this file is where the app makes them.
 *
 * ## The two edits, and why neither works without the other
 *
 * **`USE_FULL_SCREEN_INTENT`.** Without it `setFullScreenIntent` is ignored
 * and Android posts an ordinary heads-up banner instead. Note the failure
 * shape: *ignored*, not refused. Nothing throws, nothing logs, and the app
 * behaves exactly as it did before stage two was built — which is the single
 * most likely way this feature gets shipped broken.
 *
 * **`showWhenLocked` and `turnScreenOn` on the launched activity.** Without
 * these, the intent fires, the activity starts, and Android draws the keyguard
 * on top of it. The driver hears the ring, wakes the phone, and finds their
 * lock screen — the offer is behind it, and by the time they have unlocked,
 * a good share of the window is gone. `turnScreenOn` is what wakes a dark
 * screen in the first place; `showWhenLocked` is what puts the offer in front
 * of the keyguard rather than behind it. Both are Android 8.1+ manifest
 * attributes, and this fleet's floor is well past that.
 *
 * There is a JavaScript-side equivalent for neither. `setShowWhenLocked` is an
 * Activity method, and the Activity here is Expo's generated `MainActivity`,
 * which we do not own the source of — a config plugin editing the manifest is
 * the supported way to reach it.
 *
 * ## What this deliberately does not do
 *
 * **It does not dismiss the keyguard.** With `showWhenLocked` the offer draws
 * over a locked phone and its buttons work, which is everything the decision
 * needs. Actually getting *into* the app — the pickup screen, the map, the
 * trip — still requires the driver to unlock, and that is right: a phone that
 * a passer-by can drive a shift from is a worse problem than an extra swipe.
 * `requestDismissKeyguard` would need native code in an Activity subclass, and
 * it would buy an unlock the driver has to perform anyway.
 *
 * ## After changing this file
 *
 * These are prebuild-time edits. They land in `android/AndroidManifest.xml`
 * during `expo prebuild`, which means **a new development build is required**
 * — reloading JavaScript over Metro will not pick them up, and the symptom of
 * forgetting is the silent-downgrade one described above.
 */
const FULL_SCREEN_INTENT = 'android.permission.USE_FULL_SCREEN_INTENT';

/** @type {import('expo/config-plugins').ConfigPlugin} */
const withLockScreenCallUi = (config) =>
  withAndroidManifest(config, (modConfig) => {
    const manifest = modConfig.modResults.manifest;

    ensurePermission(manifest, FULL_SCREEN_INTENT);
    ensureActivityShowsWhenLocked(manifest);

    return modConfig;
  });

/**
 * Adds a `uses-permission` unless the manifest already carries it.
 *
 * Idempotent because prebuild is run repeatedly against a manifest that may
 * already have been through this plugin — and a duplicated `uses-permission`
 * is a manifest merger failure, which fails the build rather than the feature.
 */
function ensurePermission(manifest, name) {
  manifest['uses-permission'] = manifest['uses-permission'] ?? [];

  const present = manifest['uses-permission'].some(
    (entry) => entry?.$?.['android:name'] === name,
  );

  if (!present) {
    manifest['uses-permission'].push({ $: { 'android:name': name } });
  }
}

/**
 * Marks the launcher activity as drawable over the keyguard.
 *
 * Found by `android:name`, not by position. Expo's generated manifest has one
 * activity today, but `expo-dev-client` and other plugins add their own, and
 * an index-based lookup would eventually set these attributes on somebody
 * else's activity — where they would do nothing, silently, in a build that
 * still compiles.
 */
function ensureActivityShowsWhenLocked(manifest) {
  const application = manifest.application?.[0];

  if (application === undefined) {
    throw new Error(
      '[withLockScreenCallUi] No <application> in AndroidManifest.xml. ' +
        'This plugin must run after the Expo Android manifest has been generated.',
    );
  }

  const main = (application.activity ?? []).find(
    (activity) => activity?.$?.['android:name'] === '.MainActivity',
  );

  if (main === undefined) {
    // Loudly, on purpose. A silent return here would produce a build in which
    // the ring works, the notification works, and the offer never appears over
    // the lock screen — the exact failure this plugin exists to prevent, and
    // one that only shows up on a locked handset.
    throw new Error(
      '[withLockScreenCallUi] .MainActivity not found in AndroidManifest.xml. ' +
        'A job offer cannot be shown over the lock screen without it (ADR-0049 §2).',
    );
  }

  main.$['android:showWhenLocked'] = 'true';
  main.$['android:turnScreenOn'] = 'true';
}

module.exports = withLockScreenCallUi;
