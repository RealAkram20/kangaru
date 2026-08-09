# ADR-0023: The Driver's Application offline outbox

**Status:** Accepted (7 August 2026)

## Context

`docs/driver-app-brief.md` gap 3 states the position plainly: *"No offline
sync endpoint. The API is online-only. The queue, its ordering and its
idempotency are the app's to own; the server will accept replays but does not
deduplicate transitions for you."*

PROJECT.md risk 4 is the same fact from the other end — *"Connectivity gaps
upcountry breaking trip capture"* — and AGENTS.md "Offline resilience" makes
it a standard rather than a nice-to-have: *"capture locally, sync when
connected, and show sync state clearly."*

What has to survive is specific. A driver finishes a delivery in a place with
no coverage, types the closing odometer, photographs the dashboard, and puts
the phone in their pocket. That reading is one of the six data points the
anchor client accepts this platform on (PROJECT.md, Centenary Bank Ref
CRDB/CS/F/26). It has to arrive. It has to arrive **once**.

Three properties of the existing API shape the design, and none of them is
negotiable from this side:

1. **`POST /trips/{trip}/transitions` takes no idempotency key.** The request
   schema is `additionalProperties: false` (`docs/api/openapi.yaml`,
   `TripTransitionRequest`), so there is no field to put one in, and the
   endpoint reads no `Idempotency-Key` header. `IDEMPOTENCY_KEY_REUSED` exists
   in `ErrorCode` but belongs to invoicing.
2. **The server's state machine refuses most replays for us.** No status in
   `TripStatus::allowedTransitions()` has a self-loop, so re-sending a
   transition that already landed answers `409 INVALID_TRIP_TRANSITION`.
3. **Two states break that.** `waiting ⇄ trip_resumed` is a genuine cycle. A
   `waiting` request that landed, whose response was lost, and which is
   replayed *after* the driver has resumed, is legal and will pause the trip a
   second time — silently, with a second row in `trip_events`, which is what
   waiting-time billing is computed from (AGENTS.md Trip State Machine).

So the naive answer — retry until 2xx, treat 409 as "already done" — is
correct for eleven of the thirteen transitions a driver can request and
quietly wrong for the two that matter to an invoice.

## Decision

### 1. A durable outbox in SQLite, not a JSON blob

Queued mutations live in an `expo-sqlite` table, not in AsyncStorage.

AsyncStorage's unit of work is a whole value: enqueueing means read the array,
push, write it back. An app killed between the read and the write loses
everything queued, and the kill happens exactly when it hurts — the OS reclaims
a backgrounded app on a cheap handset, which is the phone this runs on. A
single-row `INSERT` is atomic and a crash lands either side of it, never in the
middle.

The same reasoning rules out keeping the queue in memory with a debounced
persist. A debounce is a window in which the captured odometer does not exist
anywhere.

### 2. The unknown outcome is a durable state, written before the request

Every attempt writes `inflight_at` to the row **before** the network call and
clears it only on a classified response. A row found with `inflight_at` set is
one whose outcome nobody knows: the socket died, or the process did. Those two
are indistinguishable from the client's side and this design refuses to
distinguish them.

That marker is the whole mechanism. Without it, an app killed mid-request
restarts holding an item that looks untried, and re-sends it blind.

### 3. Reconcile before replaying, never replay blind

An item with `inflight_at` set is not sent. It is **reconciled** first:
`GET /trips/{trip}` and compare.

- Server status equals the item's target → the write landed. Mark done. Never
  send.
- Server status equals the item's `expected_from` → nothing landed. Safe to
  send.
- Anything else → the trip moved somewhere this item did not anticipate.
  **Park it** and show the driver. Do not guess.

`expected_from` is recorded when the driver taps, not when the item is sent.
That is what makes the third branch meaningful: it is the difference between
"my write is missing" and "the world moved on".

This is what closes the `waiting ⇄ trip_resumed` hole in §Context item 3. The
replay that would have paused the trip twice is answered by a `GET` that says
the pause is already recorded.

### 4. `409 INVALID_TRIP_TRANSITION` is a question, not an answer

A 409 is reconciled by the same routine. It means one of two very different
things — *my own earlier attempt won*, or *this is genuinely illegal now* — and
the response body cannot tell them apart. The trip's current status can.

Treating every 409 as success would swallow a real conflict. Treating every 409
as failure would strand a driver whose completion had in fact been recorded.

### 5. Strict head-of-line blocking, per trip

Items for one trip are sent one at a time, in enqueue order, and an unresolved
item blocks the ones behind it.

This is the second leg of the guarantee and it is load-bearing. Reconciliation
compares against `expected_from`; if a later item were allowed to overtake a
stalled one, the state it was queued against would no longer be the state the
comparison sees, and the reconciler would park work that was perfectly valid.

Different trips do not block each other — they share no state to be wrong
about.

### 6. Failures are classified by `code`, and the classes have different fates

AGENTS.md: clients branch on `code`, never on message text. The classes:

