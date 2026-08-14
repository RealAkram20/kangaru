# ADR-0027: Self-service driver registration

**Status:** Accepted (10 August 2026)

**Amends:** ADR-0016 (driver sign-in accounts) — specifically the third
paragraph of its Consequences, "There is no self-service driver sign-up:
accounts are issued, like every other account here." That sentence is
withdrawn. Everything else ADR-0016 decided stands, and §2 below is mostly
an argument that it must.

**Depends on:** ADR-0004 (permission model), ADR-0011 (contract or it does
not exist), ADR-0014 (the Terms and Privacy notices consent is given to),
ADR-0022 (token scope).

## Context

The owner asked for a sign-up screen in the Driver App: name, phone, email,
password, consent to two notices, and a button that creates an account.

ADR-0016 refused exactly this four days ago, and the refusal was not
arbitrary — it followed from how authority works here. `drivers.user_id` is
what `TripPolicy` reads to answer "is this trip yours?". Creating a login is
creating a principal, which is why ADR-0016 required three separate checks
before an administrator could do it. A public form that mints one would walk
past all three.

But re-reading that ADR, the thing it protects is narrower than the thing it
banned. The invariant is **the link, not the account**: an account with no
`drivers.user_id` pointing at it is a principal that can reach nothing.
ADR-0016 §4 even built a way to adopt such an account — `{user_id}` on the
attach endpoint — describing it as "the way back for rows created by hand
before this endpoint existed".

So the question is not "may a stranger create a login". It is "may a stranger
put themselves in a queue", and that has a different answer.

There is also a commercial fact the earlier ADR did not have to weigh. The
fleet is being grown from Kampala's existing boda and taxi riders, who are
recruited at the roadside and will not travel to an office to have an account
typed for them by a Depot Manager. "Accounts are issued" scales to a fleet
somebody hires; it does not scale to one that signs itself up.

## Decision

**An application is not an account. Self-registration writes a
`driver_applications` row and nothing else. Approval is an administrator's
act, performed through the machinery ADR-0016 already built.**

### 1. A separate table, not a pending user

`driver_applications`: `name`, `phone`, `email`, `password` (hashed),
`status`, `reviewed_by_user_id`, `reviewed_at`, `rejection_reason`,
`driver_id` once approved.

The obvious alternative — write a `users` row with a new `pending` status —
was rejected on the enum's own reasoning. `UserStatus` says, in its docblock:

> Two cases, not three. [...] an account is either usable or it is not, and
> inventing a middle state nothing checks would be a status that lies.

A third case would need every authorisation path to learn about it, and the
cost of missing one is a login that works before anybody approved it. A row
in a table no policy consults cannot have that bug. **Until an administrator
approves them, an applicant has no credentials on this platform at all** —
nothing to sign in with, nothing to suspend, nothing to enumerate.

It is also the truthful model. An applicant is not a suspended driver; they
are a person the platform has not yet decided about, and a `drivers` row
cannot represent them either — that table requires a licence number and a
licence expiry, neither of which a stranger's form can be trusted to supply.

### 2. What ADR-0016 keeps, and why this does not weaken it

The link still grants the authority, and only an administrator makes it.
Nothing in this ADR lets a caller reach `drivers.user_id`. Approval runs
through `DriverAccountService::open()` — the same three checks, the same
audit entry, the same exclusive index on both halves.

The account minted at approval is `active`, platform-level, and holds
whatever role the approver was entitled to grant. That is ADR-0016 §2 with a
different trigger, not a new path.

### 3. The password is chosen once, by the person who will type it

The applicant's password is hashed at submission and carried to the account
at approval. It is never re-typed, never emailed, and never known to the
administrator.

This is a deliberate improvement on ADR-0016 §4, which had the administrator
set an initial password and tell the driver what it was — a compromise that
ADR explained by the absence of an accept-invite page. That absence is
unchanged, and this route sidesteps it: nobody needs to be told a secret they
chose themselves. The hash moves as a hash; `Hash::isHashed()` is why passing
it through the model's `hashed` cast does not double-hash it.

An application row therefore holds a live credential before any account
exists, which is the one new sensitive thing this ADR creates. It is bcrypt,
it is never returned by any endpoint, and a rejected or approved application
has it cleared.

### 4. Approval completes the profile in one act

