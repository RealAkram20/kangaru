import Constants from 'expo-constants';

/**
 * What version of the app this is, read from the manifest rather than typed.
 *
 * **The mockup's "v2.3.0" is somebody's placeholder** and this app is on 1.0.0.
 * A hardcoded version string is wrong the first time anybody ships and stays
 * wrong silently — and this is the number a driver reads out when they ring the
 * office about a bug, so being wrong here wastes somebody's afternoon.
 *
 * `expo-constants` is already a transitive dependency of the Expo runtime; this
 * adds nothing to the bundle.
 *
 * The build number is deliberately **not** shown. `app.json` carries no
 * `ios.buildNumber` or `android.versionCode` yet, so it would render as
 * "1.0.0 (undefined)" — and a driver reading a version aloud needs the short
 * one anyway.
 */
export function appVersion(): string {
  const version = Constants.expoConfig?.version;

  // An em dash rather than a guess. A version this app could not read is not
  // "1.0.0" — `docs/screen-rules.md` §1 applies to a string the office will
  // act on as much as to a figure.
  return typeof version === 'string' && version !== '' ? `v${version}` : '—';
}
