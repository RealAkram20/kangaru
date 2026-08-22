# ADR-0055: Fleet operators, above the client

**Status:** Accepted (22 August 2026)

**Amends:** ADR-0001 (multi-tenancy model), ADR-0006 (platform staff and
cross-tenant reads). Tenant scoping stands and still fails closed; a second
axis is added beside it.

**Reverses:** ADR-0005's premise. That ADR's opening sentence — *"The business
is a ride-hailing and vehicle-hire operator — Faras, Uber, Bolt, SafeBoda —
**not a product sold to fleet operators to run themselves**"* — is now false.
It is struck here rather than edited there, so the reversal stays legible: it
was right when it was written, and what changed is the business, not the
reading.

## Context

The owner, 21 August 2026: *"We have the main system, Kangaru. But we have
fleet companies like Shanitah General Enterprises Ltd, and more companies are
coming. These are fleet companies who provide the transportation services, so
Kangaru is the system that does management."*

This is less of a new direction than it looks. `PROJECT.md` has always listed
**Fleet Owners**, **Transport Providers** and **Logistics Companies** among the
organisations the platform would serve, and its Vision names *"organizations,
fleet owners, drivers, and passengers"*. ADR-0005 narrowed that away for a
correct reason at the time — every client had been given a private fleet, which
was a misreading — and the narrowing has now outlived the mistake it fixed.

### Shanitah exists only as `NULL`

The single most important fact for anyone implementing this, and it is not
visible from the ADRs alone:

- `User::isPlatformLevel()` is literally `tenant_id === null`. **35 call sites
  across 26 files** key on it (37 references, two of them docblocks).
- `PlatformStaff::holding()` finds Shanitah's own employees with
  `whereNull('tenant_id')`.
- Five tables already use a null tenant to mean *"the platform's"*. The walk-in
  tariff migration says so in its own docblock: *"the fourth time this schema
  has done it — `drivers`, `vehicles`, `order_requests` and `trips` all use a
  null tenant to mean 'the platform's'."*

**There is no Shanitah row anywhere.** Shanitah is the absence of a row. So
this change is not "add another company"; it is *give Shanitah an identity for
the first time*, and make every place that reads "no client = the house" start
reading "no client = **which** house?".

### The two axes do not nest

A trip already answers *who was this for* (`tenant_id`, null for a walk-in). It
must now also answer *who ran it*.

Those cannot be collapsed into a hierarchy, because the owner has settled that
**a corporate client may contract more than one fleet**: Centenary Bank served
by Shanitah and by a second operator on the same Kangaru. If the fleet could be
derived from the client, one column would do. It cannot, so two are needed, and
they are independent.

## Decision

### 1. `operator_id` is a new axis; `tenant_id` keeps its meaning

A new `operators` table holds fleet companies. **Shanitah is row 1.**
`tenants` continues to mean *corporate client*, unchanged, across 20 models and
43 migrations. Nothing is renamed.

The word in code therefore stays wrong in one direction, and it is worth
recording why rather than leaving it to look like an oversight. The owner's own
vocabulary now uses *"tenant"* for the fleet company — the exact opposite of
what the column means. Renaming `tenant_id` across 43 migrations, 20 models,
the frontend and the mandatory isolation suite is the most dangerous refactor
available in this codebase, and a half-applied rename of the one column that
stops a client reading another client's data is how the worst bug ships.

**So: in code, `tenant_id` is the corporate client. In every document, screen
and conversation, the words are "fleet" and "client" — never "tenant".** That
rule already governs client-facing copy by the owner's instruction; it now
governs ours too, and for a sharper reason.

### 2. Four access kinds, and none of them is "everything"

One `AccessContext`, holding a *kind* rather than two nullable integers:

| Kind | Predicate | Set by |
|---|---|---|
| `none` — the default | `1 = 0` | nothing; it is what you get by not binding |
| `fleet(id)` | `operator_id = id` | middleware, from the actor's row |
| `client(id)` | `tenant_id = id` | middleware, from the actor's row |
| `kangaru` | Kangaru's own rows only | middleware, from `access_level` |
| *acting as* | the assumed identity's own predicate | ADR-0056 |

ADR-0006's load-bearing property survives intact. Its Decision 1 rejected
"treat a null context as *see everything*" because it converts every forgotten
`set()` from a visible nothing into a silent everything. That reasoning applies
unchanged one level up, so **`kangaru` is not the absence of a binding.** It is
a binding, declared positively, and it selects *Kangaru's own rows* — the
public tariff, walk-in customers, driver contracts, the operators themselves,
the commission ledger — not everyone's.

