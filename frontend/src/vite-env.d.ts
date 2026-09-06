/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string
  /** Mapbox public token (pk.*) for the public order page map. Optional:
   * without it the map falls back to an OpenStreetMap embed. */
  readonly VITE_MAPBOX_TOKEN?: string
  /** Google OAuth client id for the "fill in with Google" prefill on the
   * order flow — prefill only, not a sign-in (ADR-0012: no customer
   * accounts yet). Optional: without it the button explains itself. */
  readonly VITE_GOOGLE_CLIENT_ID?: string

  /* ADR-0054 — error and performance reporting.
   *
   * All optional, and the SDK is inert without the first: development and CI
   * run with none of them set, which is why `startObservability()` returns
   * early rather than calling `Sentry.init` with an empty DSN.
   *
   * A browser DSN is public by construction — it is baked into the bundle
   * and readable in devtools. That is not a leak: a DSN authorises writing
   * events to one project and nothing else. It is **not** an auth token and
   * must never be reused as one. */
  readonly VITE_SENTRY_DSN?: string
  /** Defaults to Vite's `MODE`. Set explicitly so a staging build cannot
   * file its issues under `production`. */
  readonly VITE_SENTRY_ENVIRONMENT?: string
  /** Fraction of transactions traced, 0 to 1. Defaults to 0.1 — tracing is
   * billed per transaction. */
  readonly VITE_SENTRY_TRACES_SAMPLE_RATE?: string
  /** The commit this bundle was built from, matching the backend's
   * `APP_BUILD`. What lets one issue be followed across both halves. */
  readonly VITE_APP_BUILD?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
