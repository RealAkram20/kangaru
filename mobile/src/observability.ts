import * as Sentry from '@sentry/react-native';

/**
 * Error and performance reporting for the driver app (ADR-0054).
 *
 * ## This one costs a release, and that was said before it was chosen
 *
 * `@sentry/react-native` is a **native** module with a config plugin. Unlike
 * the backend and the web app, switching it on is not a redeploy: the app has
 * to be rebuilt and a fresh signed APK installed on every handset. The driver
 * app is Track B and has not shipped, so this rides along with the first
 * build rather than forcing one.
 *
 * ## Why it is initialised here and called from `index.ts`
 *
 * Same reason `PresenceTask` and `registerOfferBackgroundHandler` are: Android
 * cold-starts this app *into* a notification tap or a background task, with no
 * component tree. A crash during that start is exactly the crash worth having
 * a report for, and an init inside a `useEffect` has not run yet when it
 * happens.
 *
 * ## What it sends
 *
 * The owner chose full request data (ADR-0054 §2). Two things are still off,
 * and neither was part of that choice:
 *
 * - **No Session Replay.** It records the screen, which for a driver means a
 *   passenger's name, number and address on a phone in a cradle.
 * - **No `attachScreenshot`.** Same reason, one frame at a time.
 *
 * ## The condition drivers actually work in
 *
 * `PRODUCT.md`: upcountry, on patchy networks. The SDK queues events on disk
 * and sends them when the network returns, which is the behaviour that makes
 * this useful at all here — the crashes worth seeing are the ones that happen
 * where there is no signal to report them from.
 */
export function startObservability(): void {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

  // Absent in development and in the Jest environment. Returning early rather
  // than calling `init` with an empty DSN keeps the native layer out of the
  // test runner entirely — `mobile/jest.setup.ts` would otherwise need a mock
  // for a module that does nothing.
  if (!dsn) {
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT ?? 'production',

    sendDefaultPii: true,

    // Tracing is billed per transaction and a handset generates them on every
    // screen change. A tenth is plenty to see that a screen takes four
    // seconds; the driver-app agents' own worklog entry on frozen screens is
    // the kind of thing this is meant to make measurable rather than
    // anecdotal.
    tracesSampleRate: Number(process.env.EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? 0.1),

    // Off by default in the SDK; named here so that a future reader can see
    // it was considered rather than missed. See the docblock above.
    attachScreenshot: false,
    attachViewHierarchy: false,
  });
}
