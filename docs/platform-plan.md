# The platform plan

**Kangaru above the fleets.** One plan, ten packages, built by parallel agents
in one shared tree.

This is the front door for everything in `K0`–`K9`. Where it disagrees with an
older plan, **this file wins for K work only** — it does not reorder `A0`,
`W1-*`, `W2-*` or Track B, and it does not touch the master plan's §1 decisions
or §2 completeness gate. Those still outrank it.

| Document | Still holds | Relationship to this plan |
|---|---|---|
| `AGENTS.md` | Engineering standards, Definition of Done | **Outranks this file.** §2 below extends its DoD; it does not replace it. |
| `PRODUCT.md`, `DESIGN.md` | Product truth, palette and type | **Outrank this file.** |
| `docs/master-plan.md` | §1 decisions, §2 completeness gate, go/no-go | **Outranks this file.** K packages sequence separately from §3. |
| `docs/agent-worklog.md` | Who holds which files, right now | **Binding.** Claim before you edit, always. |
| `docs/screen-rules.md` | How to build a screen, incl. **§9 clean screens** | **Outranks any mockup**, including anything drawn for this plan. |
| `docs/fleet-model-plan.md` | `F0`–`F2`, `S1` — all built | `F3` is absorbed into `K8`. §6's billing deferral is reversed by ADR-0058. |
| `docs/corporate-client-panel-plan.md` | The client panel against Centenary's letter | Its client is now onboarded by a **fleet**, not by Kangaru — `K6`. |
| `docs/go-live-plan.md`, `docs/track-a-parallel-plan.md`, `docs/ux-audit-plan.md` | Track A/B, briefs, the audit | Unchanged. K work does not enter their sequence. |
| `docs/feature-completeness.md` | The half-built census | Its rule — a loop with four parts — is gate 1 of §2 below. |
| `docs/measured-distance-plan.md`, `docs/distance-and-fare-integrity-plan.md` | Fare integrity | Unchanged, and unblocked by none of this. |
| `docs/driver-app-background-offers-plan.md` | The offer that never left the server | Unchanged. Driver-app work, separate tree of concerns. |
| `docs/security-gate.md`, `docs/data-inventory.md`, `docs/runbook.md` | The gate, the register, 2am | Unchanged. `K2` and `K6` add rows to the data inventory. |

**ADRs this plan rests on:** 0055 (fleets above the client), 0056 (acting as
someone else), **0058** (what a fleet pays), **0059** (three consoles),
**0060** (one client, many fleets), **0062** (head office reads the
directory, not the operations). 0058–0060 are written by `K0`; 0062 followed
from the owner's question on 23 August.

---

## 1 · The model, in one page

Kangaru owns nothing that moves.

| Kangaru owns | A fleet company owns |
|---|---|
| The fleet companies, **and the corporate-client directory** (ADR-0062) | Its drivers: applications, documents, duty, wallets |
| **Plans, and what a fleet pays** | Its employees: dispatchers, depot and branch managers |
| The walk-in economy: public tariff, walk-in clients, the order queue | Its vehicles: allocation, categories, documents |
| Driver walk-in contracts, site-wide across every fleet | **Its inventory: fuel, tyres, parts, consumables** |
| Commission on walk-in work | Its corporate clients' **work** — their bookings, trips and invoices |
| Its own staff, roles and settings | Bookings, dispatch, trips, live map, routes |
| The audit trail, including every acting-as session | Its rate cards and zones |
| Platform reports — counts and money, not other people's trips | Its invoices to its clients, on its own number series |

**The test:** nothing Kangaru owns moves, carries a passenger, or burns fuel.
If an entry appears on Kangaru's menu that sits in the right-hand column, the
menu is wrong.

**Three consoles, one codebase.** The app branches first on
`users.access_level` — `kangaru`, `fleet`, `client` — and only then on role.
Kangaru's menu is ten entries today, reaching fifteen as `K6`, `K7` and `K8` land; a fleet's is nineteen; a client's is ten.

