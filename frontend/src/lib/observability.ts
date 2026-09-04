import * as Sentry from '@sentry/react'

/**
 * Error and performance reporting for the console and the public order form
 * (ADR-0054).
 *
 * ## Why this is a module and not four lines in `main.tsx`
 *
 * The DSN is baked into the bundle at build time, which means it is public —
 * anyone who opens devtools can read it. That is normal and by design for a
 * browser SDK (a DSN authorises *writing* events, nothing else), but it makes
 * the decisions below worth stating somewhere a reader will find them rather
 * than burying them in an entrypoint.
 *
 * ## What it sends
 *
 * The owner chose **full request data** (ADR-0054 §2), so a browser event may
 * carry what the user typed. Two things are still withheld, and neither is
 * part of that decision:
 *
 * - **Session Replay is not enabled.** It records the DOM, which on this
 *   platform means a passenger's address and a bank's trip list rendered as
 *   video. That is a separate decision from "send the request body" and
 *   nobody has been asked it.
 * - **No `sendDefaultPii` equivalent for auth.** The token lives in memory
 *   and is not attached to events.
 *
 * ## Sampling
 *
 * Errors are captured at 100%: an error nobody sees is the thing being fixed.
 * Traces run at 10% — tracing is billed per transaction, and a 1.4 s page
 * load shows up in a tenth of samples as clearly as in all of them.
 */
export function startObservability(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN

  // Absent in development and in CI, which is deliberate: `Sentry.init` with
  // no DSN is inert, but returning early keeps the integrations from being
  // constructed at all, so a developer's console stays clean and a test run
  // never queues a request it cannot send.
  if (!dsn) return

  Sentry.init({
    dsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT ?? import.meta.env.MODE,

    // The commit the SPA was built from. The backend stamps its own release
    // from `APP_BUILD`, and matching the two is what lets one issue in Sentry
    // be traced across both halves of a request.
    release: import.meta.env.VITE_APP_BUILD,

    sendDefaultPii: true,

    integrations: [
      // Page loads and navigations, which is where the sluggishness the owner
      // reported actually shows: the console's own measurement was 0.69 s to
      // 1.69 s to first byte on a 2 KB document, and this is what will say
      // whether that is the origin, the proxy or the network.
      Sentry.browserTracingIntegration(),
    ],

    tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE ?? 0.1),

    /*
     * **The one line that makes a browser trace and an API trace the same
     * trace** (ADR-0054 §4).
     *
     * The SDK's default is same-origin only — `localhost` and relative URLs.
     * The console is served from `kangaruride.com` and calls an API on a
     * different origin, so by default it attaches `sentry-trace` and
     * `baggage` to *nothing*, and the two halves of every request arrive in
     * Sentry as two unrelated traces. A slow page then says "the XHR took
     * 900 ms" and the API says "the request took 200 ms", with nothing
     * joining them and no way to tell which is lying.
     *
     * The API's own origin is the whole list, deliberately. These headers are
     * a trace id and a sampling decision — not a credential — but they should
     * still go to this platform's server and nowhere else, and a wildcard
     * here would attach them to every third party the console ever calls.
     *
     * Safe against CORS, which is the way this normally breaks: `config/cors.php`
     * sets `allowed_headers` to `*`, so the preflight already permits both.
     */
    tracePropagationTargets: [import.meta.env.VITE_API_BASE_URL],

    /*
     * The browser's own noise, which is not this application's.
     *
     * Left deliberately short. A long ignore list is how a real defect gets
     * filtered out by a pattern somebody added for an unrelated reason, and
     * the honest first version of an ignore list is nearly empty.
     */
    ignoreErrors: [
      // Fires when a user navigates away mid-request. Not a fault, and it
      // would otherwise be the loudest issue in the project.
      'AbortError',
      'Non-Error promise rejection captured',
    ],
  })
}
