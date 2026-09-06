# ADR-0048: Onboarding documents, and the vehicle a driver owns

**Status:** Accepted — 21 August 2026

**Amends:** ADR-0033 §1 (the catalogue gains two cases) and ADR-0033's
Consequences, where "Approving an ADR-0027 application still does not require
documents" is *kept* but stops implying that an application cannot carry any.
**ADR-0033 §4 — nothing is auto-verified, ever — is untouched and §6's
"documents gate nothing" is untouched.**

**Amends:** ADR-0027 §1's "until an administrator approves them, an applicant
has no credentials on this platform at all". §4 below withdraws the absolute
form of that sentence and replaces it with something narrower and, I will
argue, still true in the sense ADR-0027 meant it.

**Depends on:** ADR-0004 (permissions), ADR-0005 (the fleet is the
platform's), ADR-0011 (contract or it does not exist), ADR-0016 (the account a
driver signs in with), ADR-0027 (self-service registration), ADR-0033 (driver
documents).

## Context

Two gaps were found together, and they turn out to be the same gap.

**The console has never been able to create a driver.** `DriverController`
has had `store`, `update` and `destroy` since Phase 1. `StoreDriverRequest`
has accepted `vehicle_id` since ADR-0009. And **no screen has ever called
any of them.** `DriversPage` is a read-only table with three dialogs hanging
off it. Every driver in every environment arrived from a seeder, which is
precisely why nobody noticed: the API could onboard a driver, and the
platform could not.

So "the fleet is grown by hand at the roadside" — ADR-0027's own
justification for self-registration — was true in a second way nobody had
written down. The office could not type a driver in either.

**And the driver app's KYC mockup asks for two things the platform refuses.**
It draws six slots where ADR-0033 fixed four, and its button says *Submit for
Review*, which places the whole set before approval where ADR-0033 §4 placed
it firmly after.

Both were put to the owner as conflicts rather than resolved in the mockup's
favour, per `docs/screen-rules.md`. The owner chose to widen the catalogue and
to accept documents at **both** moments.

## Decision

### 1. Two more types, and the naming rule that admitted them

| type | what it is |
|---|---|
| `identity_selfie` | a photograph of the applicant's face, to set beside the identity document |
| `vehicle_photo` | the vehicle itself, as it looks on the road |

ADR-0033 §1 said the set was "closed and short on purpose" and that "a fifth
type is one case here". That sentence was an invitation with a condition
attached, and the condition is the naming rule: **nothing in the catalogue may
be named for one country.** *PSV badge*, *logbook* and *third-party sticker*
were refused on it.

Both new cases pass. A face is a face in Kampala and in Nairobi, and a
photograph of a car is not a jurisdiction's paperwork. Neither needs a
migration to mean the right thing somewhere else. The set is now six and is
closed again on the same terms.

**Neither carries an expiry**, and this is not an oversight. ADR-0033 §3 made
expiry required where the document *is* its date — a licence, an insurance
certificate. A selfie and a photograph of a car have no date to lapse, and
demanding one would be a field asking a driver to invent something.

### 2. The selfie is the one genuinely new kind of thing here, and it is
### treated as such

Four of the six are papers issued by somebody else. A selfie is biometric-
adjacent personal data about the person themselves, and it deserves saying out
loud what it is and is not for.

**It is for a human to look at, beside the identity document, and decide
whether they are the same person.** That is all.

- **No face matching, no liveness detection, no third-party check.** ADR-0033
  §4 is untouched and it is emphatic: "a machine that marks a licence verified
  is the original problem wearing a better hat." A selfie makes automated
  verification *easier to reach for*, which is the exact moment to restate
  that it is refused.
- It is stored, streamed and access-controlled identically to the other five
  — the private disk, a controller behind the policy, never a signed URL
  (ADR-0033 §5). There is no weaker path for it and no separate one.
- `docs/data-inventory.md` gains a row. Uganda's Data Protection and Privacy
  Act, 2019 obliges an operator to know what personal data it holds, and a
  photograph of a face that is not in the inventory is the kind of omission
  that is only ever found by an auditor.

If a future ADR ever proposes automated identity matching, this section is
the thing it has to argue against, and it should have to.

### 3. One table, two owners, and exactly one of them set

Documents at application time do **not** get a second table.

`driver_documents` gains `driver_application_id`, and `driver_id` becomes
nullable. A row belongs to a driver **or** to an application, never to both
and never to neither — a check the model and the service both enforce.

