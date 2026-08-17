<?php

/*
|--------------------------------------------------------------------------
| Cross-Origin Resource Sharing
|--------------------------------------------------------------------------
|
| Published and pinned deliberately (W1-b). Until this file existed the
| framework default applied, and that default is `allowed_origins => ['*']`
| — every origin on the internet permitted to call this API from a browser.
|
| **What that did and did not mean, stated because over-claiming it is how
| the wrong fix gets chosen.** Every authenticated route is Sanctum bearer
| tokens in an `Authorization` header (ADR-0022), never cookies, so `*` was
| not drive-by session riding: a hostile page has no token to send and the
| browser attaches none for it. What it did permit is any page anywhere
| scripting this platform's **unauthenticated** surface from a visitor's
| browser — the public order endpoints among them — and reading the answers.
| That is a real abuse channel and it is now closed by origin.
|
*/

return [

    /*
     * `api/*` only.
     *
     * `sanctum/csrf-cookie` is in Laravel's default list and is **not** here:
     * the SPA cookie mode it belongs to is unused on this platform, and a
     * CORS entry for a flow nobody runs is a permission granted for no
     * reason. If stateful cookie auth is ever adopted, adding it back is one
     * line — and a deliberate one.
     *
     * `/up` (the health check) is also absent. It is polled by the container
     * runtime and by uptime monitoring, neither of which is a browser and
     * neither of which sends an `Origin`. CORS would not be consulted.
     */
    'paths' => ['api/*'],

    /*
     * The verbs this API actually answers, rather than `*`.
     *
     * `OPTIONS` is required: it is the preflight itself, and omitting it
     * blocks every request that triggers one.
     */
    'allowed_methods' => ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],

    /*
     * Set per environment, never wildcarded.
     *
     * Comma-separated so one variable covers the console and the public site
     * when they are served from different hosts. It falls back to
     * `FRONTEND_URL`, which already exists in `.env.example` and is what
     * local development serves the web app on.
     *
     * **The driver app is unaffected by anything in this file.** React
     * Native's networking is not a browser: it sends no `Origin` and enforces
     * no same-origin policy, so tightening this cannot break the handsets.
     * Restricting CORS is not an access control on the mobile client — that
     * is `EnforceTokenScope` and ADR-0022's per-client abilities, and it is a
     * different mechanism doing a different job.
     */
    'allowed_origins' => array_values(array_filter(array_map(
        'trim',
        explode(',', (string) env('CORS_ALLOWED_ORIGINS', (string) env('FRONTEND_URL', 'http://localhost:5173'))),
    ))),

    'allowed_origins_patterns' => [],

    /*
     * `*` is kept here, and this is the one wildcard worth defending.
     *
     * Request headers are not a disclosure channel — the browser only ever
     * sends what our own code asked it to send — and the alternative is a
     * hand-maintained list (`Authorization`, `Content-Type`, `Accept`,
     * `X-Request-Id`, `X-Requested-With`…) whose failure mode is a preflight
     * rejection that surfaces as an unexplained network error months later.
     */
    'allowed_headers' => ['*'],

    /*
     * **`X-Request-Id` has to be listed to be readable, and this was the
     * quiet defect.**
     *
     * `AssignRequestId` sets it on every response so a report from the field
     * can be traced to one request (AGENTS.md Observability). But a response
     * header is invisible to browser JavaScript unless CORS exposes it, and
     * the framework default is an empty list — so the web app could never
     * read the id the middleware went to the trouble of echoing.
     */
    'exposed_headers' => ['X-Request-Id'],

    /*
     * Cache the preflight for a day. The default is 0, which makes the
     * browser re-ask before effectively every non-simple request — a doubled
     * round trip on a platform whose users are on Ugandan mobile networks.
     */
    'max_age' => 86400,

    /*
     * False, and it must stay false while `allowed_origins` is a list of real
     * origins rather than `*`: credentialed CORS plus a permissive origin is
     * the combination that turns a browser into a confused deputy. Nothing
     * here needs it — the token travels in a header this app sets itself.
     */
    'supports_credentials' => false,

];