**Kangaru reads the directory, never the operations** (ADR-0062, amending
ADR-0055 §2). The line moved from *how much* to *what kind*: head office reads
the fleets, the clients and the contracts between them — the shape of the
network it sells — and reaches a single trip, invoice, driver or booking only
by **logging in as** somebody (`S1`), which is announced, time-boxed and in
`audit_logs` with an `impersonator_id`.

The half of §2 that was load-bearing is untouched: no account reads another
party's *operations* in a query. What changed is that a platform managing fleet
companies cannot be unable to say which clients are on it.

**One client, many fleets.** A fleet signs its own corporate clients, **and so
does head office** — naming the fleet that will serve them, because a client
with no fleet has nobody to run its trips (ADR-0062 §3). A second fleet
serving an existing client must **ask**, and **the client approves** — the
contract is theirs to grant, and head office is not in that path. `operator_client` already carries a per-fleet
credit limit and billing email, which is what makes two fleets on one client
work without two client rows.

---

## 2 · What "done" means here

> *"we want to shade what perfect means not just doing the work without testing
> it"* — the owner, 22 August 2026.

`AGENTS.md` §Definition of Done is the floor: code and tests merged,
authorization covered, `docs/api/openapi.yaml` updated in the same PR, audit
events emitted, feature-flag state decided, module README updated.

**These seven gates are the bar.** A package reports done when all seven are
met, and reports honestly which are not when they are not. Six of the seven are
already habits in this repo; **gate 6 is new**, because AGENTS.md predates
ADR-0054 and has never mentioned Sentry.

### Gate 1 — The loop is closed

Master plan §2. Four parts, and a feature missing any one is **half-built**:

| Part | Question |
|---|---|
| Backend | Does an endpoint exist, with a policy and a contract entry? |
| Actor surface | Can the person who *does* the thing reach it? |
| Office surface | Can an administrator see and answer it? |
| Return path | Does the person who acted find out what happened? |

Half-built features are what make an app feel unreliable long before they cause
a bug. If you cannot close the loop, **hide the feature and write the gap
down** — do not ship the open half.

### Gate 2 — The contract ships in the same commit

A new or changed endpoint's `docs/api/openapi.yaml` entry lands with it. CI's
route census and response validation fail on drift (ADR-0011). This is not
paperwork: the driver app and the console are both generated against it.

### Gate 3 — Authorization is proved by refusal, not by success

A test that a Super Admin can do a thing proves nothing about who cannot.
**Every policy gets a test that asserts the 403.** For K work specifically:

- a `fleet`-level account must be refused every Kangaru-only endpoint;
- a `client`-level account must be refused every fleet endpoint;
- a fleet holding a `requested` contract must read **nothing** of that client;
- and the cross-fleet isolation suite must stay green — it is the one suite
  where a failure is a data breach, not a bug.

### Gate 4 — Every guard is proved by mutation

Write the test, watch it pass, then **introduce the bug it claims to catch and
watch it fail**, then restore. A test that cannot fail proves nothing, and this
has repeatedly caught bad tests in this repo — including agents' own.

Name the mutations you performed in your report. "Tests pass" is not a
verification claim; "I broke these six guards and each one bit" is.

### Gate 5 — You ran it, in the real thing

Green tests over formatters do not prove a screen mounts.

- **Web:** drive it in a browser — `playwright-core` against system Chrome,
  installed in the scratchpad, never added as a repo dependency. Screenshot the
  screen you built and say what you saw. This has caught bugs green tests
  agreed were impossible.
- **Driver app:** a dev build or the emulator, not Expo Go assumptions. Metro
  on 8082 — 8081 collides with Apache and silently serves HTML.
- **Backend:** `php -d memory_limit=1G vendor/bin/pest`, which is what CI runs.
  `artisan test` fatals at 128 MB in a mail blade.

### Gate 6 — It says so when it breaks — **new**

