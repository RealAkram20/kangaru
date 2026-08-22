# ADR-0057: Reviewing an applicant's documents one at a time

**Status:** Accepted — 22 August 2026

**Amends:** ADR-0048 §5 (documents carried to the driver as `pending`),
ADR-0033 §4 (per-document review begins once a driver exists), ADR-0027 §6
(the office tells applicants by phone).

**Depends on:** ADR-0048 (the claim ticket), ADR-0052 (telling somebody what
the office decided), ADR-0053 (documents encrypted at rest).

## Context

An applicant sends up to six documents against a claim ticket. Until this
week nothing showed them to the office; the queue offered **Approve** and
**Reject** over a name and a phone number, and the licence the reviewer was
told to transcribe from was not visible anywhere. That half is fixed — the
decision dialog now lists the documents and previews the files.

What it left is an all-or-nothing decision. The owner put it plainly:

> a reviewer should be able to refuse one blurry licence without refusing the
> whole person

Today they cannot. One unreadable photograph and the only tool is
`reject`, which closes the application, destroys every file, and sends the
applicant back to the beginning — including the five documents that were
perfectly good.

**The existing design says this is deliberate.**
`DriverDocumentService::announce()` notes that *"an application-owned row
should not be reviewable at all"*, and ADR-0033 §4 starts per-document review
once a driver exists. That position was reasonable when an applicant had no
way to hear a verdict and no way to answer it. It produces, in practice, a
reviewer who approves a person whose licence they could not read, or refuses
somebody over one bad photograph.

## Decision

### 1. A document is accepted or refused on the application, before approval

Two routes beside the read-only pair added this week:

```
POST /driver-applications/{driverApplication}/documents/{document}/verify
POST /driver-applications/{driverApplication}/documents/{document}/reject
```

They write the same three columns `DriverDocumentService` already writes for a
driver's document, through the same service. **There is no second notion of a
reviewed document**, which is the property ADR-0033 §4 relies on when it says
that class is the only thing that writes a review.

Refusing a document **does not close the application**. It stays `pending`,
the other five verdicts stand, and the files are not destroyed — the
destruction in ADR-0048 §5 belongs to refusing a *person*, which is a
different act and still available.

### 2. Approval requires every document to be accepted

`approve()` refuses while any document is `pending` or `rejected`, with a
message naming what is outstanding. The owner's words: *"all their Documents
should be accepted"*.

**A document that was never sent does not block**, and that asymmetry is
deliberate. Every document is optional at submission (ADR-0048 §6) and an
applicant who sent nothing is in the queue on the same terms as one who sent
six; a rule that demanded all six would quietly make them mandatory and
contradict the screen that says *"Nothing here is required"*. What blocks is a
document the office has **looked at and not accepted** — the same line
`complianceFor()` already draws between `action_needed` and `incomplete`.

### 3. A refusal notifies the applicant, and carries a fresh claim ticket

The applicant has no account and no registered device, so the notification is
an **email routed on demand** to the address on the application. It names the
document type and the office's reason, and carries a **newly minted claim
ticket** so they can send a replacement.

**This is not the enumeration oracle ADR-0027 §5 refuses.** That section
protects an *unauthenticated* endpoint from answering whether an email is
known to the platform. Here the trigger is a signed-in reviewer acting on an
application already in front of them, and the recipient is an address that
applicant typed themselves. Nothing a stranger can reach has changed.

It amends ADR-0027 §6 — *"the office tells people by phone"* — for this one
case, on ADR-0052's reasoning: a refusal the person never hears about is a
refusal that costs them the job while they wait.

### 4. The replacement replaces one document, not the set

Already true and worth recording: `POST /driver-applications/documents` takes
one `type` and one file and replaces whatever was held of that type. An
applicant answering a refusal sends one photograph.

## Consequences

**A reviewer can be exact.** "Your licence photo is cut off at the bottom"
instead of "your application was rejected", and the five good documents
survive.

**Approval becomes a statement about evidence**, not a judgement made past
it. The button cannot be pressed while a document sits unaccepted, which is
the point of asking someone to check a licence at all.

**A live claim ticket now travels by email.** It reaches one application, it
returns no file bytes, and it dies at the decision — ADR-0048 §4's bounds are
unchanged. What is new is that the office can cause one to exist, which is
why only a reviewer holding `drivers.manage` can.

**Applications can now sit longer.** An applicant who never answers a refusal
stays pending indefinitely. No expiry is added here: a queue the office can
see is better than a silent deletion, and ADR-0027 §6 already makes chasing
people a human act.

## Alternatives considered

**Approve first, then gate dispatch on document compliance.** The ADR-0033 §6
seam, and genuinely attractive: everything needed exists except the gate.
Refused because it makes "approved" mean *identity accepted but cannot work*,
and the owner was explicit that the sequence runs the other way — the
documents are checked, and *then* the person is activated. It also creates a
driver record and a login for somebody whose licence has not been read.

**Let the reviewer refuse the application with a reason and have the
applicant re-apply.** Today's behaviour. It loses five good documents and the
place in the queue, and the re-application arrives as a new row with no
memory of the conversation.

**Keep the applicant's existing ticket alive instead of minting a new one.**
Cheaper, and unusable: `RootNavigator` drops the ticket when the KYC screen
closes, deliberately — the screen's own docblock refuses to persist *"a live
credential for somebody's identity documents"* on a handset. There is nothing
left to keep alive.