The result is stronger than what ships today. Today a null `tenant_id` plus the
right permission reads every client's trips. Under this decision **no account
in the system can read every fleet's data in one query, including Super
Admin.** Kangaru's staff reach a fleet's data by acting as that fleet
(ADR-0056), which is auditable and time-boxed, or not at all.

**One deliberate exception, narrow and named.** Kangaru bills commission on
walk-in work, and a completed walk-in carries the `operator_id` of the fleet
whose driver ran it. So the `kangaru` predicate is *"rows Kangaru owns, **or**
rows whose channel is walk-in"*. That requires an **explicit channel column**
on bookings and trips rather than inferring the answer from `tenant_id IS
NULL`. The inference is true today and would quietly stop being true the first
time a client-less booking exists for some other reason — and it would stop
being true silently, in the one predicate that decides what head office reads.

### 3. If the model has no column for the actor's axis, the answer is no rows

`vehicles` has no `tenant_id`. A corporate client's administrator querying it
gets `1 = 0` — **not** an unscoped read.

Stated as a rule because the wrong version arrives by accident rather than by
choice: a scope written as "apply whichever axes this table has" silently
returns *everything* to an actor whose own axis is absent from the table. That
is one careless helper away, and it fails open.

### 4. The Kangaru level is declared, never inferred

Add `users.access_level` — `kangaru` | `fleet` | `client` — asserted against
the columns rather than derived from them.

This is a migration hazard, not a matter of taste. **Every one of Shanitah's
employees today is a `tenant_id IS NULL` row.** Under this ADR, "no client and
no fleet" describes Kangaru: the most privileged account in the system. A
backfill that misses a single row silently promotes a fleet dispatcher to head
office, and *nothing fails* — the account simply starts working better than it
should, which is the failure mode that is never noticed. `PlatformStaff` looks
its people up by exactly that predicate and would begin finding the wrong ones.

Two things share one shape and must not share one meaning: **both-null on a
row** is Kangaru's unclaimed walk-in; **both-null on a user** would be head
office. Only the second is dangerous, and only the second is declared.

### 5. Who owns what

| Owner | Owns |
|---|---|
| **Kangaru** | the operators; walk-in customers; the public tariff (a rate card with no client — already how it is stored); driver contracts; commission; the default zones and vehicle categories fleets inherit |
| **A fleet** | its drivers, its vehicles, its staff, its own zones, its rate cards for its own clients, and its contract with each client |
| **A client** | its identity and its staff; its places and routes; its bookings, trips and invoices — which carry both axes |
| **A driver** | belongs to one fleet; may separately hold a contract with Kangaru (§7) |

**The public tariff stays Kangaru's.** Fleets price their own corporate
clients; nobody prices a walk-in but Kangaru, because Kangaru owns the
customer. This is already how `rate_cards.tenant_id IS NULL` behaves, so it
needs no migration — only an `operator_id` that stays null beside it.

### 6. A client's identity is not a fleet's to edit

Because a client may contract two fleets, the client record belongs to neither.
Fleet A editing Centenary Bank's legal name would rewrite Fleet B's client — a
cross-fleet **write**, and the mirror of the read leak ADR-0001 calls the worst
bug this platform can have.

So the two halves separate:

- **Identity** — legal name, registration number, address — is the client's
  own, anchored at Kangaru level. This is what ADR-0001 built `tenants` for:
  *"the lean identity anchor"*.
- **The relationship** is the fleet's — billing email, credit limit, status,
  contract dates, and which rate card applies.

Those relationship fields sit on `companies` today, and `companies.tenant_id`
is `unique()`. That constraint is where the change lands.

### 7. Walk-ins belong to Kangaru, and reach drivers by contract

A walk-in is Kangaru's customer, priced by Kangaru's tariff. It reaches a driver
**not** by Kangaru granting a *fleet* access to demand, but by the **driver**
holding a contract with Kangaru: their fleet onboards them, they ask to work
walk-ins, Kangaru approves.

The owner's words: *"When any fleet manager onboards their own driver, this
driver can request to work with Kangaru at large so that they can start working
walk-ins."*

Three things fall out of that, and they make the feature considerably smaller
than the fleet-grant version it replaces:

- **A walk-in run by Fleet A's driver carries `operator_id` = Fleet A.** The
  fleet sees it on its own records — mileage, fuel, vehicle utilisation — with
  no grant of any kind. Its vehicle did the work; of course it appears.
- **"Fully or partial" is therefore a depth control, not a breadth one.** The
  question is how much of the walk-in customer's identity a fleet office may
  read on a trip its own driver ran — name, phone, exact addresses. That is a
  Resource-layer allow-list, **not** a query scope, and it obeys AGENTS.md's
  existing rule: allow-list fields, never spread a whole object. Breadth
  constraints — zones, hours — live on the driver's contract instead.