Sentry is connected across the API, the console and the driver app (ADR-0054)
and is the production bug channel. A feature that fails silently is not
finished, and silence is the failure mode this project has hit five times.

1. **No swallowed errors.** A `catch` either recovers visibly or reports. An
   empty catch, or one that only logs to console, is a defect in review.
2. **The failure path reports with context** — who, which fleet, which record.
   Never the whole object: allow-list the fields, the same rule as a Resource.
   A client's phone number must not reach Sentry any more than it reaches a
   push notification.
3. **Prove it by triggering it.** Force the failure, watch the event arrive,
   and **name the Sentry issue in your report.** An untriggered integration is
   an assumption. Sentry's own silence has been misleading before, and
   correctly so — a filter was deleting the evidence.
4. **A user-visible failure state as well.** Reporting to Sentry is for us; the
   person on the screen still needs an error that says what went wrong and what
   to do. Both, never one.
5. **A breadcrumb on the action that led there**, so the issue arrives with the
   path, not just the throw.

### Gate 7 — Green on CI, not just locally

Run it on the branch (`gh workflow run CI --ref <branch>`; `gh auth token` via
`-c http.extraheader` — plain `git push` is rejected for workflow files).

CI runs **MySQL 8.4**; local is **MariaDB 10.4**. A CHECK constraint, a
generated column and a `TIMESTAMP` default all sit exactly on that difference,
and CI gates on migration reversibility, which is where an engine difference
surfaces. **Locally green is not evidence.**

### And a screen has one more gate

`docs/screen-rules.md` in full, including its checklist. Two items are
routinely skipped and are load-bearing here:

- **§9 — a screen carries no explanation.** The owner's report, 22 August:
  agents *"write unwanted descriptions on the pages which makes the experience
  very poor."* A screen is an instrument, not a document. Your reasoning belongs
  in the code comment, the ADR and the worklog — never in front of the user.
- **Load `screen` first, which pulls in `quality-control`** (the decision loop,
  Lucide-only icons, the north-star goals), and with it `impeccable` and
  `emil-design-eng`. Run the decision loop **before** implementing, not as a
  review afterwards.

### The report you write when you finish

Three headings, always, and the second and third are the valuable ones:

1. **What I verified** — with the mutation list and the Sentry issue id.
2. **What I did NOT verify** — say it plainly. An unproved claim that reads as
   proved is worse than a gap.
3. **What I deliberately left out** — a gap somebody else can see is a gap they
   will not rebuild badly.

---

## 3 · The packages

Ten. `K0` is solo and blocking; the rest are sized to one agent each.

### K0 · The record, and the rail — **SOLO, BLOCKING**

Nothing else starts until this reports done.

- Write **ADR-0058** (what a fleet pays — reversing `fleet-model-plan.md` §6),
  **ADR-0059** (three consoles, one codebase), **ADR-0060** (one client, many
  fleets at onboarding).
- Get the **eleven `F0`–`S1` migrations through CI on MySQL 8.4**, including
  the reversibility gate. They have never run anywhere but MariaDB 10.4.

**Why blocking:** if those migrations do not survive MySQL 8.4, every package
below is built on sand — and the three most fragile pieces are the ones
`K2`, `K5` and `K7` all add columns next to.

**Exit:** three ADRs merged; CI green on the branch carrying the migrations;
`migrate:rollback` + `migrate` round-trips **in CI**, not just locally.

### K1 · The level reaches the console

Today `UserResource` does not send `access_level` and the frontend `User` type
has no field for it: **the console cannot tell a Kangaru account from a fleet
account.** Every other package depends on this one.

- `access_level` on `UserResource` and on the frontend `User` type.
- `navigation.ts` keys on **level first, then role**.
- The one `SECTIONS` constant in `AppShell.tsx` becomes **three menu files** —
  `lib/menu/kangaru.ts`, `menu/fleet.ts`, `menu/client.ts`.

