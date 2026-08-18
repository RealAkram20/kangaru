# ADR-0044 — Driver issue reporting

**Status:** accepted, 2026-08-17
**Extends:** ADR-0032 (settlement requests — the request/answer shape this
reuses), ADR-0039 (driver notifications — the return path), ADR-0040 (the
Help & Safety screen these rows live on)
**Reverses:** `master-plan.md` §7, which excludes driver issue reporting from
go-live by name, and `docs/feature-completeness.md` §3.9, which classified it
as correctly out of scope. **The owner reversed both, in that order, on
2026-08-17.**

## Context

Help & Safety draws a **Help Topics** card of five rows — *Report an issue,
Passenger issue, Vehicle issue, Payment issue, Lost item*. The owner read that
card and said the rows *"seem to be repeated and fake"*, and asked whether they
were linked to the backend.

They were not, and the reading was fair:

- The five topics are a hardcoded array in the driver app
  (`mobile/src/support/topics.ts`). No endpoint serves them.
- **All five navigate to the same screen.** `Support` differs by a subtitle, one
  summary sentence, three "have these ready" prompts, and a prefilled mail
  subject. Nothing else.
- The distinguishing summary was passed as an accessibility `announcement`
  only, so a **sighted** driver saw five identically shaped chevron rows leading
  to one phone number.
- Nothing a driver types anywhere on this platform reaches the office as a
  written report. Twelve backend modules contain no ticket, issue or
  support-request table, route, model or policy.

The previous author knew all of this and said so at length: `topics.ts` argues
that a text box posting nowhere is the same failure the SOS button was refused
for, and that the honest version *"is buildable later, as a backend feature with
an ADR, rather than faked now"*.

**This is that ADR.** The reasoning was right, and the answer to it is to build
the loop rather than to keep apologising for its absence.

## Decision

**A driver raises a written report; a person at the office answers it; the
driver is told.** The four parts of `master-plan.md` §2's completeness gate,
built together or not at all.

### 1. The five topics become one form's category

They stop being five doors to one phone number. A topic now decides:

- what the form asks the driver to include (the existing `prepare` prompts,
  which get their first real use),
- what the office queue can be filtered by,
- how the report is titled everywhere it is read.

This is the direct answer to *"repeated"*: there is one destination because
there was always one destination, and now the rows say so on their face.

**The labels do not change.** They are the owner's own and they are what a
driver scans for; the defect was never the words.

### 2. Two statuses, and no third

`open` → `answered`. There is deliberately **no "closed" without an answer.**

An office that can close a driver's report in silence reproduces the exact
failure this feature exists to end — the driver who reports a passenger who
threatened them and hears nothing. Every report gets a written answer, and the
loop closes by construction rather than by discipline.

The cost is honest: a spam report must also be answered, in one line. That is
cheaper than a queue drivers learn to distrust.

### 3. The office answers in the web app

A page in the console, gated on `drivers.manage` — the same compromise ADR-0032
§5 records for settlement requests, and the same seam to cut along when a
Support or Finance role separates from Fleet. It is not a new permission
because a queue nobody has a role for is a queue nobody reads.

**Answering is a `POST` to a sub-path, not a `PATCH` on a status field** — the
shape every other office decision on this platform uses (approve, reject,
verify, confirm, decline). An answer has its own audit meaning; a status field
would make it look like an edit.

### 4. The return path is the driver's inbox

ADR-0039 built a notifications inbox and this is the second thing to use it.
Channels: **database and push.**

- **Database**, because the inbox is where the driver goes looking, and it
  survives a declined OS permission.
- **Push**, because the driver asked a specific question and is waiting for a
  specific answer. This is not fatigue: it is bounded at one per report, and
  the report was the driver's own act.
- **Never mail.** The driver has a working account and an app; ADR-0043's
  closure notification is the only driver message mail is right for, and it is
  right there precisely because the account has stopped working.

### 5. What is deliberately not built

- **No attachments.** A photograph belongs in ADR-0033's document pipeline,
  which has storage, streaming and a review queue this does not.
- **No threading.** A second message is messaging, which `trips/contact.ts`
  rules out platform-wide and for reasons that have not changed. One report,
  one answer, both permanent. A driver who needs to say more raises another
  report, and the old answer stays readable.
- **No SLA, no due date, no assignment to a named clerk.** Those are the
  furniture of a help desk with staff to run it. When there is one, this table
  is where they attach.
- **No reopening.** An answered report is a finished exchange.
- **No offline queue.** ADR-0023's outbox carries small trip transitions that
  must survive a dead zone; a report a driver expects a person to read needs to
  be known to have arrived, and the screen says so — the same call ADR-0033 made
  for uploads.

### 6. The phone stays exactly where it is

Contact Support still dials, and the emergency card is untouched. Somebody
whose vehicle has just been hit does not want a form, and a written channel is
not an argument for taking away a spoken one. The two now say different things:
**call for what is happening now, write for what needs a record.**

## Consequences

- The completeness census gains a closed row where its largest open gap was.
- The office gains a queue it did not have, and with it an obligation: an
  unanswered report is now visible as unanswered, which is the point.
- Five rows that looked like a ticket system become one, and the driver app
  stops implying a feature it does not have.
- `master-plan.md` §7 is stale on this point. It is left standing with this ADR
  named against it rather than quietly edited, so the reversal is legible.
