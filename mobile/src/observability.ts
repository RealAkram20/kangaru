import * as Sentry from '@sentry/react-native';
import { Platform } from 'react-native';

/**
 * Error, performance and log reporting for the driver app (ADR-0054).
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
 * ## Logs, and the failure they exist for
 *
 * Errors report what crashed and tracing reports what was slow. Neither
 * reports the commonest production failure on a handset upcountry: nothing
 * crashed, nothing was slow, and the job still did not happen. This app
 * swallows exactly that in four places on purpose — a lock-screen Accept that
 * the network lost, an outbox database that would not open, a foreground
 * service the OS refused, a sign-in refused for a reason nobody sees. Each
 * silence is right for the *driver*, who cannot act on any of it mid-shift,
 * and wrong for the office. `Sentry.logger.*` at those points is what closes
 * that gap without putting a word more on screen.
 *
 * **Log attributes carry ids, never people.** §2 permits full request data on
 * an *error*; that is not extended here by accident. A log line gets trip and
 * offer ids, error codes, counts and durations. `Sentry.setUser` in
 * `AuthProvider` attaches `user.id` to every log automatically, which is the
 * one identifier worth having and is already in every error event under §2.
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

    // Off by default in the SDK. Everything below only does something because
    // of this line.
    enableLogs: true,

    // **JavaScript only.** The default is `'all'`, which also forwards the
    // native log stream — every third-party library's Logcat chatter, from a
    // phone on a Ugandan data bundle. The logs worth paying for are the ones
    // this app writes deliberately, plus the console seams below.
    logsOrigin: 'js',

    integrations: [
      // SDK 7 does not capture `console.*` on its own; 8.14 does it by
      // default. Two levels only, and they are not arbitrary: `GpsPingBuffer`
      // and `HttpOutboxTransport` both take an injected `warn` port that
      // defaults to `console.warn` — an odometer photo abandoned after three
      // failed attempts announces itself there and nowhere else. React
      // Native's own runtime warnings come through the same door. `log` and
      // `info` are development noise and are left out.
      Sentry.consoleLoggingIntegration({ levels: ['warn', 'error'] }),
    ],

    beforeSendLog: (log) => {
      // Logs have no sample rate — the whole level is the only unit of
      // control the SDK offers. Nothing in this app emits these two levels
      // today, so this is a standing guard against something that does
      // later shipping its debugging to production over mobile data.
      if (!__DEV__ && (log.level === 'trace' || log.level === 'debug')) {
        return null;
      }

      // **Expo Go announcing a limitation, not the app hitting a fault.**
      //
      // `expo-location` writes this to `console.warn` from its own
      // `_validate`, so the console integration above dutifully forwards it.
      // It fires from `stopPresenceUpdates` on *every* duty toggle and every
      // sign-out while anybody is testing in Expo Go, and it says nothing
      // about this app: `stopPresenceUpdates` already wraps the call in a
      // `try`/`catch`, and the shift ends correctly either way.
      //
      // **Safe to match on the message, unusually.** The string is Expo Go's
      // own, so it cannot occur in a development build or in release — the
      // two runtimes that matter. This rule is inert everywhere it could do
      // harm and only bites where the noise is, which is the opposite of the
      // usual objection to filtering on text.
      if (log.message?.includes('Background location is limited in Expo Go')) {
        return null;
      }

      return log;
    },
  });

  // Attached to every log and every event, so a report can be read without
  // knowing which handset it came from. `sentry.environment` and
  // `sentry.release` are added by the SDK itself; these two are not.
  Sentry.getGlobalScope().setAttributes({
    platform: Platform.OS,
    os_version: String(Platform.Version),
  });
}