A second table was the obvious alternative and it was rejected on the shape of
the thing it would duplicate: the same file storage, the same four review
states, the same expiry derivation, the same policy, the same streaming
controller, the same enum. **Two tables holding the same file with the same
review states is where the second one drifts**, and it drifts silently,
because the office only ever looks at one of them.

The unique index becomes two:

    unique(driver_id, type)
    unique(driver_application_id, type)

Both work as intended *because* MySQL permits many NULLs in a unique index —
the same property ADR-0016 §3 relied on for `drivers.user_id`. A driver's row
has a NULL application id and so cannot collide on the second index; an
applicant's row has a NULL driver id and cannot collide on the first.

### 4. How an applicant uploads, holding no account

ADR-0027 §1 is categorical: "until an administrator approves them, an
applicant has no credentials on this platform at all — nothing to sign in
with, nothing to suspend, nothing to enumerate." Accepting a file from that
person means something has to identify which application it belongs to, and
that is a credential by any honest reading.

**The decision: submission mints a single-purpose upload capability, stored
hashed on the application row, and it is not an account.**

`POST /api/v1/driver-applications` returns, once and never again:

    upload_token         opaque, 48 random bytes, base64url
    upload_expires_at    24 hours

Stored as `upload_token_hash` + `upload_token_expires_at` on
`driver_applications`. Three endpoints accept it, and nothing else on the
platform does:

    POST   /api/v1/driver-applications/documents        upload one file
    GET    /api/v1/driver-applications/documents        list slots, no file bytes
    DELETE /api/v1/driver-applications/documents/{type} withdraw one

**Why this is not the thing ADR-0027 refused.** That ADR was protecting
`drivers.user_id` — the link `TripPolicy` reads to answer "is this trip
yours?". Its argument was that "a public form that mints one would walk past
all three [checks]". This token reaches no policy, no trip, no account and no
other application. It resolves to exactly one row, it authorises exactly one
verb on exactly one sub-resource, and there is no code path from it to a
session. It is a claim ticket, not a principal.

**Why not fold the files into the submission request instead**, which would
need no token at all and would have kept ADR-0027 §1 whole. Because six
photographs at 8 MB is a 48 MB request from a handset on a Ugandan mobile
connection, and when it fails at 80% the applicant loses the form as well as
the files. One request per file is retryable; a single request is a coin flip
that gets worse the more the mockup asks for. **The UX argument won, and the
cost is this section having to be written.**

Consequences of the choice, all deliberate:

- **The listing returns metadata only — type, filename, size, uploaded-at —
  and never file bytes.** A stolen token must not become a way to *read*
  somebody's national ID, only to overwrite it, which is noisy and useless.
- **The token dies at the decision.** Approve or reject clears the hash in
  the same transaction that clears the password ADR-0027 §3 stores. An
  applicant cannot amend a decided application.
- **It is throttled at ADR-0027 §5's auth rate**, 5/min/IP, and the storage
  ceiling is the six-case enum: a token can hold at most six files, because
  a seventh of the same type replaces rather than accumulates.
- **It answers 404, never 401**, to an unknown or expired token, for the
  reason ADR-0027 §5 gives about oracles.

### 5. Approval carries the documents over. Rejection destroys them.

Approval, in the one transaction ADR-0027 §4 already runs: each application
document is re-pointed at the new driver — `driver_id` set,
`driver_application_id` cleared, **`status` left exactly as it is**, which is
`pending`, because nobody has looked at it yet and approval is not review.

Rejection deletes the files and the rows. ADR-0027 clears a rejected
applicant's password on the same reasoning and this is the stronger case:
holding a photograph of a stranger's face and national ID, for a person the
platform decided against, is a liability with no corresponding use. The
`Auditable` trail records that it happened.

**An abandoned application is the case neither ADR had to think about
before.** A row that is never decided keeps its files forever. A scheduled
task deletes the documents of applications older than 90 days that are still
`pending`, and leaves the row — the row is the record that somebody applied,
the photographs are not.

### 6. Approval still does not require documents

Unchanged from ADR-0033, and worth restating because widening the catalogue
and accepting early uploads both push the other way.

Documents at application time are **optional, every one of them**. The office
approves on the licence details it verified by telephone, exactly as before.
Making any document a precondition would stall the applicant queue behind a
review step ADR-0033's Consequences specifically refused to put there, and
would do it at the moment the platform is trying to recruit riders at the
roadside.

The mockup's *Submit for Review* button is therefore honest about less than it
appears to promise: it submits what the applicant has, and an applicant who
uploads nothing is in the queue on the same terms as one who uploads six.

### 7. `drivers.owns_vehicle`, because `vehicle_id` cannot answer the question

