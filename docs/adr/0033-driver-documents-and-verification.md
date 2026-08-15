# ADR-0033: Driver documents and verification

**Status:** Accepted — 15 August 2026
**Depends on:** ADR-0016 (driver sign-in accounts), ADR-0027 (self-service
driver registration), ADR-0004 (permissions), ADR-0023 (offline outbox)

## Context

`Modules\Drivers\Models\Driver` has said the same thing since Phase 1:

> Minimal Phase-1 slice: qualifications, availability, performance and
> **document uploads are deferred**.

Availability landed (ADR-0017), performance landed (ADR-0030). Documents did
not, and the gap is now load-bearing rather than merely unfinished.

**ADR-0027 made anybody able to apply.** A rider fills in a form, the office
approves it, and a `drivers` row appears carrying a name, a phone number and a
licence *number typed by the applicant*. Nothing on this platform has ever seen
the licence. The office approves people on the strength of a string.

**And the driver app now asks about it.** The Profile screen's mockup drew a
**Documents — Verified** row. That row is the reason this ADR exists: printing
"Verified" against a compliance fact the platform does not hold is not a
cosmetic lie. A driver stopped at a checkpoint, or an operator answering a
regulator, would both be relying on a word the software made up.

The choice was between omitting the row and building the thing. The owner chose
to build it.

## Decision

**A driver holds a small, fixed set of documents. The driver uploads; the
office verifies; the app reports the state and never guesses it.**

### 1. Four types, and none of them named for one country

| type | what it is |
|---|---|
| `driving_licence` | the licence to drive, whatever the issuing state calls it |
| `identity_document` | national ID, passport, or the local equivalent |
| `vehicle_insurance` | cover on the vehicle being driven |
| `vehicle_registration` | proof the vehicle is registered |

The mockup's world is Kampala, and the obvious East African list — *PSV badge*,
*logbook*, *third-party sticker* — was deliberately not used. AGENTS.md and
`PRODUCT.md` both require that nothing new deepen the Uganda assumption, and a
document **type enum is exactly the kind of thing that quietly does**: it ends
up in a database column, an OpenAPI enum and every shipped handset, and is then
untouchable. `identity_document` covers a national ID in Kampala and a passport
in Nairobi without a migration.

The set is **closed and short on purpose**. An operator-configurable document
catalogue is a reference table, a settings screen and a per-tenant override —
and every one of those is a thing to maintain in exchange for flexibility
nobody has asked for. When a fifth type is needed, it is one enum case.

### 2. One row per driver per type. Re-uploading replaces.

A driver has at most one row of each type. Uploading again replaces the file
and **resets the status to `pending`**, clearing the review fields — because a
document the office verified is not evidence for a different file that arrived
afterwards.

The superseded file is deleted. This is a deliberate trade and worth naming:
keeping every version would let the office re-read a rejected upload during a
dispute, at the cost of unbounded storage for a document nobody accepted. The
`Auditable` trail records *that* it was replaced, by whom and when, which is
the half that matters for accountability. **If a dispute ever needs the file
itself, the seam is to soft-delete the row rather than the file** — one
migration, no API change.

### 3. Three stored states, and a fourth that is derived

Stored: `pending` → `verified` | `rejected`. A rejection carries a reason;
"rejected" with no reason is how a driver stops using a feature (ADR-0032 §3
reached the same conclusion about a declined settlement).

**`expired` is derived at read time from `expires_at`, never stored.** A stored
expiry state needs a nightly job, and is wrong for up to a day every time it
runs. A comparison against today is right at every instant and costs nothing.
The comparison is made in the **operator's timezone**
(`settings.regional.timezone`), for the reason the earnings work found the hard
way: `config/app.php` is UTC, so a naive comparison rolls the day over at 03:00
in Kampala.

Expiry is required for `driving_licence` and `vehicle_insurance` — both are
documents whose entire meaning is a date — and optional for the other two.

