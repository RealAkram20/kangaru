# The fleet model plan

> **Read `docs/platform-plan.md` first.** It is the front door for this work now.
> This plan is not retired — `F0`, `F1`, `F2` and `S1` are built and everything
> written about them below still holds. Three things have moved:
>
> - **`F3` is absorbed into package `K8`.** Its §5 question 1 is **answered** —
>   the driver asks, the fleet consents, Kangaru approves, waived where the
>   driver owns the vehicle. Questions 2 and 3 remain open and still block the
>   commission half.
> - **§6's billing deferral is reversed.** *"Kangaru billing a fleet — a
>   subscription or platform fee"* was out because *"the code should not guess"*
>   at a commercial question. The owner decided it on 22 August 2026: free by
>   default, monthly and annual plans above it. ADR-0058 records it; package
>   `K7` builds it.
> - **§4b's blocker number one — no way to create an operator — is package
>   `K2`**, and it is still true until that package lands.

How KangaruRide stops being Shanitah and becomes the system Shanitah runs on,
without a cross-fleet leak on the way.

| Document | What it holds |
|---|---|
| `docs/adr/0055-fleet-operators-above-the-client.md` | The model, and why each part is shaped that way |
| `docs/adr/0056-acting-as-someone-else.md` | How Kangaru's staff reach anything at all |
| **this file** | The packages, their order, their exit criteria |
| `docs/master-plan.md` | Outranks this file wherever they disagree |

---

## 1 · The shape

```
Kangaru — the system. Owns no fleet. Reads across none.
  │   walk-in customers · the public tariff · driver contracts · commission
  │   default zones and vehicle categories · the operators themselves
  │
  ├── Shanitah General Enterprises Ltd        operator 1
  ├── (fleet two)                             operator 2
  │      │  its drivers · its vehicles · its staff · its own zones
  │      │  its rate cards, per client · its contract with each client
  │      │
  │      └── contracts ──┐
  │                      │   a client may contract more than one fleet
  └── (fleet three)  ────┤
                         │
                    Centenary Bank            client (tenant 7)
                      its identity and staff · its places and routes
                      its bookings, trips and invoices — carrying both axes
```

A trip answers two questions independently: **who was it for** (`tenant_id`,
null for a walk-in) and **who ran it** (`operator_id`). Neither is derivable
from the other — that is the whole reason there are two columns.

---

## 2 · Decisions on record

Taken with the owner, 21–22 August 2026. Settled: an agent who disagrees raises
it, and does not re-decide it.

1. **One shared Kangaru**, not a database per fleet. ADR-0055, Alternatives.
2. **A client may contract several fleets.** Two independent axes.
3. **`tenant_id` keeps meaning the corporate client.** The new column is
   `operator_id`. Nothing is renamed. On every screen and in every document the
   words are **fleet** and **client** — never *tenant*.
4. **Walk-ins are Kangaru's**, priced by Kangaru's tariff. Drivers contract
   with Kangaru directly to work them; the driver collects the fare, Kangaru
   takes a commission.
5. **Kangaru owns no fleet and reads across none.** Its staff are head customer
   support and work by acting as a fleet, a client, a customer or a driver.

---

## 3 · The packages

Claim in `docs/agent-worklog.md` before the first edit, as always. Package ids
are `F*` and `S1`, chosen not to collide with the master plan's `A0`/`W*`/`B*`.

### F0 · The spine — blocking

**Nothing else in this plan starts until F0 is done.** It is also the only
package with a deadline: the backfill is trivial while everything genuinely is
Shanitah's, and becomes archaeology the moment a second fleet has rows.

Ships with **exactly one fleet in production and zero behaviour change.** The
second fleet exists only in the test database.

**Owns:** the `operators` migration and model; `operator_id` on `users`,
`drivers`, `vehicles`; `users.access_level`; `app/Support/Access/*` (the new
context and scope); `tests/Feature/Tenancy/*` additions.

#### Four amendments, made while building and recorded here rather than in a commit message

