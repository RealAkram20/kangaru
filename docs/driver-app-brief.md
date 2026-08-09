# Brief: KangaruRide Driver App (React Native + Expo)

Hand this to the agent starting the mobile app. Everything below was read
out of the running backend on 7 August 2026, not recalled — but verify
anything load-bearing against `docs/api/openapi.yaml` before building on it.

---

## The prompt

> Build the **KangaruRide Driver App**: a React Native + Expo application for
> the drivers of a Ugandan enterprise transport platform. Drivers use it to
> accept the trips dispatch assigns them, walk each trip through its
> lifecycle, capture odometer readings with a dashboard photo, and stream GPS
> while driving.
>
> The backend already exists and is not yours to change without saying so.
> It is a Laravel 12 API at `/api/v1`, documented in `docs/api/openapi.yaml`,
> and **that contract is authoritative** — the repository's `AGENTS.md`
> states mobile apps are built against it and CI fails the build on drift. If
> you need an endpoint that is not in the spec, say so explicitly rather than
> inventing a shape; several genuinely do not exist yet and are listed at the
> end of this brief.
>
> Read `AGENTS.md` and `PROJECT.md` at the repository root before writing
> code. They are short and they are the standards this platform is held to.
>
> ### What the app must do
>
> 1. **Sign in** as a driver and stay signed in across app restarts. Send
>    `client: "driver"` in the login body — see "Token scope" below; it is one
>    field and it is not optional for this app.
> 2. **Show today's work** — the trips assigned to this driver, soonest
>    first, with the one in progress pinned.
> 3. **Walk a trip through its lifecycle**, rendering only the transitions
>    the server says are currently legal.
> 4. **Capture odometer readings** at trip start and trip completion, each
>    with an optional dashboard photo.
> 5. **Stream GPS** while a trip is live, batching pings and surviving dead
>    zones.
> 6. **Work offline.** Upcountry Uganda has real coverage gaps, and the
>    backend is online-only today, so the app owns this entirely.
>
> ### Non-negotiables
>
> - **Never hardcode the trip state machine.** Every trip carries
>   `allowed_transitions`; render buttons from it. The server rejects
>   anything else with `409 INVALID_TRIP_TRANSITION`, and a client with its
>   own copy of the graph will drift from it.
> - **Branch on `code`, never on message text.** Every failure is
>   `{success: false, code, message, errors}` with a stable machine-readable
>   `code`. Messages are written for humans and will be reworded.
> - **Latitude and longitude are not interchangeable.** Uganda sits at
>   ~0.3°N, ~32.6°E — a swapped pair passes every range check and lands off
>   the coast of Ghana. The backend has been bitten by this twice; carry
>   coordinates in named fields (`{lat, lng}`), never as positional arrays,
>   right up to the request body.
> - **The odometer reading is the product.** The anchor client's contract
>   accepts this platform on six per-trip data points, two of which are the
>   opening and closing odometer. A trip that completes without a reading is
>   a failed delivery of the thing being bought. The photo is *optional* by
>   deliberate server-side decision — a camera that will not focus in the
>   dark must not be able to strand a driver — but the number is required.
> - **Your token can only reach the driver surface.** Logging in with
>   `client: "driver"` mints a token scoped to a fixed allow-list of routes
>   (ADR-0022). Anything outside it answers `403 TOKEN_SCOPE_EXCEEDED` no
>   matter how senior the person holding the phone. If you hit that code you
>   have found an endpoint the app legitimately needs and nobody listed —
>   that is a conversation, not a workaround.
> - **Offline capture must be lossless and idempotent.** A driver in a dead
>   zone completes a trip; that transition and its odometer reading must
>   survive an app kill and sync exactly once. Design the queue for
>   at-least-once delivery with client-side idempotency, and say how you
>   guarantee it.
>
> ### Deliverables for this first pass
>
> Propose the architecture before building: navigation shape, state and
> offline-queue strategy, and how you will test. Then build sign-in, the trip
> list, the trip detail with lifecycle actions, odometer capture, and the GPS
> streamer. Ship tests for the offline queue and the transition logic — those
> are where the money is.

---

## API facts (verified against the running backend)

**Base URL** `/api/v1`. Auth is Laravel Sanctum bearer tokens.
**Tokens expire after 24 hours** (ADR-0008) — handle `401` by re-authenticating,
not by looping.

### Auth

