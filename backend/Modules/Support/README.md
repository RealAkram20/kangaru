# Support

Driver issue reporting (ADR-0044). A driver writes a report; a person at the
office answers it; the driver is told.

## Why this is its own module

It is a **two-actor feature**, not a fact about a driver's record. `Modules\Drivers`
owns what the office knows about a driver — their licence, their papers, their
money. This owns a conversation between them, and the office half of it is a
queue rather than a profile.

## The one rule that shapes everything here

**There is no way to close a report without answering it.** `SupportRequestStatus`
has two cases and no third; there is no `close` endpoint and no button for one in
the console. An office that can dismiss a driver's account of a passenger who
threatened them, in silence, reproduces the exact failure this feature was built
to end.

The cost is real and accepted: a spam report must also be answered, in one line.
That is cheaper than a queue drivers learn to distrust.

## Shape

| Actor | Route | Notes |
|---|---|---|
| Driver | `GET  me/support-requests` | Their own, newest first, capped at 50 |
| Driver | `POST me/support-requests` | Topic + body, optional `trip_id` |
| Office | `GET  support-requests` | **Oldest first**, unanswered by default |
| Office | `GET  support-requests/{id}` | With the driver's name and the answer |
| Office | `POST support-requests/{id}/answer` | Writes the reply **and notifies** |

Both `/me` routes are on `ClientScope`'s driver allow-list. That list fails
closed and **no ordinary test can see an omission** — every backend test mints an
unscoped console token — so `SupportRequestTest` asserts the two names directly.

## What answering does

`SupportRequestService::answer()` writes the reply, moves the status and sends
`SupportRequestAnsweredNotification` (database + push, never mail). The three
must not come apart, which is why they are one service call and not a controller
body. It is **idempotent**: a report already answered comes back unchanged, so a
double-tap cannot overwrite a colleague's reply or send a second push.

The notification carries the topic, not the answer. A reply is somebody's
account of a dispute and a lock screen is read over a shoulder.

## What is deliberately absent

No attachments, no threading, no SLA, no assignment, no reopening — ADR-0044 §5
says why for each. `SupportRequestPolicy` records why `drivers.manage` gates the
office half and where the seam is when a Support role separates from Fleet.