**Ship all three menus identical to today's.** `K4` makes them differ. That
makes `K1` a provable no-op for every existing account, which is exactly what
you want from a change to the file every other package wants to touch.

**Exit:** a `kangaru` and a `fleet` account resolve different menu *sources*
and identical menu *contents*; nav tests cover all three levels; the isolation
suite still green.

### K2 · A fleet company exists

Blocker number one in `fleet-model-plan.md` §4b: *"No way to create an
operator. No endpoint, no screen, no seeder."* Backend only.

- `OperatorController`, `OperatorPolicy`, requests, resource, service.
- Create, list, show, suspend — Kangaru-level only.
- **The first owner account is created in the same transaction as the fleet.**
  You act as a *person*, not an organisation (ADR-0056), so a fleet with zero
  accounts is unreachable to support. It must never be possible to reach zero.

**Exit:** Kangaru staff create a fleet; a fleet-level account gets 403 on all
of it, proved by refusal; a new fleet always has one nameable account.

### K3 · The fleet console — *depends: K1, K2*

Frontend only. The register and the record page, and the **Log in as** button
that makes the fourteen-item menu safe.

**Exit:** register and record page; Log in as starts a session and lands in
that fleet's console **with the acting-as banner up**; verified in a browser,
with a screenshot in the report.

### K4 · Kangaru's dashboard, and the cut to fourteen — *depends: K1, K3*

- The head-office dashboard: the network counts, the queues only Kangaru can
  clear, governance (live acting-as sessions), platform health.
- Remove **twelve** entries from `menu/kangaru.ts`: Bookings, Dispatch, Trips,
  Live map, Routes, Companies, Vehicles, Drivers, Applications, Driver reports,
  Invoices, Rate cards. They are a fleet's, not Kangaru's.

**Exit:** the twelve are gone for a `kangaru` account and **still present for a
`fleet` account**, proved by test; every removed destination is reachable by
logging in as a fleet. Do this after `K3`, never before — removing the door
before building the other way in is how support gets locked out.

### K5 · One client, one row

`companies.registration_number` is **nullable and not unique**. Two fleets can
both create "Centenary Bank Ltd" today and nothing objects.

- Migration: required at onboarding, unique platform-wide. **Decide and record
  the backfill for existing rows** — this is the one destructive-adjacent step
  in the plan.
- `GET /clients/lookup?registration_number=…` → `{ exists: true|false }`.

**Exit:** two fleets cannot create one registration number; the lookup returns
**a boolean and nothing else** — proved by a test asserting the body carries no
name, no address, no contact. "Is Centenary on Kangaru?" is not a question a
competitor may ask.

### K6 · Onboarding a client, and the client's consent — *depends: K2, K5*

- Path A — no match: the fleet creates the client, its contract, and the
  client's first admin account.
- Path B — match: the fleet may **only ask**. `operator_client.status =
  requested`, which grants **no read whatsoever**.
- **The client approves**, in their own console under *Our fleets*. Kangaru is
  not in this path — head office would be a bottleneck on every fleet's sales
  cycle.
- A contract ends by `ended_on`, never by deleting a client.

**Exit:** path B cannot create, cannot read and cannot attach; a fleet holding
a `requested` row reads nothing of that client — proved by refusal; after
approval each fleet sees only its own trips, credit limit and invoices for that
client, and the client sees both.

### K7 · Plans and subscriptions — *depends: K2*

Nothing exists: no table, no model, no billing run.

- The plan catalogue as **rows, not code** — a plan changes without a deploy.
- Free is a real plan and the default. Shanitah is grandfathered **explicitly
  by a named plan**, not by being row 1.
- **A limit blocks adding; it never removes what exists.** A free fleet hiring
  an eleventh driver is told at the point of hiring — not silently refused deep
  inside dispatch, and never by breaking the ten who already work there.
- **Subscription and commission are two different debts and do not share a
  table.** Commission is per-trip, owed by the driver's wallet, reproducible
  from the trip. Subscription is per-period, owed by the fleet, owed in a month
  with no trips. Merging them makes both unauditable.