1. **The column and the backfill widen to six tables, not three.** `trips`,
   `bookings` and `invoices` get `operator_id` and the backfill in F0; only the
   *scope wiring* waits for F2. This plan's own deadline argument applied
   unevenly: a backfill is trivial only while every row is Shanitah's, which is
   true of 90 trips, 76 bookings and 48 invoices **today** and never again.
2. **`invoices.operator_id` is nullable in F0**, tightened to NOT NULL in F2.
   Nothing in F0 teaches `InvoiceService` to set it, and a constraint with no
   writer behind it turns the suite red for a rule nobody is yet in a position
   to keep.
3. **No Kangaru account is created.** Every null-client user becomes `fleet` on
   operator 1, *including the Super Admin*. F0's binding constraint is zero
   behaviour change, and a `kangaru` account sees Kangaru's own rows only — so
   promoting the Super Admin here would blank the console for the account that
   runs everything. `kangaru` exists in the enum and the constraint with nobody
   holding it, which is the safe direction for that to default in.
4. **No global fleet scope on `drivers` and `vehicles` in F0.** They gain
   `forActor()` — the shape `User` already uses — and the global scope moves to
   F2 with the rest of the operational surface.

   This is the one amendment worth arguing with, so here is the evidence. Those
   two tables carry **no** global scope today (ADR-0005 removed `tenant_id`),
   so adding a fail-closed one changes behaviour in two ways that F0 must not:

   - **Unbound contexts read nothing.** `AdvanceDispatchOffers` runs every ten
     seconds and reaches drivers through `DispatchOfferService`;
     `AwardWeeklyBonuses` and `CloseStaleDutySessions` do the same through their
     services. A fail-closed scope with no actor bound turns all three into
     no-ops — *"dispatch stalls, no error anywhere"*, which `docs/master-plan.md`
     §W1-a names as the silent failure it most fears.
   - **Relation traversal breaks for clients.** A client reading their own trip
     loads `trip.driver`. Under ADR-0055 §3 a client actor gets no rows from a
     fleet-owned table — correct for a *listing*, wrong for a trip's own driver,
     and §3 does not distinguish the two. That gap in the ADR was found by the
     code, and F2 is where it gets an answer rather than a workaround.

   ADR-0006 needed a whole ADR — `forActor()`, `resolveRouteBinding()` and the
   `BindSubjectTenant` middleware — to make fail-closed workable on the client
   axis. Doing the same for the fleet axis deserves the same care, and it is not
   what F0 is for.

**Shared, with the exact edit named when claimed:** the 35 `isPlatformLevel()`
call sites across 26 files. They are a single mechanical move onto the new
context — list them in the claim, because they touch nine modules.

**Exit criteria:**

- [ ] `operators` exists; Shanitah is row 1; every existing driver, vehicle,
      user and fleet-owned rate card is backfilled to it.
- [ ] `users.access_level` is set on every row and **asserted against the
      columns**, not derived from them.
- [ ] One `AccessContext` with four kinds; the default is `none` and it is
      `1 = 0`.
- [ ] A model with no column for the actor's axis returns **no rows** — proved
      with a client actor against `vehicles`.
- [ ] All 35 call sites moved; none reads `tenant_id === null` for "the house"
      any more.
- [ ] The existing suite is green with **no assertion changed** — only fixtures.
      A changed assertion in F0 is a behaviour change and must be justified in
      the claim.
- [ ] The cross-fleet isolation suite is green, seeding fleet two in tests.
- [ ] **Proved by mutation:** flip the fleet predicate to `>=` or drop it, watch
      the cross-fleet suite go red, restore it. An isolation test that survives
      its own mutation is the lying-test pattern this worklog has caught three
      times.

### F1 · What a fleet owns

**Depends on:** F0.

Zones, settings, vehicle categories and **corporate** rate cards gain
`operator_id`. `Zone::visibleTo` already implements the shape — *"null is the
platform's, or mine"* — and becomes *"null is Kangaru's default, or my
fleet's"*. Copy that pattern rather than inventing a second one.

**The public tariff stays Kangaru's** and gains nothing. A rate card with no
client and no fleet is the walk-in price, which is how it is already stored.