`POST /api/v1/driver-applications/{application}/approve` takes the fields the
applicant could not be trusted to give — `license_number`, `license_expiry`,
optional `vehicle_id` and `role` — and, in one transaction, creates the
`Driver`, mints the account, links them, and marks the application approved.

There is no `tenant_id`, and its absence is ADR-0005: a driver is the
platform's employee, not a client's, so `drivers` has no tenant column and
the account is minted platform-level exactly as ADR-0016 §6 requires.

One act rather than three screens because the intermediate states are all
wrong: a driver profile with no account cannot work, and an account with no
profile is the inert row §1 describes. An administrator who abandons the
flow halfway should leave nothing behind.

Rejection is `POST .../reject` with a reason, which is recorded. The reason
is for the office, not the applicant — see §6.

### 5. The public endpoint cannot be used to enumerate

`POST /api/v1/driver-applications` is unauthenticated, throttled 5/min/IP
(the auth-endpoint rate in AGENTS.md), and **answers identically whether or
not the email is already known to the platform**. A duplicate is stored and
refused at approval, where a human is reading it, rather than refused at
submission, where a script is.

This costs something real — an applicant who genuinely already has an account
learns so late — and it is still the right trade. The alternative hands
anybody a free oracle for "does this person drive for KangaruRide", against a
population whose whereabouts are worth money to the wrong people.

Consent to the two ADR-0014 notices is required at submission and the
accepted-at timestamp is stored. Uganda's Data Protection and Privacy Act,
2019 wants consent recorded, not assumed; a boolean the client could have
defaulted to true is not a record, so the server refuses the submission
without it rather than inferring it.

### 6. No status checker, deliberately

An applicant cannot query their own application. There is no endpoint, and
none is planned in this phase.

Answering "what is the status of the application for this email" to an
unauthenticated caller is the same oracle §5 refuses, wearing a different
hat. The office tells people by phone — they collected the number, and
recruitment here is already a conversation.

### 7. Token scope is untouched

ADR-0022's allow-list does not change. The submission endpoint carries no
authentication at all, so there is no token whose scope could reach it, and
the admin endpoints are console-side where an unscoped staff token already
belongs. A driver token remains unable to reach any of this.

## Consequences

A rider recruited at a stage in Kawempe can put themselves in the queue from
their own phone, and the office approves them from the console with the
licence details they verified in person. The Driver App's sign-up screen
stops being a form that explains why it does not work.

The Drivers module gains an inbox. Somebody has to read it — an application
nobody reviews is worse than no form, because the applicant believes they
have applied. Staffing that queue is an operational commitment this ADR
assumes and does not create.

`drivers.manage` plus `staff.manage` is what approving takes, being exactly
what ADR-0016 required to attach an account, because it is the same act.
Reviewing the queue reads under `drivers.view`.

Three things this deliberately does not do, all inherited from ADR-0016 and
all still true: **there is no self-service password reset** — an applicant
who forgets the password they chose before approval is refused a new one and
must be issued one after; **MFA is not required of drivers**, per PROJECT.md
Phase 1; and **an administrator still cannot silently change somebody else's
credentials**.

Google and Facebook sign-in appear on the sign-up screen and are out of scope
here. They mint a principal from an assertion this platform does not yet know
how to verify, and they need their own decision record.

## Alternatives considered

**A `pending` user status.** Rejected in §1: it puts an unapproved principal
in the table every authorisation path reads, and relies on all of them having
learned a third case.

**Creating the `drivers` row at submission, with a `pending` driver status.**
Rejected for the opposite reason to §1 — `drivers` requires a licence number
and expiry, and a self-declared licence number in a table the fleet screen
treats as verified is worse than no row. `drivers.license_number` is also
globally unique, so a mistyped or invented one would block the real holder
from ever being onboarded.

**Approving as a single flag, leaving profile creation to a later screen.**
Rejected in §4: it makes the half-finished state reachable and durable.

**Letting the applicant check their own status.** Rejected in §6 as an
enumeration oracle.

**Emailing the applicant on approval.** Wanted, and blocked: SMTP is ADR-0014
phase 3 and ADR-0013's password reset is already queued behind it. When mail
lands, notifying on approve and reject is the first thing to hang off it. The
phone number is the channel until then, which is why §5 collects it and makes
it required.