`Driver::$fillable` has carried `vehicle_id` since ADR-0009, and its own
docblock states the ambiguity without resolving it:

> a corporate driver takes whatever the depot hands them, and presence
> carries the per-shift answer for them. For a boda rider it is the driver's
> own machine and effectively permanent.

**Both of those set the same column to the same kind of value.** Nothing
stored distinguishes a rider whose boda is their livelihood from a driver
holding the keys to a depot Premio this week, and the two are different in
every way an operator cares about — who insures it, who repairs it, whether
it leaves when they do, and whether `vehicle_registration` and
`vehicle_insurance` are the driver's papers or the platform's.

So: a stored boolean, defaulting false, and **not** derived from
`vehicle_id !== null`. A derivation would answer "has a vehicle", which is a
question nobody asked.

### 8. The driver form creates the vehicle, in one transaction

When `owns_vehicle` is true and no `vehicle_id` is given, the driver form
carries a nested `vehicle` object — the same fields `StoreVehicleRequest`
validates, validated by the same rules — and `DriverService::create()` mints
the `Vehicle` and the `Driver` together or neither.

The alternative is what the console does today: send the clerk to the
Vehicles screen, have them create it, come back, and find the driver form
empty. That is two screens and a lost form to record one fact about one
person, and the owner named it as the thing to fix.

**The vehicle is a normal fleet vehicle.** It is not marked as owned by the
driver, it appears on `VehiclesPage` like every other, and ADR-0005 is why:
the fleet is the platform's view of what is on the road, and a vehicle it
cannot see is a vehicle it cannot dispatch. `owns_vehicle` lives on the
driver because it is a fact about the *relationship*, not about the car.

**Un-ticking the box clears the link and does not delete the vehicle.**
A checkbox that destroys a fleet record is the kind of silent destruction
this codebase refuses elsewhere (ADR-0016 §5 keeps the account when the link
goes). The vehicle stays; somebody who genuinely wants it gone deletes it
where vehicles are deleted.

### 9. Permissions are the ones that already exist

Creating and editing a driver is `drivers.manage`, which `DriverPolicy`
already requires and which a Depot Manager already holds. Nothing new is
seeded.

**Creating a vehicle through the driver form still requires
`vehicles.manage`**, checked separately, for the reason ADR-0016 §1 gives at
length about side doors: folding vehicle creation into `drivers.manage`
would let a role that was never granted the fleet create fleet records from
a different screen. A clerk holding only `drivers.manage` gets the vehicle
picker and not the inline form, and is told why.

## Consequences

**The office can onboard a driver end to end from one screen** — profile,
vehicle if they own one, sign-in, papers — which is what the API has been
able to do since Phase 1 and no human has ever been able to do.

**The applicant queue gains photographs**, and with them a real obligation:
`identity_selfie` beside `identity_document` is only worth collecting if
somebody looks. ADR-0033's Consequences made the same commitment about the
first four and shipped the console surface in the same change; this does too.

**Storage grows on a second axis.** Six files per driver rather than four,
plus up to six per undecided application. The 90-day sweep in §5 is what
stops the second axis being unbounded, and it is the first scheduled task
this module has owned.

**`docs/data-inventory.md` acquires a face.** Named here so it is not
discovered later.

**Two things are now true that a reader of ADR-0027 alone would get wrong:**
an applicant *can* hold a credential, of a deliberately impoverished kind
(§4); and an application *can* carry files, which are destroyed if it is
refused (§5).

## Alternatives considered

**A separate `driver_application_documents` table.** Rejected in §3: it
duplicates storage, states, expiry, policy, streaming and the enum, and the
copy drifts where nobody is looking.

**Folding the uploads into the submission request, with no token.** Rejected
in §4 on connection quality, at the price of amending ADR-0027 §1. This was
the closest call in this record.

**A Sanctum token with narrow abilities, instead of an opaque row-scoped
secret.** Rejected because it requires a `users` row to hang off, which is
exactly the unapproved principal ADR-0027 §1 refused. The hashed column
authenticates a *row*, and no part of the auth system learns about it.

**Deriving `owns_vehicle` from `vehicle_id`.** Rejected in §7: it answers a
different question and cannot tell a boda from a depot car.

**Marking the vehicle itself as driver-owned.** Rejected in §8: ADR-0005
puts the fleet with the platform, and ownership is a fact about the
relationship between a driver and a vehicle, not a property of the vehicle.

**Requiring documents before approval.** Rejected in §6, which is ADR-0033's
Consequences restated under pressure rather than a new argument.

**Automated identity verification from the selfie.** Rejected in §2, and
ADR-0033 §4 rejected it first, in stronger language.