| Endpoint | Notes |
|---|---|
| `POST /auth/login` | `{email, password, client: "driver"}` → `{data: {user, token}}` |
| `GET /auth/me` | the signed-in user |
| `POST /auth/logout` | revokes the current token |
| `PATCH /auth/password` | **revokes every token including the caller's** — force a re-login after success |

### Token scope (ADR-0022)

Send `client: "driver"` at login. The token you get back may reach exactly
these routes and nothing else — everything else is `403
TOKEN_SCOPE_EXCEEDED`:

`auth.me` · `auth.logout` · `auth.password.change` · `trips.index` ·
`trips.show` · `trips.events.index` · `trips.transitions.store` ·
`trips.odometer-photo.show` · `trips.locations.store` ·
`trips.locations.index` · `me.availability-requests.{index,store,destroy}` ·
`zones.index` · `zones.resolve` · `notifications.{index,read,read-all}` ·
`live-positions.index`

The list is **fail-closed**: every endpoint added to the API in future is
shut to this app until somebody puts it on the list deliberately. Omitting
`client` gives you an unscoped console token, which works — and is the wrong
thing to ship, because the whole point is that a phone lost in a taxi cannot
be used to browse the staff console.

**Drivers do not use MFA.** It is required only for Super Admin and Finance
(PROJECT.md Phase 1). A driver's login is a one-step exchange.

A driver signs in with a normal `User` account whose role is `driver`,
linked to their `Driver` profile (ADR-0016). The account is issued by an
administrator — **there is no self-service driver sign-up and there will not
be one.** There is also no "reset another person's password" endpoint, by
design; a driver who forgets theirs gets a new one issued.

### Trips

| Endpoint | Notes |
|---|---|
| `GET /trips` | already scoped: a driver sees only trips assigned to them |
| `GET /trips/{trip}` | one trip |
| `POST /trips/{trip}/transitions` | the lifecycle action — see below |
| `GET /trips/{trip}/events` | the append-only timeline |
| `GET /trips/{trip}/odometer-photo/{start\|end}` | streamed behind auth, not a public URL |

**Transition payload** (`multipart/form-data` when a photo is attached):

```
to                              required, the target status
notes                           required for rejection/cancellation, else optional
odometer_start                  required when to = trip_started
odometer_end                    required when to = trip_completed
odometer_photo                  optional; jpeg/jpg/png/webp/heic, max 10 MB
cancellation_charge_applicable  optional boolean
```

`odometer_end` must be ≥ `odometer_start`; the server 422s otherwise.
`to = invoice_generated` is refused for everyone — billing writes it.

**The lifecycle** (server-enforced; read it from `allowed_transitions`):

```
assigned → accepted | rejected | cancelled
accepted → driver_en_route | cancelled
driver_en_route → driver_arrived | cancelled
driver_arrived → passenger_onboard | no_show | cancelled
passenger_onboard → trip_started
trip_started → waiting | trip_completed
waiting → trip_resumed
trip_resumed → waiting | trip_completed
trip_completed → (billing takes over)
```

### GPS

`POST /trips/{trip}/locations` → **202 Accepted**, not 201. The pings are
validated and buffered; nothing is written yet.

```json
{"pings": [
  {"latitude": 0.3476, "longitude": 32.5825,
   "recorded_at": "2026-08-07T08:00:00Z",
   "speed_kph": 38.5, "heading_degrees": 120, "accuracy_metres": 8}
]}
```

Up to **500 pings per request**. The target cadence is **one ping per 10
seconds** per active vehicle. `recorded_at` is the **device's** clock and is
what the platform reports freshness against — send when it was captured, not
when it was uploaded. A batch replayed after a tunnel is expected and
handled: the server keeps the newest position and will not walk a marker
backwards.

### Zones

`GET /zones` and `GET /zones/resolve?latitude=&longitude=` are readable by
drivers (ADR-0021). Useful if you want to show the service area.

Since the billing half of ADR-0021 landed, a zone can also decide what a
trip costs — but **that is not the driver app's business and it must not
show a price**. Zone rates live on a rate card the driver cannot read, and a
figure derived from `zones/resolve` would be a guess at what a client is
billed. Show where the vehicle is; leave what it costs to the invoice.

### Error codes worth handling

