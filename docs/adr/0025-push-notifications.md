# ADR-0025: Push notifications to the Driver's Application

**Status:** Accepted (9 August 2026)

**Depends on:** ADR-0022 (per-client token scope — a device token is bound to
a client app), ADR-0023 (the offline outbox, whose thesis about dead zones
decides what push is allowed to be), ADR-0024 (the offer, which is the first
message that earns a push).

## Context

`mobile/src/trips/queries.ts` states the problem in a comment on the poll
interval it was forced to add:

> No push notifications in Phase 1, so this poll is the only way a new
> assignment reaches the device.

That was acceptable while a trip was assigned in the morning for work later
that day. ADR-0024 makes dispatch an **offer with a timer on it**, and a
poll interval chosen for battery life is now the floor on how long a
passenger waits for a driver to be told about them. A ten-second offer
window behind a sixty-second poll is not a dispatch system.

`NotificationChannel` has two cases, `database` and `mail`, and its docblock
records the rule that governs this decision: SMS is *not* a case, because no
provider is configured and "an enum case that silently delivers nowhere is
worse than its absence".

## Decision

### 1. `PUSH` is a channel, on the same terms as the others

A third `NotificationChannel` case, resolving to `ExpoPushChannel`, selected
per notification type through `config/notifications.php` exactly as
`database` and `mail` are. Nothing about `KangaruNotification`'s shape
changes: a subclass still supplies a headline, a sentence, a link and a
payload, and gains push by appearing in configuration.

The rule quoted above is honoured rather than waived: this case ships *with*
a working transport, and it is inert — not silently lost — for a user with
no registered device.

### 2. Expo's push service, behind our own channel class

Expo Push, not FCM and APNs directly. The app is Expo (`expo ~57`), Expo's
service fronts both stores with one token format and no credential files to
distribute, and adopting it costs one HTTP call to one endpoint.

It is nonetheless reached through `ExpoPushChannel`, our class, so the
decision is reversible: FCM and APNs directly is a second implementation, and
`device_tokens.provider` already records which kind of token a row holds.
Going direct becomes worthwhile the day the operator wants delivery receipts
or per-device analytics Expo does not surface. Today it would be credential
management bought for nothing.

### 3. Push is best-effort, and never the only path

**No state exists solely inside a notification.** Everything a push says is
independently readable from the API: an offer is at `GET /me/offers`, a trip
is at `GET /trips`, and the poll ADR-0023 relies on stays exactly where it
is. Push shortens the latency; it is not the transport.

This is not defensiveness for its own sake. ADR-0023's entire argument is
that this app runs in Nakasongola dead zones, and a push notification is the
single least reliable delivery mechanism in the building — it crosses two
networks and a vendor, and a driver can switch it off in the operating
system. A dispatch system that only works for drivers who granted a
permission is a dispatch system with a silent, per-driver failure mode.

The corollary is enforced in code: `ExpoPushChannel` never throws into the
caller. A push that fails is logged and dropped, because the alternative is
a failed notification rolling back the transaction that dispatched a ride.

### 4. A device token is per user, per install, and it is revoked with the session

`device_tokens`: user, provider, token, platform, app version, last seen. A
user may hold several — a driver with two handsets is a driver with two
handsets — and the token is registered after sign-in and deleted on sign-out.

`POST /me/devices` and `DELETE /me/devices/{token}` join the ADR-0022
allow-list, which is fail-closed, so they are reachable by the driver app
because somebody added them by name.

**Signing out deletes the token from this device.** A shared handset that
kept its previous driver's token would deliver another person's job offers,
with a pickup address on the lock screen, to whoever is holding the phone.
Every path that revokes a driver's tokens (ADR-0016 §5 — detaching an
account, suspending, deleting) drops their device rows in the same
transaction, for the same reason it drops the bearer tokens.

Expo's own "DeviceNotRegistered" receipt deletes the row too. A token for an
uninstalled app is a row that fails forever otherwise.

### 5. Which types get a push, and the argument for each

AGENTS.md is prescriptive about restraint — "avoid notification fatigue" —
and asks for an argument rather than a use case. Two types get push:

- **`trip.offered`** — a message with a countdown on it, which the recipient
  must act on within seconds, and which is the only reason the app is
  installed. If any message in this platform earns an interruption, it is
  this one.
- **`trip.assigned`** — a trip put on a driver's list by a dispatcher rather
  than by the matcher. Same urgency, different origin.

Nothing else. In particular `booking.approved` and `report.export.ready` stay
in-app: neither is time-critical, and both already reach someone sitting at a
screen.

**A push carries a headline, a sentence and ids — never the passenger's
phone number, and never their name.** A lock screen is readable by whoever
is holding the phone, and ADR-0024 §7 releases the passenger's number only
after the driver has accepted. Sending it in the notification would hand it
out at offer time to anyone who picked the handset up.

## Consequences

The offer window becomes a real window: a driver is interrupted within
seconds and the passenger's wait is bounded by human reaction time rather
than by a poll interval chosen for battery.

**Delivery is now something that can be silently wrong per-driver** — a
denied OS permission, a stale token, an aeroplane mode. §3 is what keeps that
from being a correctness problem, and `device_tokens.last_seen_at` is what
lets somebody notice: a driver on duty with no device row, or a row that has
not been refreshed in a week, is a driver the fleet office should ask about.

**The mobile app now asks for a permission on first sign-in**, which is a
prompt a driver can refuse. The app must work when they do, and does — it
polls, exactly as it does today.

## What this deliberately does not do

**No push to customers.** The customer's ride screen is a browser tab the
person is looking at while they wait; a web push subscription to tell them
about the thing on their screen is ceremony. It becomes worth revisiting if a
customer mobile app ships.

**No SMS.** Unchanged from `NotificationChannel`'s existing note — no
provider is configured. It is the obvious fallback for a driver whose push is
broken, and it stays absent until there is something behind it.

**No rich or actionable notifications.** Accepting a ride from the
notification shade without opening the app is a genuinely better interaction
and it needs the accept to work from a background task with a token it
fetched itself — which is a different threat model than ADR-0022 reasoned
about. The offer screen is one tap away.

## Alternatives considered

**FCM and APNs directly.** Rejected in §2 as credential management bought
for nothing at this stage; the seam is built so it stays available.

**Shortening the poll interval instead.** The change with no new
infrastructure, and it was rejected on arithmetic: a poll fast enough to
serve a ten-second offer window is a poll that runs six times a minute, all
day, on a handset the driver also needs for navigation.

**Websockets to the app.** A persistent connection is worse than push for
exactly this job — it dies with the process, and the process dies when the
phone is in a pocket. It is the right answer for the *dispatcher's* live map,
which is a browser tab someone is watching, and that is not this ADR.