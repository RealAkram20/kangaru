# Notifications

## Purpose

Tells people things they would otherwise have to sit and watch for.

AGENTS.md is unusually prescriptive here, and the restraint is the whole
design: *"Use notifications only when meaningful: Booking Assigned, Trip
Started, Trip Completed, Invoice Ready, Vehicle Maintenance Due, Document
Expiring. Avoid notification fatigue."* A type not on that list needs an
argument, not merely a use case. This module makes adding one cheap so the
decision stays about the list rather than the effort.

This is **pass one**: the delivery spine plus the three notifications the
rest of the codebase actually deferred to it. Everything else on AGENTS.md's
list is unbuilt and named below.

## Responsibilities

- `NotificationType` — the catalogue. Values double as AGENTS.md's
  structured business-event names (`booking.approved`), so one string names
  the notification, the log line and the `notifications.type` column.
- `NotificationChannel` — how a message travels. Two cases: in-app and
  mail.
- `KangaruNotification` — the abstract base. A subclass supplies a
  headline, a sentence, somewhere to go and a structured payload; it gets
  channel selection, the in-app row and the email for free.
- `TenantDatabaseChannel` — writes the in-app row, tenant-scoped.
- `Notification` (model) + `notifications` table — the inbox.
- `SendBookingDecisionNotification`, `SendReportExportReadyNotification` —
  listeners mapping a domain event to a recipient.
- `NotificationController` — a user's own inbox: list, unread count, mark
  one read, mark all read.

## What triggers a notification

| Type | Raised by | Goes to | Channels |
|---|---|---|---|
| `booking.approved` | `Modules\Bookings\Events\BookingApproved` | the requester | in-app + mail |
| `booking.rejected` | `Modules\Bookings\Events\BookingRejected` | the requester | in-app + mail |
| `report.export.ready` | `Modules\Reports\Events\ReportExportCompleted` | the requester | in-app |
| `trip.assigned` | `Modules\Trips\Events\TripStatusChanged` (creation, `from` null) | the booking's requester | in-app + mail |
| `trip.driver_arrived` | `TripStatusChanged` → `driver_arrived` | the booking's requester | in-app + mail |
| `trip.completed` | `TripStatusChanged` → `trip_completed` — the body carries the six data points (Centenary letter) | the booking's requester | in-app + mail |
| `trip.offered` | `DispatchOfferService::ring()` | the offered driver | push + in-app |
| `trip.offer_withdrawn` | `DispatchOfferService::withdraw()` — an accept superseding a wave, or a passenger cancelling | the losing drivers | push, silently |

### The two `trip.offer*` rows are the only ones that reach a handset

`trip.offered` is the one message in the platform that earns an interruption
(ADR-0025 §5): it has a countdown on it and it is the only reason the Driver's
Application is installed. It says how it wants to be delivered through
`pushOptions()` — a MAX-importance Android channel with a ringtone, a `ttl`
equal to the offer's own remaining seconds, and a collapse key.

**The `ttl` is the part worth knowing about.** Expo keeps a message deliverable
long after its subject is gone, so without it a push held while a handset was
in a dead zone arrives later and rings for a job somebody else has been driving
for ten minutes. That is worse than never ringing.

`trip.offer_withdrawn` is **the only silent notification here** and the only one
whose purpose is to *undo* an interruption rather than cause one. It shows
nothing and writes no in-app row: "a job you never answered was withdrawn" is an
inbox entry for a non-event, generated once per cancelled ride. It is also
**allowed to fail** — the guarantee is a deadline the handset arms when it
starts ringing (ADR-0046 §4), and Android will not deliver a data-only push to
an app it has killed at all. This is an accelerator, in the same sense
`dispatch:advance-offers` is an accelerator for an expiry that is really a clock.

The three `trip.*` rows are one class, `TripProgressNotification`, sent by
`SendTripProgressNotification` off `TripStatusChanged` — every other move
(`accepted`, `driver_en_route`, `passenger_onboard`, `waiting`…) is
deliberately silent, because an inbox that narrates every step is an inbox
that gets muted. A walk-in trip has no booking and its rider is told by the
customer flow, so nothing is sent for it. The driver is named by **first name
only**; the plate and make/model identify the car.

Three things each of these deliberately does **not** do:

**The actor is never told what they just did.** An approver has clicked the
button; a dispatcher has the board in front of them. The person who needs
telling is the one who asked and then went back to work. `BookingPolicy`
already decides who may approve; this decides who finds out.

