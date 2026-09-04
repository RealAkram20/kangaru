const withLockScreenCallUi = require('./withLockScreenCallUi');

/**
 * The config plugin that lets a job offer draw over the lock screen
 * (ADR-0049 §2).
 *
 * ## Why this is tested when nothing else in `plugins/` is
 *
 * Because it runs **once, at prebuild, on a machine nobody is watching**, and
 * every way it can be wrong is silent:
 *
 * - Without `USE_FULL_SCREEN_INTENT`, Android does not refuse the full-screen
 *   intent — it downgrades it to an ordinary heads-up banner. Nothing throws,
 *   nothing logs, and the app behaves exactly as it did before the feature was
 *   built.
 * - Without `showWhenLocked` and `turnScreenOn`, the intent fires, the activity
 *   starts, and the keyguard is drawn on top of it. The phone rings, the driver
 *   looks, and finds their lock screen.
 * - A duplicated `<uses-permission>` is a manifest-merger *build* failure, and
 *   prebuild is routinely run against a manifest this plugin has already been
 *   through.
 *
 * None of those is visible from inside the JavaScript, and none of them would
 * fail any other test in this repo. So the mod is pulled off the config and
 * run against a synthetic manifest — `withAndroidManifest(config, action)`
 * pushes `action` onto `config.mods.android.manifest`, which is the whole
 * trick and the reason no `expo prebuild` is needed here.
 */

/** A manifest shaped like the one `expo prebuild` hands the mod. */
function expoManifest() {
  return {
    manifest: {
      $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
      'uses-permission': [
        { $: { 'android:name': 'android.permission.INTERNET' } },
        { $: { 'android:name': 'android.permission.WAKE_LOCK' } },
      ],
      application: [
        {
          $: { 'android:name': '.MainApplication' },
          activity: [
            { $: { 'android:name': '.MainActivity', 'android:launchMode': 'singleTask' } },
            { $: { 'android:name': 'com.facebook.react.devsupport.DevSettingsActivity' } },
          ],
        },
      ],
    },
  };
}

async function apply(modResults) {
  const config = withLockScreenCallUi({ name: 'KangaruRide Driver', slug: 'kangaru' });
  const { modResults: out } = await config.mods.android.manifest({
    modResults,
    modRequest: {},
  });

  return out;
}

const permissions = (m) => m.manifest['uses-permission'].map((p) => p.$['android:name']);

const mainActivity = (m) =>
  m.manifest.application[0].activity.find((a) => a.$['android:name'] === '.MainActivity').$;

describe('withLockScreenCallUi', () => {
  it('adds the permission without disturbing the ones already there', async () => {
    const perms = permissions(await apply(expoManifest()));

    expect(perms).toContain('android.permission.USE_FULL_SCREEN_INTENT');
    expect(perms).toContain('android.permission.INTERNET');
    expect(perms).toContain('android.permission.WAKE_LOCK');
  });

  it('marks the launcher activity as drawable over the keyguard', async () => {
    const activity = mainActivity(await apply(expoManifest()));

    expect(activity['android:showWhenLocked']).toBe('true');
    expect(activity['android:turnScreenOn']).toBe('true');
    // Whatever Expo put there stays there.
    expect(activity['android:launchMode']).toBe('singleTask');
  });

  /**
   * Found by `android:name`, never by position. Expo's manifest has one
   * activity today and plugins add their own; an index-based lookup would
   * eventually set these on somebody else's activity, where they do nothing —
   * silently, in a build that still compiles.
   */
  it('marks only the launcher activity', async () => {
    const manifest = await apply(expoManifest());
    const other = manifest.manifest.application[0].activity.find(
      (a) => a.$['android:name'] !== '.MainActivity',
    ).$;

    expect(other['android:showWhenLocked']).toBeUndefined();
    expect(other['android:turnScreenOn']).toBeUndefined();
  });

  /**
   * A duplicated `<uses-permission>` fails the manifest merger, and prebuild
   * is routinely run again over a manifest this has already processed.
   */
  it('can be applied twice without duplicating the permission', async () => {
    const twice = await apply(await apply(expoManifest()));

    expect(
      permissions(twice).filter((p) => p === 'android.permission.USE_FULL_SCREEN_INTENT'),
    ).toHaveLength(1);
  });

  /**
   * **Loudly, on purpose.** A silent return here produces a build in which the
   * ring works, the notification works, and the offer never appears over the
   * lock screen — which only shows up on a locked handset, long after the
   * build succeeded.
   */
  it('refuses to build rather than silently skip a renamed activity', async () => {
    const manifest = expoManifest();
    manifest.manifest.application[0].activity = [];

    await expect(apply(manifest)).rejects.toThrow(/MainActivity not found/);
  });

  it('refuses to build when there is no application element at all', async () => {
    const manifest = expoManifest();
    manifest.manifest.application = [];

    await expect(apply(manifest)).rejects.toThrow(/No <application>/);
  });
});
