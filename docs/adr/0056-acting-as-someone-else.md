# ADR-0056: Acting as someone else

**Status:** Accepted (22 August 2026)

**Reverses:** a position stated twice in code and once in a README —
`Modules/Customers/Routes/staff.php`: *"Nothing here lets staff act as a
customer — no password reset, no impersonation, no editing somebody else's
profile"*, and `AuthController::changePassword`: *"An admin silently resetting
someone else's password is the one act an audit trail cannot tell apart from
impersonation, so this module does not offer it."*

**Related:** ADR-0055 (fleet operators), which depends on this for Kangaru's
staff to be able to do anything at all; ADR-0006, whose principle about a
client seeing who touched their data is the load-bearing rule here.

**Extended by:** ADR-0066 (26 August 2026), which delivers the **walk-in** of
the four populations quoted below. This ADR's morph anticipated it and its
middleware did not, so `ActAsSubject` carried a comment saying so; that comment
is gone. Nothing here is reversed — §3's rule, §5's time-box and disclosure and
§6's grant all apply unchanged to a `Customer` subject. §4's driver read-only
rule deliberately does **not** transfer, and ADR-0066 §2 argues why.

## Context

ADR-0055 gives Kangaru no fleet, no cross-fleet read and no operational console
of its own. The owner's description of what its people actually do:

> *"Kangaru does not own a fleet but can log in as. For all the other levels —
> can log in as to any fleet, corporate client, walk-in client and drivers, as
> the head customer support purpose."*

That is the whole justification for the strongest property in ADR-0055: **no
account can read every fleet's data in one query.** Head office reaches a
fleet's world by becoming someone inside it, briefly and on the record, or not
at all.

### The refusal is the specification

Impersonation is not missing from this codebase by oversight. It was refused,
and the refusal names its own condition: an administrator resetting a password
is *"the one act an audit trail cannot tell apart from impersonation"*. The
objection is not to impersonation. It is to impersonation that the trail cannot
distinguish from the person's own hand.

So the requirement is not "build impersonation". It is **build impersonation
that an audit trail can tell apart**, at which point the stated objection is
answered rather than overruled. Everything below follows from that single
sentence.

ADR-0006 already committed the platform to the principle from the client's
side: *"A client must be able to see who touched their data, including when it
was us."* This ADR is that promise, kept under a harder case — because now
"us" can look exactly like "them".

## Decision

### 1. Acting as is a session, and the actor inherits the subject's reach exactly

A Kangaru user signs in as themselves, then starts an *acting-as* session
against a subject. For the duration:

- **`AccessContext` is the subject's.** A support agent acting as a Fleet
  dispatcher gets `fleet(1)`; acting as a Bank administrator, `client(7)`.
  Scoping, route-model binding and policies behave exactly as they do for the
  subject, because they are looking at the subject.
- **Permissions are the subject's, and only the subject's.** Not the union.
  The actor's own `kangaru` reach is set aside entirely while the session is
  open. Otherwise acting-as is privilege escalation wearing a support badge:
  the one account that can become anyone would also carry its own powers into
  every room it entered.
- **It does not chain.** You cannot act as someone who is themselves acting as.
- **It never mints a client-app token.** Acting-as runs in the console. This is
  most of the answer to §4 below, and it costs nothing: the console can call
  the same `me.*` endpoints to show a support agent exactly what a driver sees.

### 2. The audit trail carries both hands

`audit_logs` today has `user_id`, `tenant_id`, the `auditable` morph, `action`,
`changes` and `ip_address`. It gains **`impersonator_id`**, nullable, and by
ADR-0055 it gains `operator_id` alongside `tenant_id` like every other scoped
table.

- `user_id` stays the **subject**, so a client's own trail reads naturally and
  chronologically — the account did a thing.
- `impersonator_id` names the **real hand**.
- Rendered, in the client's own audit view: *"Kangaru Support (acting as J.
  Okello)"*. Never one without the other.

**Starting and ending a session are themselves audited**, not only the actions
inside one. A session that opened, looked, and changed nothing must still leave
a record — reading a bank's trip history is the act, whether or not anything
was written.

This is the decision that answers `AuthController`'s objection. With it, the
trail can tell the two apart; without it, this ADR is the thing that module
refused to build.

### 3. Some acts are never available while acting as

The rule, rather than only the list: **anything whose entire purpose is to
prove it was the person themselves.**

| Denied while acting as | Why |
|---|---|
| Changing a password | The exact act `AuthController` refused, and the reason this ADR exists |
| Enrolling or disabling MFA, spending recovery codes | Same, and it would defeat ADR-0008 |
| Changing a payout destination (ADR-0042) | Support must never be able to move where a driver's money goes |
| Requesting or cancelling account closure (ADR-0043) | Irreversible, and the person's alone |
| Approving a settlement, issuing a credit note | Money leaving the platform on a borrowed identity is the classic fraud path |
| Going on duty, answering an offer, sending presence, registering a device | §4 |

A denied act returns 403 with a reason naming the acting-as session, so the
support agent is told *why* rather than left thinking the feature is broken —
which is how deny-lists get worked around.

### 4. Acting as a driver is read-only on everything live

The sharpest edge, and the one that would have shipped as a real incident.

The driver app registers a push device on sign-in (`me.devices.store`) and
receives live job offers, which ADR-0024 and ADR-0025 make time-boxed and
consequential. A support agent acting as a driver could therefore:

- **register their own handset**, putting a real customer's pickup address on a
  support agent's lock screen — the precise failure ADR-0025 already guards
  against for shared depot handsets, arriving through a different door; or