**Cancellation raises nothing.** It is usually the requester's own act, and
notifying somebody of their own click is precisely the fatigue AGENTS.md
warns against.

**A failed export raises nothing.** The failure already appears on the
export list with its reason, and telling someone that a thing they are
watching has failed — while they watch it — adds noise, not information.
That changes the day exports can be *scheduled*, because then nobody is
watching.

## Events, not direct calls

`BookingService` dispatches `BookingApproved`; it does not call a notifier.

The event class lives in `Modules/Bookings` and is dispatched by it, so
Bookings gains no dependency from something reacting to it. Notifications
depends on Bookings, never the reverse — the same direction as
Reports → Billing and Billing → Trips: a leaf depends on a core.

The alternative, a service calling a notifier directly, would have put "who
gets told" inside the class that decides "what happened". They are different
questions that change for different reasons, and the second one is where
AGENTS.md's fatigue rule gets applied.

**Events are dispatched after the transaction commits, never inside it.** A
queued job picked up before the commit lands would read the booking at its
old status, or not find it at all — and a rollback afterwards leaves a
message about a decision that never happened. A notification cannot be
unsent. `BookingServiceTest`-adjacent coverage for this is
"it does not announce a decision that was rolled back".

Listeners are registered explicitly in `AppServiceProvider`, for the same
reason the policies are: Laravel's event discovery scans `app/Listeners` by
convention and would never look under `Modules\`.

## Tenancy

`TenantDatabaseChannel` takes `tenant_id` from **the recipient**, never from
`TenantContext`.

This is the one genuinely dangerous line in the module. Notifications are
queued, and a queue worker never passes through `IdentifyTenant` — so the
ambient tenant when one is delivered is whatever the previous job happened
to leave bound. Reading it would file a notification under another tenant on
a busy worker, which ADR-0001 calls the worst bug this platform can have.
The recipient's own `tenant_id` is the only answer that cannot be wrong.

`notifications` is its own table rather than Laravel's. The framework's is
keyed on a `notifiable` morph and carries no tenant column, and ADR-0001
admits no exception; a notification quoting a passenger's name and a
booking's destination is tenant-owned by any reading.

### A null `tenant_id` means the platform (ADR-0007)

Since ADR-0007 the column is nullable, and null means the recipient is
Shanitah's own staff. It follows `audit_logs`, which has been nullable for
the same reason since ADR-0004 — a change to the platform-wide role
catalogue belongs to no client either.

The channel used to **drop** the row for a recipient with no tenant. That
was correct while nothing addressed them, and ADR-0006 recorded it as a
known consequence to be revisited with the reports decision. Platform staff
can now request exports, so "your export is ready" has somewhere to go, and
discarding it would leave them polling a page for a file that finished ten
minutes earlier.

**Null does not widen anybody's inbox**, and the reason is worth stating
because it is the only place in the codebase where `forActor()` is a
convenience rather than a widening. `scopeFor` narrows on `user_id`
unconditionally and *before* anything else, so dropping the tenant scope for
platform staff lets them read their own rows and nothing more. A Super Admin
who reads across every tenant everywhere else in the platform still cannot
read a colleague's inbox, and `PlatformExportScopeTest` asserts exactly
that.

## Immutability

A notification records what somebody was **told**. Every update is refused
except one touching `read_at` and nothing else
(`NotificationImmutableException`). Re-rendering it later against changed
data would rewrite history: a booking rejected for one reason would, after
an edit, appear to have been rejected for another, and the recipient would
have no way to tell.

Narrower than the Billing models' outright refusal, because read state
genuinely is mutable and belongs on this row — it is per-recipient, and a
separate reads table would be a join for a boolean.

Marking an already-read notification read again is a no-op rather than a
re-stamp: the useful fact is when it was *first* seen, and a client that
re-sends on every render would otherwise keep moving it.

## Delivery timing

`KangaruNotification` implements `ShouldQueue` — AGENTS.md gives nothing
over three seconds the right to block a request, and mail crosses a network.

But `viaConnections()` puts the **in-app row on `sync`**, so it is written
during the request that caused it. Without that, approving a booking left
the approver's own bell unchanged until a worker happened to run, which
reads as the click having failed. That was observed, not theorised: the
first end-to-end run returned `unread: 0` after a successful approval and
only produced the row once `queue:work` was started.

So: **the in-app row needs no worker; email does.**

## Configuration

`config/notifications.php` maps each type to its channels — AGENTS.md
Configuration Driven, because which channel carries which message is an
operational decision and a deployment that wants booking decisions in-app
only should not need a release.

- Omit a type and `NotificationType::defaultChannels()` decides.
- An **empty array is a meaningful answer**: it silences a notification
  without deleting the code that raises it.
- An unrecognised channel name is dropped, and the recognised ones still
  run. `sms` is the live case.

`FRONTEND_URL` (new, `config/app.frontend_url`) is where email action links
point. Distinct from `APP_URL`, which is this API — a relative path is
useless in an email client and `APP_URL` would send the recipient to a JSON
endpoint.

## Dependencies

- `Modules\Bookings` — `Booking` and its two decision events.
- `Modules\Reports` — `ReportExport` and `ReportExportCompleted`.
- `App\Concerns\BelongsToTenant`, `App\Support\Api\ApiResponse`,
  `App\Support\Tenancy\TenantContext`.

Nothing depends on Notifications. Nothing should: modules announce what
happened and this decides who hears it.

## Public APIs

| Method | Path | Authorization |
|---|---|---|
| GET | `/api/v1/notifications` | authenticated; always your own |
| PATCH | `/api/v1/notifications/{id}` | authenticated; 404 if not yours |
| PATCH | `/api/v1/notifications` | authenticated; marks all yours read |

Filters (whitelisted; anything else is a 422): `unread`, `limit`
(default 20, max 100). `meta.unread` travels with the list, because a bell
shows a count and a panel shows the list — that should be one round trip.

**There is no Policy here, and that is deliberate rather than the omission
AGENTS.md fails in review.** A policy answers "may this user act on that
record?", which presumes a query that could return somebody else's. Every
query here is scoped to the authenticated user by `scopeFor` before
authorization would run, so there is no cross-user read for a policy to
forbid. No role reads another person's inbox — not even a tenant admin.

Route-model binding is not used, for the same reason: the lookup is scoped
to the recipient, so another user's id answers **404, not 403**. A 403 would
confirm the notification exists.

## What's explicitly deferred

Everything here is *not built*, not "partly built".

0. **~~A platform account's inbox is empty by fail-closed~~ — done,
   ADR-0007.** Kept in place rather than deleted because the reasoning is
   the record of why it waited: the notification that matters to Shanitah's
   staff is "your export is ready", exports were blocked on the reports
   decision, and opening the read first would have fixed nothing a platform
   user could observe. It moved when reports moved, exactly as written.

   Both halves shipped: `TenantDatabaseChannel` writes the row with a null
   tenant instead of dropping it, and `scopeFor` calls `forActor()` so the
   read is not fail-closed either. See the Tenancy section above.

1. **Mounting the bell, and a nav entry.** The UI is built — see Frontend
   below — but `NotificationBell` is not rendered anywhere yet, because the
   place it belongs (`Topbar.tsx`) is uncommitted work in progress. That
   file already contains a decorative `IconButton icon="bell"` with no
   badge, no panel and no data behind it; replacing that one line with
   `<NotificationBell />` is the whole of the wiring. `SidebarNav.tsx`
   likewise needs one entry pointing at `/notifications`.

   Until then the page is reachable by URL and by "See all notifications"
   in the panel, but nothing advertises it.
2. **SMS.** PROJECT.md lists it; no provider is configured. It is
   deliberately *not* a `NotificationChannel` case — an enum case that
   silently delivers nowhere is worse than its absence, because a
   dispatcher would see "sent by SMS" against a message that never left the
   building. AGENTS.md also requires OTP/SMS endpoints to be aggressively
   rate limited ("SMS pumping fraud is a real cost in East Africa"), which
   is its own pass.
3. **WhatsApp and push.** Explicitly out of Phase 1 per PROJECT.md.
4. **Most of AGENTS.md's own list.** Built: booking decisions. Not built:
   Booking Assigned, Trip Started, Trip Completed, Invoice Ready, Vehicle
   Maintenance Due, Document Expiring. Each is one `NotificationType` case,
   one `KangaruNotification` subclass and one dispatch line where the thing
   happens.
5. **`driver.assigned` specifically is blocked, not merely unbuilt.**
   Drivers have no `user_id` linkage with request-layer support
   (`Modules/Trips` README, deferred item 9), so there is no account to
   notify. Notifying the *requester* that a driver was assigned is
   buildable today and is simply not in this pass.
6. **Per-user preferences.** Channels are configured per type
   platform-wide, not per person. "Email me about X but not Y" needs a
   preferences table and a UI, and AGENTS.md's fatigue rule is currently
   satisfied by sending few things rather than by letting people opt out.
7. **Digesting and rate limiting.** Ten bookings approved in a minute send
   ten emails. Nothing batches or throttles.
8. **Pruning.** `config/notifications.php` carries `retention_days`, and
   nothing reads it. There is no `notifications:prune` command. The key
   exists so the value is settled in one place when the command arrives
   rather than being invented inside it. Unread notifications should never
   be pruned by age — an unread notification is a job somebody has not
   done.
9. **Real-time delivery.** PROJECT.md's stack names Laravel Reverb; the
   inbox is poll-only, and nothing broadcasts. The badge updates when the
   client asks.
10. **Read receipts beyond `read_at`, and archiving/deleting.** A
    notification cannot be dismissed, only read.
11. **The email template's brand link points at `APP_URL`** (the API)
    rather than the SPA, because that comes from Laravel's unpublished
    default mail view. Publishing and branding those views is a design
    pass, not this one. The *action* link is correct.
12. **~~Cross-tenant isolation for Super Admin~~ — done, ADR-0007.** A
    platform user now has an inbox: the row is written with a null tenant
    rather than dropped, and reads go through `forActor()`. The isolation
    that matters here was never the tenant one — it is that `user_id`
    narrows first, so one platform user cannot read another's mail.

## Notes on the tests

Every notification asserted in `NotificationTest` is produced by putting a
real booking through `BookingService`. A `notifications` row written
directly would prove the table exists; it would prove nothing about whether
approving a booking actually tells the person who asked.

### The tenancy guard was verified by removing it

Swapping `$notifiable->tenant_id` for `$this->tenant->get()` in
`TenantDatabaseChannel` turns "it files a notification under the
recipient's tenant, not whatever the worker had bound" red — the row lands
under the wrong tenant.

Worth knowing what did **not** fail: the ordinary isolation test, "it never
delivers one tenant's notification into another tenant", still passed. It
binds the correct tenant before acting, so `TenantContext` and the
recipient agree and the row lands correctly either way. Only a test that
deliberately makes them *disagree* can tell which of the two the channel
reads — which is exactly the worker's situation, and exactly why that
second test exists.

Re-run that check if you touch the channel.

### A bug the tests caught

`via()` used `array_filter` without `array_values`. Dropping an
unrecognised channel from the middle of a configured list left a gappy
array rather than a list — not the shape `array<int, string>` promises, and
it reaches both Laravel and the JSON encoder. "It ignores a channel name it
does not recognise rather than guessing" is the regression test.

## Frontend

- `frontend/src/lib/notifications.ts` — `useNotifications`, the one hook
  both surfaces read. Two implementations of "mark this read" would be two
  chances for the badge and the list to disagree.
- `frontend/src/components/notifications/NotificationBell.tsx` — the badge
  and its panel. Takes no props and fetches its own data, so mounting it is
  literally `<NotificationBell />` wherever the chrome ends up. Polls every
  60s because nothing is pushed (deferred item 9); closes on outside click
  and Escape; the unread count is in the button's accessible name, not only
  in the red dot, so a screen reader user gets "Notifications, 6 unread".
- `frontend/src/pages/NotificationsPage.tsx` — the full inbox at
  `/notifications`. Not polled: someone reading their history is not
  waiting for something to arrive, and a list that reorders under a reader
  is worse than a stale one.

Marking read is **optimistic**. The endpoint is scoped to the caller's own
inbox and cannot refuse, so the only failure mode is the network, and a
badge that lags a click by a round trip reads as broken.

The `body` is rendered as the server sent it, never rebuilt from `context`.
The row records what this person was *told*; re-deriving the sentence later
would risk telling them something else.

### A bug only the running app found

`useNotifications` first shipped with a `busy` ref guarding its fetch
against overlap. Every test passed. In a browser the page sat on
"Loading…" forever.

`main.tsx` wraps the app in `<StrictMode>`, which double-invokes effects in
development: the first run took the flag and started fetching, cleanup
marked that closure cancelled, the second run found the flag still held and
did nothing, and the first fetch resolved into a cancelled closure and was
discarded. Nothing ever set state.

Testing Library does not render in StrictMode by default, which is why the
suite was blind to it. `frontend/src/test/harness.tsx` now wraps every
render in it — verified by reinstating the guard, which turns all 14
notification tests red.