- **The driver collects the fare; Kangaru books a commission** against the
  driver's wallet ledger, which already exists (ADR-0029). The contract is with
  the driver, so the deduction is the driver's.

Three questions inside this are genuinely open and are named in Scope rather
than decided here.

## Consequences

**Phase 0 has a deadline nothing else in this plan has.** Backfilling every
vehicle, driver, user and rate card to `operator_id = 1` is trivial *today*,
because everything genuinely is Shanitah's. The moment fleet two has data it
becomes archaeology, and archaeology on the column that separates two
competitors' operations is not a thing to attempt. The spine goes in while
there is still exactly one fleet, ships with zero behaviour change, and proves
itself against a second fleet that exists only in tests.

**The isolation suite gains a second half, not a hole.** ADR-0001's mandatory
cross-tenant suite keeps asserting that a client sees only its own. It is
joined by the cross-*fleet* mirror, and by ADR-0006's own obligation restated
one level up: a fleet account with no permission on a surface must be proved to
see nothing of it either. The second fleet is seeded in tests while production
has one, or the suite proves nothing.

**Two global scopes both fail closed**, so a job or console command that binds
neither reads nothing at all. That is the trade ADR-0006 already accepted once
and it is accepted again deliberately: a visible nothing is debuggable, a
silent everything is a breach.

**Global uniqueness becomes an existence oracle across fleets.** Since
ADR-0005, `vehicles.registration_number` and `drivers.license_number` are
globally unique. Fleet B registering a plate Shanitah already runs is told it
is taken and learns something about a competitor. **Kept global** — a plate
really is unique in Uganda under any reading, and two fleets claiming one plate
is a worse failure than the inference — but recorded here as a known and
accepted leak rather than found later and mistaken for a bug.

**Invoice numbering must key on (fleet, client).** `document_number_sequences`
is per client today, so two fleets billing one client would interleave document
numbers inside that client's ledger — which is exactly the reproducibility
`PRODUCT.md` sells.

**The client console gains a fleet switcher, not a merged view.** The owner
chose one login with a fleet picker over a merged cross-fleet report. Each
fleet's data stays visually separate, the six Centenary columns are unchanged,
and the client adds up their own cross-fleet total.

**Kangaru's own revenue becomes a real object, earlier than expected.** Nothing
in the schema bills a fleet or a driver, because until now Shanitah's revenue
*was* the trips. Walk-in commission is the first thing Kangaru is owed, and the
driver wallet ledger books a number for every completed trip whether the
commission was decided or not.

**Dispatch has two overlapping pools.** Corporate work goes to the fleet's own
on-duty drivers; walk-in work goes to contracted drivers across fleets. One
driver can be eligible for both at the same moment, which is a new question
dispatch has never had to answer.

## Scope

**In:** the `operators` table; `operator_id` on the fleet-owned tables;
`users.access_level`; the `AccessContext` and its scope; moving the 37
`isPlatformLevel()` call sites onto it; fleet-owned reference data; the client
identity/contract split and the fleet switcher; driver contracts with Kangaru;
walk-in dispatch across fleets; commission; and the cross-fleet isolation
suite. Sequenced in `docs/fleet-model-plan.md`.

**Out, deliberately:**

- **Acting as another user.** ADR-0056, because it reverses a stated position
  and has no dependency on any of this.
- **Renaming `tenant_id`.** Decision 1, and it is out permanently rather than
  deferred.
- **A database per fleet.** See Alternatives.
- **A fleet's own branding on the driver app.** One app, one brand, for now.
  Real, and not on the critical path.
- **Kangaru billing a fleet** — a subscription or a platform fee. Walk-in
  commission is decided; what a fleet pays to be on Kangaru is not, and it is a
  commercial question the code should not guess at.

**Open, and the owner's call. These block Phase 3 only** — Phases 0 to 2 do not
depend on any of them. Each carries the recommendation given when it was
raised, so silence has a safe default rather than no default:

1. **Does a driver's fleet have to consent to their Kangaru contract?** The
   vehicle is usually the fleet's, so its fuel and its tyres do the walk-in.
   *Recommended:* fleet consent, then Kangaru approval — waived when
   `drivers.owns_vehicle` is true (ADR-0048 §7), where the fleet has little
   standing.
2. **Who wins when a fleet's corporate booking and a Kangaru walk-in want the
   same on-duty driver?** *Recommended:* the fleet's own work, overridable per
   contract.
3. **Does the fleet get a share of a walk-in run on its vehicle?** As drafted,
   the driver takes the fare and Kangaru the commission, and the fleet gets
   wear. *Recommended:* a fleet share on the contract, defaulting to zero, so
   the column exists before the argument does.

