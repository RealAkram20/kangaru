# ADR-0052: Telling a driver what the office decided about their documents

**Status:** Accepted — 21 August 2026

**Amends:** ADR-0033 §6, specifically the paragraph headed **"No
notification."** That paragraph is withdrawn. Everything else ADR-0033
decided stands, and §2 below is mostly an argument that its most important
rule — nothing is auto-verified, ever — survives this change untouched.

**Depends on:** ADR-0004 (permissions), ADR-0007 (the notifications module),
ADR-0025 (push), ADR-0033 (driver documents), ADR-0039 (the driver's inbox),
ADR-0048 (onboarding documents).

## Context

ADR-0033 §6 refused this, and it gave a good reason:

> A driver learns their document was verified or rejected by opening the app.
> The push channel exists (ADR-0025) and this is a fair candidate for it, but
> adding one surface's worth of notification while settlements and ratings
> have none would be an inconsistency rather than a feature.

**That was an argument about the state of the platform, not about documents**,
and the state has changed underneath it. ADR-0043 §4 gave account closure an
email. ADR-0044 §4 gave the answer to a driver's report an in-app row and a
push. `NotificationType` has eleven cases and two of them are driver-facing
office decisions.

So the consistency argument now runs the other way: a document review is the
last decision the office makes about a driver that the driver can only
discover by going and looking.

**The owner asked for it directly**, having seen the KYC screen. The request
was for push *and* email, on any document the office checks.

## Decision

**Both outcomes notify. The rejection reason travels by email and by no other
channel.**

### 1. Verified and rejected, not just verified

The owner's words were "any of the verified document", which reads most
naturally as *any document that gets checked*. It was put back as a question
because the narrow reading is defensible, and the owner chose both.

Both is also the right answer on the merits, and the asymmetry is worth
stating: **a verification is pleasant news that could have waited; a rejection
cannot.** A driver whose licence the office could not accept is unverified and
believes they are compliant. Every day between the refusal and their next
idle glance at the Documents screen is a day the office's request goes
unanswered, and — after a future ADR makes documents gate dispatch — a day
they may find they cannot work.

### 2. Nothing here verifies anything

Restated because widening the notification surface is exactly the moment
somebody reaches for an automation to feed it.

ADR-0033 §4 is untouched: no OCR, no third-party identity check, no rule that
accepts a document because its expiry is in the future. This ADR adds a
*message about* a human decision. It does not add a decision.

The same rule constrains §5's new endpoint, and that is where it took real
work rather than a sentence — see below.

### 3. All three channels, which nothing else on this platform takes

| channel | why |
|---|---|
| in-app row | The record. It cannot fail, and it is where a driver goes looking. Push is best-effort by ADR-0025 §3, and a driver who declined the OS permission must still be told something. |
| push | What makes a **rejection** same-day. This is the whole feature. |
| email | The only channel that survives an uninstalled app, a signed-out one, or a handset that has been replaced — and the only one allowed to carry the office's reason in words. |

Listed in `config/notifications.php` rather than left to
`defaultChannels()`, because this is the type an operator is most likely to
want to narrow: a deployment whose drivers have no email worth speaking of
drops `mail` from one line, and an empty array turns the whole thing off
without deleting the code that raises it.

**The fatigue AGENTS.md warns about is bounded by construction.** Six
documents per driver, one message per human decision, nothing on a schedule.
There is no path here that produces two notifications from one act.

### 4. The rejection reason reaches the email and nothing else

This is the constraint that shaped the implementation, and it very nearly
went in wrong.

A rejection reason is somebody's account of a defect in a stranger's identity
document — *"the photograph is too dark to read the number"*, or worse, *"this
does not appear to be you"*. A push notification lands on a lock screen that
is read over a shoulder in traffic, at a stage, in a shared house.

So: **`body()` never contains it.** Not the push, not the in-app row, not the
`data` payload that crosses Expo's servers. The app already has the reason —
`/me/documents` returns `rejection_reason` on the row, behind the driver's own
token — so nothing is lost by keeping it out of the message.

**The obvious implementation does not work, and the failure is silent.**
`KangaruNotification::pushOptions()` looks like the place to soften a push
body. It is not: `ExpoPushChannel` composes `$shown + … + $options`, and PHP's
`+` operator keeps the **left** operand's keys, so a `body` supplied through
`pushOptions()` is discarded without a warning. The channel's own docblock
says as much — *"`title`, `body` and `data` are this channel's to decide"* —
and it is right to. The safe design is therefore a `body()` that is already
safe on every channel, rather than an override that appears applied and is
not. A test pins it.

### 5. The office can file a document, and filing is not verifying

Not part of the owner's notification request; found while building the console
surface for it, and the same shape of gap ADR-0048 found for driver creation:
**the only way a document had ever reached this platform was the handset in a
driver's own pocket.**

A rider who hands their licence across the counter, emails a scan, or
photographs it badly six times and gives up, had no route in. So
`POST /api/v1/drivers/{driver}/documents`, gated on `drivers.manage` through a
new `DriverDocumentPolicy::create()`.

Three properties, and the second is the one that matters:

- **It shares `StoreDriverDocumentRequest` with the driver's own upload.** The
  8 MB ceiling, the mime list, the expiry rule and the per-type "this one
  needs a date" check are identical because the *document* is identical. A
  second request class here is the drift ADR-0048 §3 argues against, one layer
  up.
- **It writes `pending` and clears every review field**, exactly as the
  driver's own upload does. A clerk who files a licence has not accepted it;
  somebody still has to look, and that is a second act with a second audit
  entry. ADR-0033 §4 applies to the office as much as to a machine, and a
  shortcut that filed and verified in one click would have been the first real
  breach of it.
- **It raises no notification.** The driver is standing at the counter. A push
  telling them the office received the paper they just handed over is
  notification fatigue generated automatically.

**No permission is invented for it.** A clerk who may already read every
driver's identity document and decide whether it is genuine is not
meaningfully restrained by being unable to file the photograph in front of
them; a separate permission would describe a role nobody can name.

### 6. The email is branded, and shorter than the framework's

The owner asked for emails that are "simple and professional, not wordy". Two
edits, both of which reach **every** message the platform sends rather than
this one:

**A KangaruRide mail theme** (`resources/views/vendor/mail/html/themes/kangaru.css`),
seeded from Laravel's default so that every class the framework's blades emit
still exists — this changes colours and nothing structural, which is what
stops a framework upgrade silently unstyling every message. Raw hex is correct
in that file and nowhere else: DESIGN.md §8 bans it in component code, and an
email cannot read a CSS variable.

**A trimmed notification template.** Four things the framework says that we no
longer do:

| removed | why |
|---|---|
| *"Hello!"* | A heading that greets nobody, on every message, pushing the actual sentence below the fold on a phone. A real greeting still renders. |
| *"Regards, KangaruRide"* | A sign-off from a system, above a footer that already says who sent it. Twice in eight words. |
| *"Whoops!"* | Nothing this platform emails anybody is a whoops. |
| *"© 2026 KangaruRide. All rights reserved."* | A copyright notice at the foot of an operational message to a driver about their licence, in the position a useful line should have. Replaced with the fact a recipient actually needs: this is automated, do not reply. |

The subcopy explaining what to do if a button does not render is **shortened,
not dropped** — it is load-bearing in clients that strip buttons, and a driver
whose mail app renders no button is exactly the person who needs the address.

## Consequences

**A driver now finds out the same day.** That is the feature, and it is worth
naming what it costs: the platform sends more email, and an operator without
SMTP configured sends none — `SettingsService::mailConfigured()` already
governs that, and this type degrades to the in-app row and the push rather
than failing.

**The office gains a way to file documents, and with it a way to be sloppy.**
An administrator can now put a file against any driver. It is audited, it is
gated on `drivers.manage`, and it still cannot verify anything — but a
document filed by the office is a document nobody photographed under the
driver's eye. That is a real trade and it was the owner's to make.

**ADR-0033 §6's other refusals stand.** Documents still gate nothing, and the
upload still does not go through the offline outbox.

**`document.expiring` is still not built** — ADR-0039's item 1, still the most
valuable missing notification on this platform. It needs a scheduled command
and a decision about how many days ahead and how often to repeat. Offered to
the owner with this work and deliberately deferred.

## Alternatives considered

**Notifying only on verification**, the literal reading of the request.
Rejected in §1: the rejection is the message that costs a driver work, and a
feature that announces only good news is one drivers learn to ignore.

**Putting the rejection reason in the push body.** Rejected in §4. It is the
office's opinion of somebody's identity document on a lock screen.

**Using `pushOptions()` to give the push a softer body.** Rejected because it
does not work — `+` keeps the left operand's keys — and, more importantly,
because it *looks* like it works. A mechanism that silently no-ops is worse
than one that is absent.

**Attaching the document to the email.** Proposed as a reading of the owner's
"and it can be attached", and put to them as a choice. Rejected by the owner
in favour of a file picker on the KYC screen. It would have copied a national
ID into a mail provider permanently and sent it unencrypted between mail
servers, against everything ADR-0033 §5 arranges.

**A separate `documents.review` permission.** Rejected in §5 as a role nobody
can describe. The seam if compliance ever separates from fleet is
`DriverDocumentPolicy`, exactly where ADR-0033 §4 put it.

**Leaving ADR-0033 §6 alone and building nothing.** The honest alternative,
and the one that would have been right three months ago. Its argument was
consistency, and two ADRs since have made the platform consistent the other
way.
