# ADR-0039: The driver's notification inbox, and the five kinds it does not have

**Status:** accepted
**Date:** 2026-08-15
**Related:** ADR-0007 (the notifications module), ADR-0024 §3 and ADR-0025 §5
(the job offer, and why it is the one interruption), ADR-0033 (documents and
their expiry dates), ADR-0034 (tips and bonuses), ADR-0036 (peak hours)

## Context

The driver app's navigation drawer has a **Notifications** row. Until now it
led nowhere, and the screen behind it was the fourth of five features the
drawer's mockup implied.

Almost nothing had to be built. `Modules/Notifications` has served an inbox
since ADR-0007: `GET /notifications` with the unread count in `meta`,
`PATCH /notifications/{id}` to mark one read, `PATCH /notifications` to mark
them all. All three are already in `ClientScope`'s driver list, all three are
already in `openapi.yaml`, and `NotificationResource` already sends a stable
`type` *"so a client can style or route by kind without matching on the subject
line"*. **The app simply never had a screen.**

What forced a decision was the mockup. It drew five messages:

| The mockup's row | What it would need |
|---|---|
| *New bonus available! Complete 10 more rides and earn UGX 20,000* | ADR-0034's weekly bonus has the figures; nothing notifies |
| *Weekly earnings summary — you earned UGX 85,000 this week* | the ledger has the figures; nothing notifies |
| *Document expiring soon — your driver's licence expires in 15 days* | ADR-0033 stores `expires_at`; nothing watches it |
| *New promotion — peak hour boost is now active* | ADR-0036 has the windows; nothing announces them |
| *KangaruRide update — we updated our safety guidelines* | an office broadcast feature, which does not exist at all |

**`NotificationType` has five cases and not one of them is on that list**:
`booking.approved`, `booking.rejected`, `report.export.ready`,
`order_request.received`, `trip.offered`. Of those, only `trip.offered` is ever
addressed to a driver — the booking pair goes to whoever asked for transport,
the export to the person who ran the report, the walk-in to the dispatch desk.

So the honest inbox for a driver today contains job-offer records and nothing
else.

## Decision

**Build the screen exactly as drawn, over the messages that exist. Fabricate
none of the five.**

`docs/screen-rules.md` §1 forbids a screen showing a value the platform cannot
produce. A notification is that rule at its widest: a fake row is not a wrong
number, it is the office appearing to have said something it never said. A
driver who reads *"your licence expires in 15 days"* and does nothing, because
the app has always been right before, has been harmed by a mockup.

The screen therefore:

1. **Chooses its glyph by `type`, never by the subject's words.** Five types,
   five distinct Lucide shapes, and a bell for anything the handset has not
   seen — the server's enum can gain a case tomorrow and every installed app
   must still draw the row. Matching on words would break on the first
   translated string, which PRODUCT.md's international readiness makes a
   question of when rather than whether.
2. **Carries unread as a dot *and* a heavier subject**, never a background
   tint alone (`docs/screen-rules.md` §6). The list is entirely text and the
   phone is in a cradle in direct sun.
3. **Tints the glyph by tone and never lets the tint be the meaning.** The
   shapes differ as well as the colours (DESIGN.md §3), and the screen-reader
   sentence names the kind in words using the server's own `type_label`.
4. **Pins *Mark all as read* at the foot, and only while something is
   unread** — derived from the list in hand rather than from `meta.unread`,
   which is nullable, because an unloaded count and a count of zero must not
   look the same.
5. **Does not follow `url`.** Those paths are staff-console-local:
   "/bookings/12" means nothing in this app, and a row that navigated nowhere
   would be worse than one that plainly does not navigate.

**This screen is not the bell on the home screen, and the two must not merge.**
The bell counts *job offers*, which have a fifteen-second clock and are the one
message on this platform that earns an interruption (ADR-0025 §5). These are
records that keep. Two badges meaning the same thing would make both mean
nothing.

## What was deliberately not built

**The four missing notification types**, in the order they are worth doing:

1. **`document.expiring`** — the clearest case, and the one AGENTS.md already
   sanctions by name in its notification list. ADR-0033 stores `expires_at`; it
   needs a scheduled command, a notification class, and a decision about how
   many days ahead and how often to repeat. A driver whose licence lapses
   cannot work, and today nothing tells them.
2. **`bonus.available` / the weekly summary** — ADR-0034 §4 pays the bonus only
   after the week closes, so the honest message arrives on Monday, not when the
   target is cleared. Two notifications with one dispatch point.
3. **`peak_hours.active`** — cheap, and the one most likely to become fatigue.
   AGENTS.md's rule is explicit: *"avoid notification fatigue"*. A daily push
   about the same evening window is the definition of it.
4. **An office broadcast.** A compose-and-send screen in the console, a
   recipient selector, and an audit trail. Much the largest of the four, and
   the only one with no data behind it at all.

**Polling.** `useNotifications` does not poll, and that is a decision rather
than an omission: an offer already has its own channel, its own poll and its
own push, and re-asking the inbox on a timer would spend battery to move a dot
whose answer changes a few times a day.

**An optimistic mark-all.** The list empties when the server says it emptied.
An inbox that clears locally and refills on the next refetch has told the
driver something that was not true.

## Consequences

- A driver's inbox is nearly always thin, and the empty state says why: *"Job
  offers arrive on the home screen, not here."* That is the truth about this
  platform today, and it will read as a bug to anyone holding the mockup. The
  fix is item 1 above, not a fixture.
- The drawer's unread dot and this screen share one query and one cache key, so
  marking anything read moves both.
- Nothing in the server changed, so no contract changed, and the API tests that
  already cover this module still cover it.