**Exit:** a fleet can define its own zones and price its own clients; it cannot
read or edit another fleet's; it cannot edit the public tariff; it inherits
Kangaru's defaults where it has defined none.

### F2 · A client on more than one fleet

**Depends on:** F0, F1.

- Split client **identity** (Kangaru-level: legal name, registration number,
  address) from the **contract** (per fleet: billing email, credit limit,
  status, dates, rate card). `companies.tenant_id` is `unique()` today and that
  constraint is where the change lands.
- `document_number_sequences` keys on **(fleet, client)** — otherwise two
  fleets billing one client interleave document numbers inside that client's
  ledger, which is the reproducibility `PRODUCT.md` sells.
- The client console gains a **fleet switcher**, not a merged view. One login,
  one fleet in view at a time. The six Centenary columns are unchanged.

**Exit:** Centenary Bank has one login, two contracts, and can see each fleet's
work separately; neither fleet can edit the Bank's identity or see the other's
contract; an invoice from each has its own unbroken number series.

#### Built, and three amendments made while building

**Done and green:** per-(fleet, client) invoice numbering; `credit_notes`
gaining the fleet column F0's six-table list missed; trips stamped with the
fleet **from the driver** rather than the actor; the `operator_client` contract
with its backfill; and — the piece that actually matters for onboarding a
second fleet — **operational reads narrowed to the actor's fleet**, through
`forActor()` *and* route-model binding.

1. **`billing_email` and `credit_limit_minor` override rather than move.** The
   plan said they would leave `companies`. They are inert — model, requests and
   resource, nothing else — but they are *exposed*, so dropping them would
   change the API contract, `openapi.yaml`, `frontend/src/types/company.ts` and
   every screen reading them, for no capability. The contract carries nullable
   overrides instead: null means *use the client's*, exactly as F1's null means
   *use Kangaru's*. When something finally enforces a credit limit, that is
   when they earn a migration.
2. **The fleet switcher is deferred, not built.** One fleet, one contract each
   — a switcher today is a control with a single option, permanent chrome on
   every client page that does nothing. It waits for a client with two
   contracts.
3. **A unique key's column order is not cosmetic.** The numbering migration
   failed on its first run with *"Cannot drop index … needed in a foreign key
   constraint"*, because the replacement key led with `operator_id` and so
   could not carry the `tenant_id` foreign key. Same lesson
   `move_fleet_to_the_platform` recorded in 2026, re-learned. The key leads
   with `tenant_id`.

#### Still open in F2

- **`ZoneResolver::candidates()`** — runs from pricing and dispatch with no
  actor, so it needs the *trip's* fleet rather than the reader's.
- **`RateCardResolver::defaultCardForTenant()`** — two fleets serving one
  client means two default cards, and nothing yet says which prices a trip.
- **`invoices.operator_id` is still nullable.** F0 deferred NOT NULL until a
  writer existed; `InvoiceService` is now that writer, so it can be tightened.
- **Nothing surfaces the contract** — no endpoint, no screen. A client cannot
  see which fleets serve them.

#### The rail is still up, and here is exactly what holds it

Operational reads are now fleet-scoped, which was the dangerous half. What
still prevents a second operator is deliberate: **there is no way to create
one** — no endpoint, no screen, no seeder — and **no Kangaru account can
exist**, because `UserAdminService` throws for a Kangaru actor creating staff.
That second one is S1's to resolve, not F2's.

**Any screen here loads the design skills first** — `screen` (which pulls in
`quality-control`, `DESIGN.md` and `docs/screen-rules.md`) and then
`emil-design-eng`, per the owner's instruction of 22 August. The switcher is a
navigation-level control and touches every client page.

**And it ships instrumented.** Sentry is live on all three apps (ADR-0054) and
the backend now puts `operator_id` and `access_level` into Laravel `Context`
alongside `tenant_id`, so an event can answer *"one fleet's bug or
everyone's"*. A switcher that silently shows the wrong fleet's data is the
worst failure this package can have and the least visible; it needs a
breadcrumb, not just a test.