| Outcome | Fate |
|---|---|
| 2xx | done |
| `INVALID_TRIP_TRANSITION` (409) | reconcile → done or park |
| `AVAILABILITY_ALREADY_ANSWERED` (409) | park — the office has decided |
| `VALIDATION_FAILED` (422) | park — this payload will never become valid |
| `UNAUTHENTICATED` (401) | **pause the whole outbox**, keep the item, do not count the attempt |
| `TOKEN_SCOPE_EXCEEDED` (403) | park, and log loudly — ADR-0022 says raise it, not route around it |
| `FORBIDDEN` / `NOT_A_DRIVER` (403) | park |
| `NOT_FOUND` (404) | park |
| 429 | retry, honouring `Retry-After` |
| 5xx, timeout, no route to host | retry with jittered exponential backoff |

**Parked is not deleted.** A parked item keeps its payload and its error and
appears in the app as something the driver must look at. Silently dropping a
captured odometer reading is the one failure this whole document exists to
prevent, so nothing in it deletes user-entered data.

**401 pauses rather than fails.** The token expires after 24 hours (ADR-0008)
and there is no refresh, so a driver on a long shift *will* meet this. Signing
in again must not be a data-loss event.

### 7. GPS is a second queue with weaker semantics, deliberately

Pings go to their own table and their own sender. They are at-least-once with
no reconciliation, because a duplicate ping is close to free and the ordering
constraints above would cost more than they buy:

- `RouteDistanceCalculator` drops segments below a noise floor, so a duplicated
  point contributes a zero-length segment and no billed distance.
- `TripRouteRecorder::updateLivePosition` keeps the newest ping by
  `recorded_at`, so a replayed batch cannot walk the live marker backwards.

Batches are capped at 500 (the documented server maximum) and deleted only on
`202`. `recorded_at` is the device clock at capture, per the brief — a ping
synced an hour later belongs to the month it was recorded in, which is the
partition and the invoice it belongs to.

The buffer is capped at 20,000 pings — about 55 hours of driving at the
10-second cadence. Beyond that the oldest are dropped **and the drop is
logged and surfaced**, never silent. A cap nobody is told about reads as
complete coverage.

### 8. A leave request reconciles on its content, and this one is a heuristic

`POST /me/availability-requests` has no client-supplied key either, and unlike
a transition it leaves no state machine behind to interrogate. Reconciliation
matches an unanswered request with the same `kind`, `starts_at` and `reason` —
the three things the driver typed.

That is a heuristic and is recorded as one. Two identical requests submitted
deliberately would collapse into one; the failure mode of getting it wrong is a
duplicate row in the office's queue, which a human declines in a second. It is
not the odometer, and it does not deserve the odometer's machinery.

## Consequences

Transitions are **at-least-once on the wire and exactly-once in effect**. The
guarantee rests on two things together, and states plainly what it needs: the
`inflight_at` marker committed before the request (§2), and head-of-line
blocking that stops a later item invalidating an earlier item's
`expected_from` (§5). Remove either and the `waiting ⇄ trip_resumed` cycle
double-applies. Both are mutation-tested in
`mobile/src/offline/outbox.test.ts`.

An odometer reading, once typed, exists in SQLite before any network is
attempted and is removed only by a `2xx` or by the driver acting on a parked
item.

The cost is a `GET` per ambiguous item. That is one request against a trip the
app already shows, on a connection that has just come back, and it buys the
only thing that makes the queue safe to replay.

Deferred, and named rather than implied:

- **A server-side idempotency key on transitions.** It would make §3 and §4
  unnecessary and is strictly better than reconstructing intent from state.
  Raised with the backend; not assumed here, because inventing a field the
  contract does not have is exactly what `AGENTS.md` fails the build over.
- **Background sync while the app is not running.** Expo's background fetch is
  best-effort on both platforms and a driver who has locked their phone in a
  dead zone is not helped by a promise the OS may not keep. The queue drains on
  next foreground, which is honest.
- **Conflict resolution beyond parking.** When a trip has moved somewhere the
  queued item did not expect, the right answer needs a person. The app shows
  the driver what it holds and what the server says; it does not merge.

## Alternatives considered

**Retry until 2xx, treat every 409 as already-done.** The obvious design, and
wrong on `waiting ⇄ trip_resumed` — the two states where a replay is legal
rather than refused. It would corrupt the timeline that waiting-time billing is
computed from, silently, on the platform's most billing-sensitive table.

**A client-generated UUID sent in the transition body.** Refused by the
contract: `TripTransitionRequest` is `additionalProperties: false`, so the field
would 422. Adding it is a backend change and a spec change, and this ADR is not
entitled to make either.

**Hashing the payload into `notes` as a poor man's idempotency key.** Puts
machine data in a field a dispatcher reads, and the server does not index or
compare it. Cheap, dishonest, and does not actually deduplicate.

**Queueing in AsyncStorage.** Rejected in §1 — the write is not atomic across
the kill it has to survive.

**One queue for transitions and GPS.** Rejected in §7. Ordering guarantees
that a captured odometer needs would make GPS pay for a `GET` per batch, and a
stalled ping batch would sit in front of a trip completion.

**Draining the queue optimistically and reconciling afterwards.** Faster on a
good connection, and it inverts the risk: the window where a double-apply is
possible becomes the normal path rather than the exceptional one.