### 4. Verification is a human act, gated on `drivers.manage`

The same permission that already governs a driver's record, for the same reason
ADR-0032 §5 reused it, and with the same caveat: this is a compliance act, and
if a Compliance role ever separates from Fleet, `DriverDocumentPolicy` is the
single seam to cut.

Every verify and reject is `Auditable`. This is the second surface (after
ADR-0032) where a staff action changes what a driver may do, and the first
where it concerns a legal document.

**Nothing is auto-verified. Ever.** There is no OCR, no third-party identity
check, no "verified because the expiry date is in the future". A machine that
marks a licence verified is the original problem wearing a better hat.

### 5. Files are private, streamed, and never public URLs

Storage mirrors `OdometerPhotoStore`, which solved this already:

    drivers/{driver}/documents/{type}-{uuid}.{ext}

Served by a controller behind authentication and policy, never as an
object-storage link. A signed URL for somebody's national ID is addressable by
anyone who ever saw it, for as long as it lives.

Images and PDF only, 8 MB, because the uploader is a handset on a Ugandan
mobile connection and the reader is a person in an office.

### 6. What a document does *not* do — yet

**It does not gate anything.** An unverified driver is dispatched exactly as
before; an expired licence blocks no offer. This ADR builds the record, not the
enforcement, and the split is deliberate: enforcement is a policy decision with
real operational consequences (a fleet where half the licences lapse on a
Sunday cannot take work on Monday), and it deserves its own decision made by
somebody who runs a depot.

**The seam is named so it is not rebuilt badly:** the state a rule would
consult is `DriverDocumentService::complianceFor($driver)`, which already
answers *verified / action needed / nothing uploaded* for the profile screen.
A future ADR consults that; it does not add a second notion of compliance.

**No notification.** Consistent with ADR-0029 §6 and ADR-0032 §6: a driver
learns their document was verified or rejected by opening the app. The push
channel exists (ADR-0025) and this is a fair candidate for it, but adding one
surface's worth of notification while settlements and ratings have none would
be an inconsistency rather than a feature.

**Not routed through the offline outbox.** ADR-0023 queues state transitions,
which are small JSON payloads; an 8 MB photograph in an AsyncStorage-backed
queue is a different problem. The upload needs a connection and says so, the
way `changePassword` already does.

## Consequences

**The office gains an obligation, and it is a real one.** Documents will arrive
and sit `pending` until somebody looks. Unlike ADR-0029's obligation — which
went unmet for ten months because nothing could act on it — this one ships with
its console surface in the same change.

**"Verified" on the driver's profile is now true or absent.** It is never
decoration.

**Approving an ADR-0027 application still does not require documents**, and
that is unchanged on purpose. Making documents a precondition of approval would
stall the applicant queue behind a review step the office has never done
before. Applications approve as they always did; documents are a state the
driver moves through afterwards.

**Storage grows with the fleet**: four files per driver, bounded, and
overwritten rather than accumulated. A thousand drivers is single-digit
gigabytes.

## Alternatives considered

**A third-party identity/KYC service.** Rejected without much difficulty:
metered, per-check, recurring — which `quality-control` makes the owner's
decision rather than an agent's — and it answers a question ("is this document
genuine") that a depot manager who knows the driver answers better and free.

**Documents on the application (ADR-0027) rather than the driver.** Attractive,
because that is when identity actually matters. Rejected because an application
is a stranger's row that is deleted or abandoned, documents expire and must be
re-uploaded for the working life of a driver, and a licence that renews in 2029
has nothing to do with a form filled in 2026. The document belongs to the
person, not to the moment they asked.

**An operator-configurable document catalogue.** Rejected as premature — see §1.
Four cases in an enum, versus a reference table, a settings screen, per-tenant
overrides and a migration path, to serve a need nobody has stated.

**Blocking dispatch on verification.** Rejected as out of scope, not as wrong —
see §6. It is the natural next ADR and the seam is already cut for it.