### F3 · Kangaru's own business

**Depends on:** F0, F2. **Blocked on three open questions** — §5.

- **Driver contracts with Kangaru**: a driver asks, their fleet consents,
  Kangaru approves. Status, commission rate, and any zone or hour limits live
  on the contract.
- **Walk-in dispatch across fleets**: the candidate pool is on-duty drivers
  holding an active contract, ranked as dispatch already ranks. The completed
  trip carries the driver's fleet as `operator_id`, so the fleet sees it on its
  own records with no grant.
- **The depth control**: how much of a walk-in customer's identity a fleet
  office may read on a trip its own driver ran. A Resource-layer allow-list,
  per AGENTS.md — never spread a whole object.
- **The commission ledger**: booked against the driver's wallet (ADR-0029).
- **An explicit channel column** on bookings and trips, so Kangaru's own reads
  do not infer "walk-in" from `tenant_id IS NULL`.

**Exit:** a driver can ask for walk-in work and be approved; a walk-in reaches
a contracted driver across fleets; the fare lands in the driver's wallet with
Kangaru's commission deducted and reproducible; a fleet office sees its own
driver's walk-in trip and **not** the customer's phone number unless Kangaru
granted it.

### S1 · Acting as someone else — **built, 22 August 2026**

**Depended on:** nothing, which is why it was taken while F3's questions were
still open. Without it Kangaru's staff can do almost nothing, so it is the
package that makes ADR-0055's strongest property survivable.

**Done, and green.** `impersonation_sessions`, `audit_logs.impersonator_id`,
`ImpersonationContext`, the `ActAsSubject` middleware, the deny-list, three
endpoints, `php artisan kangaru:create-staff`, and the banner in the console.
Backend 16 tests, frontend 6, both suites whole.

Two things were learned the hard way and are recorded where they will be
found:

- **Excluding `support.act-as` from Super Admin makes it ungrantable.**
  `StoreRoleRequest` refuses a role carrying a permission the author does not
  hold, so nobody could ever grant it. What keeps it narrow is the *level*, not
  the catalogue.
- **Middleware order is the whole of its correctness.** The swap must run
  before `IdentifyTenant` or the session carries the actor's fleet; the
  deny-list must run before `SubstituteBindings` or a refusal is hidden behind
  a 404 for a record that does not exist.

**Exit:**

- [ ] `audit_logs.impersonator_id` exists and **every** audit reader renders
      both identities. A reader showing only `user_id` after this ships is
      worse than before it shipped.
- [ ] Session start and end are audited, not only the acts inside.
- [ ] The deny-list returns 403 with a reason naming the session.
- [ ] **Proved by test:** a support agent acting as Finance cannot approve a
      settlement — a denied act stays denied while acting as somebody who holds
      the permission. Nobody writes this test by habit; it is the one that
      makes ADR-0056 §3 real rather than a comment.
- [ ] Duty, offers, presence, location and devices are read-only in an
      acting-as session.
- [ ] The banner ships with the session, built through `screen` and
      `emil-design-eng` — it is a persistent piece of chrome on every page, so
      it is exactly the kind of component the owner's 22 August instruction is
      about. A time-boxed privilege with no visible indicator is the half-built
      loop `docs/master-plan.md` §2 forbids.
- [ ] Every acting-as session is a Sentry breadcrumb, and its events carry the
      impersonator alongside `operator_id` and `access_level`. Support acting
      as somebody is the state in which a confusing error is most likely and
      hardest to reconstruct afterwards.
- [ ] W1-e's privacy notice says this happens, and the retention policy covers
      the records.

---

## 4 · The F0 hazard checklist

The failure this plan most has to survive, written out so it cannot be
discovered halfway:

**Every one of Shanitah's employees today is a `tenant_id IS NULL` row.** Under
ADR-0055, "no client and no fleet" describes Kangaru — the most privileged
account in the system.

So a backfill that misses one row **silently promotes a fleet dispatcher to
head office, and nothing fails.** The account simply starts working better than
it should, which is the failure mode nobody reports.

Before F0 closes:

- [ ] Count `users WHERE tenant_id IS NULL` **before** the migration. Write the
      number in the worklog entry.
- [ ] Every one of them is either backfilled to operator 1 or deliberately named
      as Kangaru staff. The two lists together equal the number above.
- [ ] `PlatformStaff::holding()` no longer finds people by `whereNull('tenant_id')`.
- [ ] A test asserts that a user with `access_level = fleet` and a null
      `operator_id` **cannot be saved**. The invariant belongs in the database,
      not in a reviewer's memory.
- [ ] Run the same count against the **deployed** database, not only the test
      one. The master plan's §5 gate already requires isolation green against
      the deployed database; this is the same rule, one level up.

---

## 4b · Where this stood at 05:00 on 22 August 2026

Written at the end of a long night so the next person — or the same one after
sleep — does not have to reconstruct it from the worklog.

| Package | State |
|---|---|
| **F0** the spine | done, green |
| **F1** what a fleet owns | done, green |
| **F2** a client on more than one fleet | backend done; **the fleet switcher is deliberately not built** |
| **S1** acting as someone else | done, whole loop, banner included |
| **F3** Kangaru's own business | not started, blocked on §5 |

### The switcher is deferred on purpose

There is one fleet and every client has one contract, so a switcher today is a
control with a single option — permanent chrome on every client page that does
nothing. It waits for a client with two contracts to switch between. Deferring
it is not a gap in F2; building it would have been.

### What still blocks a second fleet existing

1. **No way to create an operator.** No endpoint, no screen, no seeder — the
   rail F0 put up, and it still holds.
2. **Trip children are not independently fleet-scoped.** `trip_events`,
   `trip_locations` and `trip_stops` are reached through a trip, and the trip
   is now the gate — but nothing scopes them in their own right.
3. **Nothing has run in CI.** See below; this is the largest single risk.

### The risk that outranks the rest

**None of this has been through CI.** Everything is verified on **MariaDB
10.4**; CI runs **MySQL 8.4**. Three pieces lean on where those differ:

- the `users_access_level_matches_columns` **CHECK constraint**,
- the **generated `operator_scope` column** that makes uniqueness work against
  nullable fleets,
- and a **`DATETIME` vs `TIMESTAMP`** default that was only found by failing —
  MySQL and MariaDB give the second non-nullable `TIMESTAMP` in a table an
  implicit zero-date default that strict mode rejects.

CI also gates on **migration reversibility**, which is precisely where an
engine difference surfaces. Eleven migrations landed across F0–S1; every one
round-trips locally and none has been watched anywhere else.

**Recommendation: get this through CI before starting F3.** The risk grows with
every migration added on top of it.

---

## 5 · Open, and the owner's call

These block **F3 only.** Each carries the recommendation given when it was
raised, so silence has a safe default rather than none.

| # | Question | Recommended |
|---|---|---|
| 1 | Does a driver's fleet have to consent to their Kangaru contract? | Fleet consent, then Kangaru approval — waived when `drivers.owns_vehicle` is true |
| 2 | Who wins when a fleet's corporate booking and a Kangaru walk-in want the same on-duty driver? | The fleet's own work, overridable per contract |
| 3 | Does the fleet get a share of a walk-in run on its vehicle? | A fleet share on the contract, defaulting to zero — so the column exists before the argument does |

---

## 6 · Explicitly not in this plan

- **Renaming `tenant_id`.** Out permanently, not deferred. ADR-0055 §1.
- **A database per fleet.** Kept only as ADR-0001's escape hatch, one level up.
- **Kangaru billing a fleet** — a subscription or platform fee. Walk-in
  commission is decided; what a fleet pays to be on Kangaru is a commercial
  question, and the code should not guess at it.
- **Per-fleet branding in the driver app.** One app, one brand, for now.
- **A fleet acting as its own staff or drivers.** ADR-0056, Scope.
- **Anything in the master plan's own go-live sequence.** This plan does not
  reorder `A0`, `W1-*`, `W2-*` or Track B, and F0 does not start while `A0` is
  unfinished.