`INVALID_TRIP_TRANSITION` (409) · `VEHICLE_UNAVAILABLE` · `DRIVER_UNAVAILABLE`
· `VALIDATION_FAILED` (422) · `UNAUTHENTICATED` (401) · `FORBIDDEN` (403) ·
`TOKEN_SCOPE_EXCEEDED` (403, ADR-0022 — the app asked for something outside
the driver surface; do not retry) · `NOT_A_DRIVER` (403 — this account has no
driver profile; a support question, not a bug) ·
`AVAILABILITY_ALREADY_ANSWERED` (409)

---

## Gaps the app will hit — flag, do not invent

1. ~~A driver cannot request leave through the API.~~ **Shipped 7 August
   2026** (ADR-0017 §6, completed). `GET/POST/DELETE
   /me/availability-requests`. The create takes **no** `resource_id` and
   **no** `status` — both are pinned to the caller and to `requested` by the
   server, so there is nothing for the app to send and nothing to get wrong.
   `DELETE` withdraws only while unanswered (`409
   AVAILABILITY_ALREADY_ANSWERED` after). An account with no driver profile
   behind it gets `403 NOT_A_DRIVER`.

2. **No push notifications.** PROJECT.md puts them out of Phase 1. A new
   assignment will not reach the device unless the app polls. Decide the
   polling interval deliberately and say what it costs in battery.

3. **No offline sync endpoint.** The API is online-only (`Modules/Trips`
   deferred item 7). The queue, its ordering and its idempotency are the
   app's to own; the server will accept replays but does not deduplicate
   transitions for you.

4. ~~Token abilities are not yet scoped per client app.~~ **Shipped 7 August
   2026** (ADR-0022). See "Token scope" above — this is now a thing the app
   must comply with rather than a thing to ask for.

5. **No live map for drivers.** `GET /live-positions` exists but is scoped
   to trips the caller can see — a driver sees only their own vehicle.

---

## Raised back by the app (7 August 2026)

Found while building `mobile/`. Each is flagged rather than worked around
invisibly; `mobile/README.md` says what the app does in the meantime and why.

6. **`allowed_transitions` cannot be rendered verbatim, because it is
   state-legality and not permission.** `TripResource` says so itself. From
   `assigned` the server allows `cancelled`, `TripPolicy` refuses it to a
   driver, and a button built straight from the field can only produce a 403.
   The app filters against a flat mirror of
   `TripPolicy::DRIVER_JOURNEY_STATES` — a list of statuses, not a graph, so
   there are no edges to drift. **Ask:** an `allowed_transitions_for_me` field
   computed from the policy. Additive, so allowed within v1.

7. **A trip carries no scheduled time**, so "today's work, soonest first" —
   requirement 2 of this brief — is not buildable as written.
   `TripResource` exposes `booking_id` but no `scheduled_for`, `/trips` has no
   `?include=booking` and no sort parameter, and `TripController::index`
   orders `created_at desc`. The app sorts `created_at` *ascending* within
   status groups as a proxy and documents it as one. **Ask:** `scheduled_for`
   on `TripResource`.

8. **No idempotency key on `POST /trips/{trip}/transitions`.**
   `TripTransitionRequest` is `additionalProperties: false` and no
   `Idempotency-Key` header is read, so the app reconstructs intent from trip
   state instead (ADR-0023). That works — the state machine has no self-loops,
   so a replay 409s — *except* on `waiting ⇄ trip_resumed`, the one legal
   cycle, where a replay is accepted and writes a second `trip_events` row into
   the table waiting-time billing is computed from. **Ask:** an
   `Idempotency-Key` header, as `Modules/Billing` already accepts for invoices.

9. **No driver-facing notification type.** `Notification.type` is
   `booking.approved | booking.rejected | report.export.ready`. Nothing means
   "you have been assigned a trip", so `notifications.index` — one of the
   nineteen scoped routes — is an empty inbox for every driver. The app ships
   no inbox screen rather than one that is always empty. **Ask:** a
   `trip.assigned` type.

---

## Repository conventions the mobile app should inherit

- **Comments explain decisions, not mechanics.** This codebase documents
  *why* a rule exists and what happens without it. Match that.
- **Money is integer minor units.** UGX is zero-decimal. Never floats.
- **Everything is tested, and tests must bite.** A test that passes with the
  logic deleted is a false green — mutate new guard logic and confirm the
  test fails.
- **An ADR for every architectural decision**, in `docs/adr/`, with Context,
  Decision, Consequences and Alternatives. The offline queue design deserves
  one.
