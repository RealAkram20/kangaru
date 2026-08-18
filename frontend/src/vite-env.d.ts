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
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