**Exit:** a fleet has a plan; a limit refuses an add with a message naming the
number; a downgrade below current usage is refused, not silently enforced.

### K8 · Driver walk-in contracts, then commission — *depends: K2; two open questions*

`F3`, absorbed. The driver asks, the fleet consents, Kangaru approves — waived
where `drivers.owns_vehicle`, because there is no fleet to ask. **§5 question 1
is answered** (see §7); the other two are not, and they block the commission
half, not the contract half. Build the contract flow first.

### K9 · Inventory — **its own plan, not this one**

Fuel, tyres, parts, consumables. No module, no table, no mention anywhere in
the backend. This is a stock-keeping system with issue-and-receipt, per-vehicle
fuel logs and consumption per kilometre. **It is the largest single item here
and it does not belong as a section in someone else's plan.** Whoever takes it
writes `docs/inventory-plan.md` first.

Start with fuel: it is the daily cost, and the number nobody has today is
litres per kilometre against the odometer readings trips already capture.

---

## 4 · Who owns which files

The collision matrix. **A file appears in exactly one "owns" row.** If you need
to edit a file another package owns, say so in the worklog and wait — do not
edit it and mention it afterwards.

| Package | Owns outright | Shared — the exact edit |
|---|---|---|
| **K0** | `docs/adr/0058*`, `0059*`, `0060*`; this file | `master-plan.md` one row; `fleet-model-plan.md` one banner |
| **K1** | `Administration/Resources/UserResource.php`; `frontend/src/types/auth.ts`; `lib/navigation.ts` + test; **new** `lib/menu/{kangaru,fleet,client}.ts` | `AppShell.tsx` — `SECTIONS` deleted, replaced by a level lookup. **Nothing else in that file.** |
| **K2** | `Modules/Fleet/{Controllers,Policies,Requests,Resources,Services}/Operator*`; `app/Models/Operator.php`; its tests | `Modules/Fleet/Routes/api.php` one block; `openapi.yaml` `/operators*` only; `RoleSeeder` one permission; `Modules/Fleet/README.md` |
| **K3** | `pages/FleetCompaniesPage.tsx`; `pages/fleets/*`; `types/operator.ts` | `router.tsx` one route block; `lib/menu/kangaru.ts` two entries |
| **K4** | `pages/dashboard/KangaruDashboard.tsx` | `DashboardPage.tsx` the level branch only; `lib/menu/kangaru.ts` the removals |
| **K5** | the `registration_number` migration; `Clients/Controllers/ClientLookupController.php`; its tests | `Modules/Clients/Routes/api.php` one route; `openapi.yaml` `/clients/lookup` only; `data-inventory.md` one row |
| **K6** | `Clients/Controllers/OperatorClientController.php`; the onboarding wizard; `pages/company/OurFleets.tsx`; their tests | `router.tsx` one block; `lib/menu/client.ts` one entry; `openapi.yaml` own paths; `corporate-client-panel-plan.md` one note |
| **K7** | the plans migrations and module; `pages/PlansPage.tsx`; `pages/fleets/KangaruBill.tsx` | `router.tsx` one block; `lib/menu/{kangaru,fleet}.ts` one entry each; `openapi.yaml` own paths |
| **K8** | the contract module and screens | `openapi.yaml` own paths; `fleet-model-plan.md` F3 status line |
| **K9** | `docs/inventory-plan.md`, then whatever that plan claims | — |

**Files everybody appends to, and the rule for each:**

- `docs/agent-worklog.md` — your entry, at the end, **before** your first edit.
- `docs/api/openapi.yaml` — your own paths only. Never reformat the file; a
  whole-file reformat buries every other agent's diff.
- `router.tsx`, `lib/menu/*.ts` — **one contiguous block**, named in your
  worklog entry. These are the two files most likely to collide in wave 2.