- **accept an offer**, silently taking a job from a driver on the road. The
  trip is then assigned to somebody who is not driving, and a customer waits
  for a car that was never dispatched.

So duty, offers, presence, location and devices are **read-only** in an
acting-as session. Support sees what the driver sees and cannot act in traffic.
Decision 1's "never mints a client-app token" makes this mostly structural
rather than a list to remember, which is the safer of the two.

### 5. Time-boxed, visible, and disclosed to the person

- **Time-boxed.** A session expires on its own — thirty minutes is the
  proposed default — and ends when the actor signs out. An acting-as session
  that outlives the support call is an unattended key.
- **Visible to the actor.** A persistent, unmissable banner in the console for
  the whole session, naming the subject and offering one obvious way out. When
  this is built it goes through the `screen` skill and `quality-control` like
  any other surface: design tokens, Lucide icons, no emoji, and copy that says
  *client* and *fleet* rather than *tenant* (ADR-0055 §1).
- **Disclosed to the subject.** Always in their own audit trail. For
  individuals — drivers and walk-in customers — also a notification that their
  account was accessed by Kangaru support, using the notification loop that
  already exists (ADR-0039).

The last point is not only courtesy. Acting as a data subject's account is
processing their personal data under the Uganda **Data Protection and Privacy
Act, 2019**, which the master plan already puts on the critical path for W1-e.
The privacy notice must say this happens, and the retention policy must cover
the acting-as records. Cheaper to write into the notice now than to add to one
already published.

### 6. Who may do it

`access_level = kangaru` **and** a distinct permission — `support.act-as` —
which is not implied by any other. Not every Kangaru employee, and never by
being an administrator in general.

ADR-0006 said creating a platform account should be Super Admin's alone. That
was written when a platform account could read every client; under ADR-0055 it
can read almost nothing, and *this* permission is what restores reach. The
seriousness moves with it.

## Consequences

**Kangaru needs very little data model of its own.** This is the payoff, and it
is large. Head office's screens are: the fleets, driver contract requests, the
walk-in queue and tariff, the commission ledger — all Kangaru-owned rows — plus
a search that finds a person and a button that becomes them. No cross-fleet
reporting layer, no mirrored console per fleet, no second copy of dispatch.

**The `kangaru` access kind stays honest.** Without acting-as, the pressure to
give head office "just a read" on trips would be immediate and constant, and
each grant would be individually reasonable. This is the pressure valve, and it
is the one that leaves a name in the client's trail.

**Every audit reader changes.** `AuditLogController`, the client's own audit
view and any export must render both identities. A reader that shows only
`user_id` after this ships is *worse than before it shipped*: it displays a
support agent's action as the client's own, with full confidence.

**Support gains the ability to break things convincingly.** A well-meaning
agent acting as a dispatcher can assign the wrong driver to a real booking, and
the fleet's trail will say their own dispatcher did it — correctly, and with
the impersonator named beside it, which is exactly why Decision 2 is not
optional.

**Testing needs a case nobody writes by habit.** That a denied act stays denied
*while acting as someone who holds the permission*. A support agent acting as
Finance must be proved unable to approve a settlement, or Decision 3 is a
comment.

## Scope

**In:** the acting-as session and its context; `audit_logs.impersonator_id`;
the deny-list and its 403; the driver read-only rule; the time-box, the banner
and the subject's disclosure; the `support.act-as` permission; and the tests
for all of it, including the one in Consequences.

**Out, deliberately:**

- **A fleet acting as its own staff or drivers.** A real want — a fleet manager
  debugging a driver's app — and out of this pass. It is a different trust
  question: Kangaru acting as a fleet's user is a supplier touching a client's
  data with disclosure; a fleet acting as its own employee is an employer, and
  Uganda's employment expectations are not something this ADR has a view on.
- **Acting as with the subject's live consent** — a "may we access your
  account?" prompt the person answers. Better for a support call in progress,
  useless for an account whose owner cannot be reached, which is when support
  most needs it. Worth revisiting once the notification loop proves out.
- **Screen recording or session replay of an acting-as session.** More
  surveillance than the case needs, and it would itself capture the client
  personal data this ADR is trying to keep accountable.
- **Any change to `changePassword`.** It stays exactly as it is: your own
  password, no user parameter. This ADR does not reopen it — it puts the act on
  the deny-list, which is the same answer arrived at from the other side.

## Alternatives considered

**Keep the refusal; give Kangaru a cross-fleet read instead.** The obvious
alternative, and the one ADR-0055 was drafted toward. Rejected because it is
strictly weaker in the property that matters: a cross-fleet `SELECT` leaves
nothing in the client's trail, while an acting-as session leaves a name, a
time and a reason. It also reintroduces the "no predicate" access state
ADR-0006 refused for good reason.

**Support tickets and screenshots instead of access.** No new privilege at all,
and it is what happens today. Rejected on the evidence of ADR-0044 — the owner
built the whole driver issue-reporting loop precisely because "phone the
office" was not working. Asking a driver upcountry on a patchy network to
screenshot their way through a problem is the same failure in a different
place.

**A read-only acting-as, with no writes ever.** Genuinely tempting, and much of
the risk disappears. Rejected because roughly half of what support does is
*fix* the thing — re-issue the booking, correct the address, clear the stuck
state — and a support tool that can only watch sends every real fix back to an
engineer with database access, which is a worse audit story than the one this
ADR is buying.

**One `platform.*` super-permission that both reads across fleets and acts as.**
Rejected for the reason ADR-0006 rejected the blanket `platform.crosstenant`:
a single grant that hands over everything at once means the first person who
needs half of it gets all of it.
