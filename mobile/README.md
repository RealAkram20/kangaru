# KangaruRide Driver App

React Native + Expo. The app a driver carries: accept the trips dispatch
assigns, walk each through its lifecycle, capture odometer readings, stream
GPS, and ask the office for time off — all of it working with no signal.

Built against `docs/api/openapi.yaml`, which is authoritative (AGENTS.md:
*"Mobile apps are built against this contract; drift between code and spec
fails the build"*). Nothing here invents an endpoint. What the app needs and
the API does not yet offer is in **Raised with the backend** below.

---

## Purpose

PROJECT.md Phase 2. Seven screens, one job: make sure every completed trip
carries the six data points the anchor client accepts this platform on, and
that none of them is lost because a driver was in a dead zone in Nakasongola.

> **Scope note.** PROJECT.md currently lists "Driver mobile app" under *Phase 1
> — explicitly OUT of scope*, with drivers on a mobile-responsive web flow.
> Building this moves that item, and PROJECT.md says such a move "requires an
> owner-approved scope change, not a hallway agreement". The scope change is
> the owner's to record; this README is not it.

## Responsibilities

- Sign a driver in with `client: "driver"` and keep them signed in.
- Show today's work, in-progress trip pinned.
- Render lifecycle actions **from the server's `allowed_transitions`**.
- Capture the opening and closing odometer, each with an optional photo.
- Stream GPS while a trip is live, batched and durable.
- Raise, list and withdraw time-off requests.
- Change the admin-issued password (ADR-0016 provides no self-service reset).
- Hold everything the driver does until there is a connection, and lose none of
  it.

## Dependencies

The nineteen route names in `App\Support\Auth\ClientScope::routesFor('driver')`
and nothing else. A driver token gets `403 TOKEN_SCOPE_EXCEEDED` on anything
outside them (ADR-0022), and the list is fail-closed, so endpoints added later
start shut.

---

## Architecture

### Navigation

Three tabs, because a driver has three jobs. Deeper structure would be
navigation for its own sake.

```
Work ─────── Today (trip list)
        └── Pickup               ← accepted, driver_en_route
        └── Waiting for passenger ← driver_arrived
        └── Trip in progress     ← trip_started, waiting, trip_resumed
        └── Trip detail          ← the record, and every terminal state
        └── Odometer             ← modal; owns passenger_onboard
Time off
Account ──── session, sync state, and the parked queue
        └── Change password
```

**One trip status belongs to exactly one screen**, and the live leg is split
across three of them rather than folded into Trip detail. The reason is that
they answer different questions at different moments: *Pickup* answers "where
is it and how far" while driving, *Waiting for passenger* answers "how long
have I been standing here", *Trip in progress* answers "how far still, and how
long so far", and *Trip detail* is the record — odometer, timeline, every
legal transition — read at a standstill. Folding them together would give the
busiest moments in the app the layout of an audit trail.

Trip in progress is also where a journey is **held and picked up again**.
Pausing is billable — `WalkInFareService::settle()` prices a `WAITING` line
from the periods those transitions open and close — so the screen says how
long the trip has been held and that the time is priced, and shows no money
figure of its own, because the rate card's free allowance is in no payload.
While a trip is held, **End trip is withdrawn**: `TripStatus::WAITING` allows
only `TRIP_RESUMED`, and offering completion there would 422 through the
outbox minutes after the driver walked away.

Two of those live screens draw a distance and neither draws a duration to go.
There is no routing engine here, and ADR-0020 §3 declined to derive minutes
from a straight line by name — so every distance says "straight line" on the
screen in words, and the driver's own maps app answers the part this platform
cannot (`src/trips/directions.ts`).

`isPickupPhase`, `isWaitingForPassenger` and `isTripInProgress` in
`src/trips/transitions.ts` implement the split and are defined next to each
other so none can quietly claim another's status. `docs/agent-worklog.md` holds the same map in one
table, because more than one agent builds these screens at once.

Odometer capture is a **modal**, not a step inside the detail screen: it is a
form completed or abandoned as a unit, and backing out must leave the trip
exactly as it was. The password form is a pushed screen rather than a modal for
the opposite reason — it is a thing a driver may reasonably start, go and check
with the office, and come back to.

**Changing the password is the one write that does not go through the outbox.**
It re-authenticates with the current password, and `PATCH /auth/password`
revokes every token including the caller's — so a queued credential change would
sign a driver out mid-shift for a reason they no longer remember. It needs a
connection and says so, and on success it signs out locally rather than making
one more request it knows will 401.

### State, and where each kind lives

| What | Where | Why |
|---|---|---|
| Bearer token | `expo-secure-store` (Keychain / Keystore) | ADR-0022's threat model is a credential at rest on a lost handset. Keystore is excluded from device backups; AsyncStorage is not. |
| Things the office said (trips, leave) | React Query, persisted to AsyncStorage | Losing it costs one refresh. Persisted so the morning's work renders at launch in a dead zone. |
| Things the driver did | **SQLite outbox** | Losing one loses a contractual data point. See ADR-0023. |
| GPS pings | SQLite, separate table and sender | At-least-once, no reconciliation needed. Different semantics, so a different queue. |
| The token, module-scope | `src/auth/currentToken.ts` | One token belongs to the process, not to a component. Read at request time so an in-flight call uses the live token. |

Every read is `networkMode: 'offlineFirst'`. React Query's default *pauses* a
query when the device reports no connection, which on a handset that flickers
in and out of coverage is a blank screen where the last known answer should be.

### The offline queue

**ADR-0023** is the full argument. The short version:

Transitions are **at-least-once on the wire, exactly-once in effect**, and the
guarantee rests on two things that only work together:

1. **`inflight_at` is committed before the request goes out.** An app killed
   mid-request restarts holding a row that says *outcome unknown* — which is
   the truth — instead of one that says *untried*.
2. **An unknown outcome is reconciled, never replayed.** `GET /trips/{id}`, then
   compare: at the target means it landed; at the `expected_from` recorded when
   the driver tapped means it did not; anything else needs a person, so the item
   is **parked** with its payload intact and shown on the Account screen.

Plus **head-of-line blocking per trip**, which is not an optimisation: an item
behind a stalled one must not overtake it, or the stalled item's `expected_from`
would no longer describe the state the reconciler sees.

Why the machinery, when the server's state machine refuses most replays with a
409? Because of `waiting ⇄ trip_resumed`. It is the lifecycle's only cycle, so
it is the one place a replay is *accepted* rather than refused — silently
pausing the trip a second time and writing a second row into `trip_events`,
which is what waiting-time billing is computed from.

Failures are classified by `code`, never by message text. **Nothing is ever
deleted because a request failed.**

### GPS

Streams only between `trip_started` and `trip_completed`, and the narrow window
is deliberate. `RouteDistanceCalculator` sums every ping on a trip with no time
bound, and `TripStateMachine::reconcileAgainstGps` compares that total against
`odometer_end - odometer_start`, which excludes the drive to the pickup.
Streaming while en route would add kilometres to one side of that comparison and
raise a variance flag on a trip where the driver did nothing wrong — and
PROJECT.md commits to reviewing those flags within two business days, so a flag
that fires on every long pickup is a flag that gets ignored.

Started by `GpsController`, mounted once in the authenticated shell and driven
by the trip list — **not** by the trip-detail screen. A driver who force-quits
mid-trip and reopens the app on another tab must still be recording.

Coordinates travel as `{lat, lng}` in named fields the whole way. `toPingBody`
is the single place they become `latitude`/`longitude`, and it is one line under
test: Uganda at ~0.3°N, ~32.6°E means a swap passes every range check and lands
the vehicle off the coast of Ghana.

### Polling, and what it costs

There are no push notifications in Phase 1, so the trip list polls every **60
seconds, foreground only**. Roughly 60 small requests an hour; the radio wake is
the cost, not the bytes, and at that interval it coincides with traffic the
handset is generating anyway. Ten seconds would roughly quadruple it for a
signal that changes a few times a shift. Nothing polls in the background — an
app that drains battery for an assignment nobody is looking at gets force-stopped,
after which it receives nothing at all.

---

## Testing

```bash
npm test          # jest
npm run typecheck # tsc --noEmit, strict + noUncheckedIndexedAccess
npm run lint      # eslint, flat config
```

61 tests, plus 8 on the backend seeder. They sit almost entirely on pure logic over injected ports, which is
what makes them worth trusting — the outbox processor talks to an
`OutboxTransport` interface and an `OutboxStore` interface, so "the app was
killed mid-request" is a test rather than a manual procedure.

**Every guard in this app has been mutated and confirmed to fail its test.**
AGENTS.md: *"a test that still passes with the logic deleted is a false green"*.
The mutations run and killed:

| Mutation | Test that caught it |
|---|---|
| `markInflight` moved after the send | app-killed-mid-request (7 tests) |
| Head-of-line blocking removed | holds later items behind an unresolved one |
| 409 always parks / always completes | the two `INVALID_TRIP_TRANSITION` tests |
| 5xx treated as a clean failure | treats a 5xx as an unknown outcome |
| Re-entrancy guard removed | refuses to run two drains at once |
| Backoff jitter removed | spreads retries across a window |
| Driver-actionable filter removed | drops transitions forbidden to a driver |
| GPS window widened to `driver_en_route` | does not stream before the opening odometer |
| Odometer requirement dropped | demands an opening reading to start |
| Photo abandonment removed | sends the number alone after repeated failures |
| `lat`/`lng` swapped | puts latitude in latitude |
| Password min-length / confirmation / different-from-current | the three `passwordProblem` tests |
| Trip grouping / sort direction | four ordering tests |
| `streamingTripId` falls back to first trip | streams for nothing when no trip is live |

One of those mutations found a **false green in the test suite itself**:
`(await store.pending())[0]?.inflightAt` is `undefined` when the row was parked
instead of deferred, and `expect(undefined).not.toBeNull()` passes. The helper
`onlyPendingItem` now asserts the row exists first.

### Not covered, and why

- **No screen-render tests.** The screens are thin: every decision they make is
  in `transitions.ts`, `ordering.ts` or the outbox, all directly tested. Render
  tests here would mostly assert that React Navigation works.
- **`SqliteOutboxStore` is not exercised against real SQLite.** The processor's
  logic is tested against `MemoryOutboxStore` through the same interface; what
  is untested is that SQLite persists, which is SQLite's job. A device test
  against a real database is the honest next step and is not done.
- **Nothing has been run on a device or simulator.** No Expo build, no emulator,
  no live backend. `npm test`, `tsc` and `eslint` pass; that is the whole of
  what has been verified.

---

## Running a first test

### 1. A backend the phone can reach

```bash
cd backend
php artisan serve --host=0.0.0.0 --port=8000
```

`--host=0.0.0.0` matters for a physical handset — the default binds to
localhost and the phone gets nothing. Find the machine's LAN address
(`ipconfig`) and check `http://<address>:8000/api/v1/public/settings` loads on
the phone's browser before blaming the app.

### 2. A driver who can sign in

`migrate:fresh --seed` gives you fourteen driver *profiles* and no driver
*account* — ADR-0016 made those two different things. So:

```bash
php artisan db:seed --class=DriverAppSeeder
```

It prints the credentials and where the live trip currently is. It is
re-runnable, restores the password after you have tested changing it, and
refuses to run outside `local`/`testing`/`staging`.

| | |
|---|---|
| Email | `driver@kangaruride.test` |
| Password | `driver-demo-password` |
| Starts with | one `assigned` trip, two completed ones |

### 3. The app

```bash
cd mobile
npm install
EXPO_PUBLIC_API_BASE_URL=http://192.168.1.20:8000/api/v1 npx expo start
```

Substitute your own LAN address. Without the variable it defaults to
`http://10.0.2.2:8000/api/v1`, which is the **Android emulator's** route to the
host and is wrong on a real phone.

Use a physical device. GPS and the camera are the two things most worth testing
and the two an emulator fakes worst.

### 4. What to test, in this order

1. **Sign in.** Confirms the token and its scope.
2. **Accept the trip, then walk it to Driver Arrived.** Confirms actions are
   rendered from `allowed_transitions` — note there is no Cancel button, which
   is the point: the server lists `cancelled` as legal from `assigned` and the
   policy forbids it to a driver.
3. **Aeroplane mode. Board, start the trip, enter an odometer reading, take a
   photo. Force-quit the app. Reopen it. Turn the signal back on.** This is the
   acceptance test for the entire offline design (ADR-0023) and no unit test
   substitutes for it. The reading must arrive, exactly once.
4. **Drive 2 km with the trip live, then complete it.** Check the console: the
   trip should carry both readings, a `gps_distance_km` close to the odometer
   span, and no variance flag.
5. **Change the password** from Account. Every device signs out, including this
   one. Re-run the seeder to get the documented password back.

### Verified against the running backend

These are the app's load-bearing assumptions, checked against a live API rather
than reasoned about:

| Assumption | Result |
|---|---|
| `client: "driver"` mints a working token | 200, `mfa_enabled: false` — one-step login |
| The token cannot reach the console | `GET /users` → **403 `TOKEN_SCOPE_EXCEEDED`** |
| `/trips` is server-scoped to this driver | 3 trips, all theirs |
| `allowed_transitions` includes actions a driver may not take | `assigned` → `["accepted","rejected","cancelled"]`, and posting `cancelled` → **403 `FORBIDDEN`** |
| A replayed transition is refused | second `accepted` → **409 `INVALID_TRIP_TRANSITION`** — ADR-0023's premise |
| A wrong current password is distinguishable | **422 `INVALID_CREDENTIALS`**, not `VALIDATION_FAILED` |
| Changing the password kills the caller's token | next request → **401** |

Accounts are issued by an administrator (ADR-0016). There is no sign-up and no
password reset, by design, and the sign-in screen says so rather than offering a
dead link.

---

## Raised with the backend

Per the brief: flag, do not invent. None of these is worked around in a way that
hides it.

1. **`allowed_transitions` is state-legality, not permission — so it cannot be
   rendered verbatim.** `TripResource` says as much in its own comment. From
   `assigned` the server legally allows `cancelled`, and `TripPolicy` refuses it
   to a driver, so a button rendered straight from the field can only produce a
   403. The app filters against `DRIVER_ACTIONABLE_STATUSES`, a flat list
   mirroring `TripPolicy::DRIVER_JOURNEY_STATES` — no edges, so nothing to
   drift, and the server stays the authority. **Ask:** an
   `allowed_transitions_for_me` field on `TripResource`, computed from the
   policy. Additive, so permitted within v1.

2. **A trip carries no scheduled time, so "soonest first" is unbuildable.**
   `TripResource` exposes `booking_id` but no `scheduled_for`; `/trips` supports
   no `?include=booking` and no sort parameter, and orders `created_at desc`.
   The app groups (in progress → upcoming → finished) and sorts `created_at`
   *ascending* within each group as a proxy, documented as one in
   `src/trips/ordering.ts`. It breaks the moment a dispatcher assigns tomorrow
   morning's booking before this afternoon's. **Ask:** `scheduled_for` on
   `TripResource`.

3. **No idempotency key on `POST /trips/{trip}/transitions`.**
   `TripTransitionRequest` is `additionalProperties: false`, so there is no
   field for one and no `Idempotency-Key` header is read. Worked around by
   reconstructing intent from trip state (ADR-0023 §3–4), which costs a `GET`
   per ambiguous item and cannot be as good as the server saying so. **Ask:** an
   `Idempotency-Key` header, as `Modules/Billing` already does for invoices.

4. **No driver-facing notification type.** `Notification.type` is
   `booking.approved | booking.rejected | report.export.ready`. There is nothing
   for "you have been assigned a trip", so `notifications.index` — one of the
   nineteen scoped routes — returns an empty inbox for every driver, and polling
   `/trips` is the only assignment signal. The app does not render an inbox at
   all rather than shipping a screen that is always empty. **Ask:** a
   `trip.assigned` notification type.

5. **No push notifications** (brief gap 2, PROJECT.md Phase 1). Polling is the
   consequence; the interval and its battery cost are in `src/config.ts`.

6. **No offline sync endpoint** (brief gap 3). Owned entirely by ADR-0023, as
   the brief says it must be.

Not a gap, recorded so nobody re-derives it: **`POST /me/availability-requests`
is throttled to 10/minute.** The outbox honours `Retry-After` on a 429 rather
than backing off on its own schedule.

---

## Public APIs

| Module | Exports |
|---|---|
| `src/api` | `ApiClient`, the endpoint functions, `ApiError` / `NetworkError`, wire types |
| `src/auth` | `AuthProvider`, `useAuth`, `currentToken`, `sessionEvents`, `passwordRules` |
| `src/offline` | `OutboxProcessor`, `OutboxStore` + two implementations, `SyncProvider`, `useSync` |
| `src/trips` | `driverActions`, `shouldStreamGps`, `streamingTripId`, `orderTripsForToday`, query hooks |
| `src/location` | `GpsStreamer`, `GpsPingBuffer`, `GpsController`, `toPingBody` |
| `src/ui` | `Button`, `Card`, `Field`, `StatusPill`, `Notice`, `Screen`, `Empty`, `SyncBanner` |

## Related decisions

- **ADR-0023** — this app's offline outbox
- ADR-0022 — token scope per client app
- ADR-0017 — resource availability, §6 for the driver's own requests
- ADR-0016 — driver sign-in accounts
- ADR-0008 — 24-hour tokens, and why 401 pauses rather than fails
- ADR-0003 — GPS ingestion, and why `POST /locations` answers 202