**Never fork a shared module.** `mobile/src/ui/components.tsx`,
`ui/facts.tsx`, `trips/contact.ts`, `trips/places.ts` and the web component
library are the common vocabulary. Extend them.

---

## 5 · Running these in parallel

| Wave | Packages | Why they do not collide |
|---|---|---|
| **0** | `K0` **alone** | Documents and CI. Nobody else in the tree. |
| **1** | `K1`, `K2`, `K5` | Disjoint: the auth resource + frontend nav; the Fleet module; the companies migration + Clients. Only `openapi.yaml` is shared, on different paths. |
| **2** | `K3`, `K7` | Both append to `router.tsx` and `lib/menu/kangaru.ts` — **one block each, named in the worklog.** Everything else is disjoint. |
| **3** | `K4`, `K6` | `K4` is Kangaru's menu and dashboard; `K6` is the client's. Disjoint menus, disjoint modules. |
| **4** | `K8` | After its questions are answered. |
| **later** | `K9` | Writes its own plan first. |

**Three at once is the tested ceiling in this tree.** More has produced
collisions on shared fixtures before — four trip fixtures gained a required
field and two agents raced on the same four.

**Before you write a line, in this order:** `git status` (however recently
anyone looked — the tree changes under you), then `docs/agent-worklog.md`, then
your claim entry, then re-read the worklog to check nobody claimed the same
package in the same minute. **The later timestamp yields.**

Use `/audit K<n>` to join. It reads the worklog, takes the package, and loads
the right skills.

| Loads `screen` | Does not |
|---|---|
| `K1` (it decides what a menu holds — that is information architecture), `K3`, `K4`, `K6`, `K7`, `K8` | `K0`, `K2`, `K5` — documents, a backend module, a migration. `screen` loads the wrong context and buries the brief. |

---

## 6 · Open, and the owner's call

Answered by the owner on 22 August, and recorded so silence does not re-open it:

| # | Question | Answer |
|---|---|---|
| 1 | Does a driver's fleet consent to their Kangaru walk-in contract? | **Yes** — driver asks, fleet consents, Kangaru approves. Waived where the driver owns the vehicle. *(`fleet-model-plan.md` §5 q1, closed.)* |

Still open, and each blocks only what is named:

| # | Question | Recommended | Blocks |
|---|---|---|---|
| 2 | Who wins when a fleet's own booking and a walk-in want the same on-duty driver? | The fleet's own work, overridable per contract | `K8` commission half |
| 3 | Does the fleet get a share of a walk-in run on its vehicle? | A fleet share on the contract, defaulting to zero — so the column exists before the argument does | `K8` commission half |
| 4 | **Does Kangaru see a corporate-client count, a list, or nothing?** | ~~The count only~~ — **answered the other way, 23 Aug: a register.** Head office onboards clients, so it cannot be unable to see the one it just created. **ADR-0062** moves the line from *how much* to *what kind*: Kangaru reads the **directory** (fleets, clients, the contracts between them) and never the **operations** (trips, invoices, drivers). | closed |
| 5 | What happens to existing `companies` rows with no registration number? | Require it on the next edit rather than inventing one; block new onboarding without it | `K5` migration |

---

## 7 · Explicitly not in this plan

- **Renaming `tenant_id`.** Out permanently. ADR-0055 §1 — in code it is the
  corporate client; on every screen the words are *fleet* and *client*.
- **A database per fleet.** ADR-0001's escape hatch, one level up.
- **A fleet acting as its own staff or drivers.** ADR-0056 Scope leaves it out
  as a different trust question — an employer, not a supplier. A new decision
  if asked for, not an extension of this one.
- **Per-fleet branding in the driver app.** One app, one brand, for now.
- **The client-side fleet switcher.** Deferred on purpose until a client
  genuinely holds two contracts; a control with one option is permanent chrome
  that does nothing.
- **Reordering Track A, Track B or the go-live sequence.** This plan runs
  beside them and does not enter their queue.