---

## Amendment, 22 August 2026 — a fourth level, `APPLICANT`

Written the same day as the ADR, because §4 met a case it had not accounted
for and the answer belongs here rather than in a worklog entry.

### What happened

Another session built an account for a driver applicant **at submission time**,
so that a reviewer could refuse one blurry licence without refusing the whole
person. A driver applicant's fleet is chosen by the reviewer *at approval* — 
`DriverApplicationService` says so at the call site — so at submission it is
genuinely unknown rather than absent.

Under §4 as written, "no fleet and no client" is **Kangaru**. So the feature
would have filed every stranger who filled in the public form as head office.

`User::levelFor()` refused it on the first run, with the message it was written
for, and that session withdrew the change rather than working around the guard.
Recorded here as the good news it is: the guard was hours old and it caught a
real promotion attempt from a direction nobody predicted.

### Decision

A fourth case, `AccessLevel::APPLICANT`, with the same column shape as
`KANGARU` — no fleet, no client — and the `CHECK` constraint widened by one
clause.

**This costs §4 nothing, and that is the whole argument.** §4's rule was never
*"there are three levels"*. It is that **the level is declared, never
inferred**. Two nulls still cannot become head office by omission; they now
cannot become an applicant by omission either. `levelFor()` throws on an
undeclared account exactly as before.

**`APPLICANT` grants nothing.** An applicant's reach is keyed entirely off
their own id — their own application, and no more. That is not a scoping
question at all; it is the shape `Customer` already has (ADR-0013), which is
why a walk-in is not a `users` row. Concretely:

- `AccessContext` leaves an applicant **unbound** — the fail-closed state, so
  every tenant-scoped and fleet-scoped read returns nothing.
- `isPlatformLevel()` stays `=== FLEET`. An applicant never inherits a fleet's
  reach.
- `User::forActor`, `BelongsToOperator::forActor` and
  `InheritsKangaruDefaults::visibleToActor` each return no rows for them.

### Alternatives considered, and why they lost

**Presume the one fleet that exists today.** One line, works now. Rejected: it
is precisely the silent inference §4 exists to prevent, and it would
pre-answer a question §7 explicitly leaves to F3 — which fleet a
self-registering driver joins.

**No account until approval; extend the claim ticket instead.** Genuinely
viable, touches none of this ADR, and would have been the recommendation had
the owner not already chosen an account. Their call stands.

**A nullable `access_level`.** Rejected on sight: it reintroduces "the level
is absent" as a storable state, which is the one thing the column exists to
make impossible.

### Consequence

The exhaustive `match` on `AccessLevel` in four files is now doing real work as
a safety net rather than as style: adding the case turned every one of them
into a compiler error until it was handled, which is how a fourth level can be
added to a security-critical enum in one pass without anything being missed.

---

## Alternatives considered

**A database, or a deployment, per fleet.** Genuinely competitive, and rejected
on the owner's answer rather than on principle: it makes a cross-fleet leak
impossible by construction, needs almost no change to the 20 tenant-scoped
models, and matches the master plan's own instinct for isolated containers. It
cannot express a driver working walk-ins across fleets, a client contracting
two fleets, or one Kangaru that sees its own business — all three of which the
owner asked for. Kept as ADR-0001's escape hatch, one level up: every query
being fleet-scoped is what would make extraction possible if a fleet ever
demands physical isolation.

**Rename: the fleet becomes the tenant, the client becomes `client_id`.**
Truthful — the outermost isolation boundary really is the fleet now — and
rejected in Decision 1 on blast radius. The honest cost is that the code's word
and the owner's word mean opposite things for the life of the project.

**Reuse `tenants` with a `kind` column and a self-reference.** One table, no new
scope. Rejected for the reason ADR-0005 and ADR-0006 both already rejected it
for the fleet: `TenantScope` would mean two different things depending on the
row, and the exception would be permanent and load-bearing.

**Kangaru staff with a cross-fleet read, instead of acting as.** The obvious
shape, and what this ADR was being drafted toward. Rejected once the owner said
Kangaru is head customer support: it would reintroduce the "no predicate" state
ADR-0006 refused, and it is strictly weaker — an audited act-as leaves a name
in the client's own trail, a cross-fleet SELECT leaves nothing.

**Kangaru grants each fleet access to walk-in demand, fully or partially.**
What §7 was before the owner described driver contracts. It needed a grant
object with breadth *and* depth, a fleet-mediated dispatch hop that costs a
waiting rider real minutes, and an answer to "which fleet gets this job" that
nobody wanted to give. Driver contracts answer all three by moving the
relationship to the person who actually drives.
