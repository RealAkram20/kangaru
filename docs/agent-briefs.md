# Agent launch briefs

Copy a block, paste it as the agent's first message. Nothing else needed.

**When to open with `/screen`:** only when the agent will design or change a
screen, page, form, modal or component. `/screen` pulls in `quality-control`,
`DESIGN.md`, the screen rules and the worklog ownership table by itself. For
deployment, configuration, security and census work it loads the wrong context —
use the plain block instead.

| Package | Opener |
|---|---|
| A0, W1-a, W1-b, W1-c, W1-d, W1-f, W2-a | plain block below |
| **W1-e** (privacy page has UI) | `/screen` |
| **All of Track B** (audit + screen fixes) | `/screen` |
| **K0**, K2, K5 | plain block below |
| **K1**, **K3**, **K4**, **K6**, **K7**, **K8** | `/screen` |

The K packages have their own preamble and briefs at the end of this file —
`docs/platform-plan.md` is their front door.

---

## The universal preamble

Every block below already contains this. It is repeated here so you can build a
brief for a package that does not exist yet.

```
Read docs/master-plan.md in full, then docs/track-a-parallel-plan.md, then
docs/agent-worklog.md. Then AGENTS.md and PRODUCT.md. Those outrank anything
I tell you.

Work in your own git worktree — this tree is shared with other agents and was
125 files dirty at the start. Claim your files in docs/agent-worklog.md BEFORE
your first edit; an entry written afterwards is a collision report, not a plan.

Do not edit a file another package owns — report it instead. If you find a file
mid-mutation (a guard returning true, an assertion commented out), that is
another agent proving a test bites: leave it and say so.

Run the quality-control decision loop before implementing: name your decisions,
ask whether a better version exists judged against the north star, bring me real
forks with concrete options, and decide the obvious ones yourself. No new paid
service, subscription or metered API without me.

When you finish, report what you verified, what you did NOT verify, and what you
deliberately left out.
```

---

## A0 — Land the work · SOLO, BLOCKING

**Run this one alone. No other agent in the tree until it reports done.**

```
Read docs/master-plan.md in full, then docs/track-a-parallel-plan.md, then
docs/agent-worklog.md. Then AGENTS.md.

You are A0. You have the tree to yourself — no other agent is running.

Follow the A0 brief in docs/track-a-parallel-plan.md exactly. In short: kill the
hung jest process on SafetyScreen.test.tsx first; commit the ~125 working-tree
files split by module as Conventional Commits (commitlint gates the PR, and
multi-line messages need `git commit -F <file>` on this machine — a chained
here-string mangles into pathspecs); run CI on the branch with `gh workflow run`;
fix whatever it reports; hand PR #9 to me for review.

Do NOT merge. Do NOT reformat other agents' files — three shared mobile/ files
already fail prettier --check at HEAD and that is a recorded finding, not a
licence to touch sixty files and bury the real diff.

Exit criteria: working tree clean, CI green on the branch, PR #9 ready for
review with a description naming what it contains.

Report what you verified, what you did not, and anything you left out.
```

---

## W1-a — Dockerised isolated stack

```
<universal preamble>

You own work package W1-a. The brief is in docs/track-a-parallel-plan.md; the
master plan's §3 amends it and the amendment wins.

The Coolify server already hosts other projects, so this project gets its OWN
containers for everything — MySQL 8, Redis, PHP app, queue worker, scheduler —
each with CPU and memory limits. No shared database server, no shared cache.

The app is FIVE processes, not one. A default Coolify PHP deploy satisfies one
and looks perfectly healthy. Read the table in master-plan.md §3 before you
write anything: the scheduler runs AdvanceDispatchOffers every ten seconds, and
without it dispatch stalls with no error anywhere.

Also required before any client data lands: an automated MySQL backup schedule,
and one restore actually performed. An untested backup is not a backup.

You own: Dockerfile, .dockerignore, compose/process files, deploy scripts — all
new files. You must NOT touch backend/config/* or backend/.env.example; W1-b
owns those.

Exit: a deploy where all five containers are up with limits set, proved by
`schedule:list` output and a queued job completing, plus a timed restore.
```

---

## W1-b — Production configuration and secrets

```
<universal preamble>

You own work package W1-b — the brief is in docs/track-a-parallel-plan.md.

You own backend/config/*, backend/.env.example, backend/bootstrap/app.php.
You must NOT touch the Dockerfile or any deploy script; W1-a owns those.

The one that ends the platform if you get it wrong: APP_KEY is generated ONCE
and kept stable. Rotating it makes every encrypted driver document unreadable.

Also: APP_DEBUG=false, APP_ENV=production, DriverAppSeeder and the demo TOTP
account must never run against the live database, config/cors.php is not
published so the framework default applies and must be pinned explicitly,
Sanctum expiry and per-client-app abilities (ADR-0022) confirmed live, structured
JSON logs carrying request_id/tenant_id/user_id/module to somewhere that survives
a redeploy, and rate limits confirmed in production — especially OTP/SMS, where
AGENTS.md names SMS pumping fraud as a real cost rather than a hypothetical.

Exit: a complete production env template, every value either set or explicitly
marked owner-supplied. No secret in the repo — gitleaks runs on every push.
```

---

## W1-c — Security gate

```
<universal preamble>

You own work package W1-c — the brief is in docs/track-a-parallel-plan.md.
This package protects the only thing this platform has that a bigger competitor
does not: audit-grade correctness for corporate and bank clients.

247 backend files are about to go live having never been reviewed.

Do: run the cross-tenant isolation suite, BOTH halves (ADR-0006) — that a client
sees only their own, and that a platform user with no permission on a surface
sees nothing of it either. Census EVERY route against a policy; a route without
one fails review per AGENTS.md, and a missing policy is a tonight-blocker, not a
finding. Confirm cross-tenant access answers 404, never 403. Verify the
append-only audit_log records a real mutation in the DEPLOYED environment.
Confirm no resource spreads a whole object — order_requests.details carries
sender_phone and recipient_phone, and a resource emitting that column wholesale
leaks two numbers while looking harmless in review.

Coverage is better than feared: backend/tests/Feature/Drivers/ already holds 18
test files including DriverCrossTenantIsolationTest. Your job is to verify
against the DEPLOYED system, not only against green local tests.

You own backend/tests/Feature/Ci/*, backend/tests/Feature/Tenancy/* and a
findings document. You must NOT edit module source — report a gap to whoever
owns that module.

Exit: a route-by-route policy census with zero gaps, both isolation halves green
against the deployed database.
```

---

## W1-d — Runbook and rollback

```
<universal preamble>

You own work package W1-d — the brief is in docs/track-a-parallel-plan.md.
You own docs/runbook.md, which is new.

AGENTS.md requires the rollback procedure to be written down AND rehearsed
before first client onboarding. Tonight is first client onboarding.

Must contain: deploy steps; a rollback you have actually PERFORMED on the live
server and timed; what to do when the queue worker dies (it has been found
stopped once already); how to tell whether the scheduler is running; the minimum
alert set from AGENTS.md Observability (5xx > 2% for 5 min, oldest queued job >
5 min, GPS lag > 60s, any failed invoice generation, disk > 80%, cert expiry <
14 days); and who is called at 2am.

Exit: a rollback performed and timed. An unrehearsed rollback is a wish.
```

---

## W1-e — Data protection · **TONIGHT-BLOCKER** · open with `/screen`

```
/screen

Read docs/master-plan.md in full, then docs/track-a-parallel-plan.md and
docs/agent-worklog.md.

You own work package W1-e, and it is a hard blocker on tonight's go/no-go.

Real members of the public place orders tonight, handing over name, phone, and
pickup and drop-off addresses. The Uganda Data Protection and Privacy Act, 2019
applies (AGENTS.md Compliance).

Needed: a data inventory (what PII, where, why, retention) in
docs/data-inventory.md; the written retention policy (trip PII 7 years, raw GPS
12 months, ex-employee accounts anonymized after 90 days); and a privacy notice
reachable FROM THE ORDER FORM BEFORE SUBMISSION — not buried in a footer. Also
check the Personal Data Protection Office registration requirements and report
what you find.

You own the privacy page and its route. frontend/src/pages/public/* may have
another owner — check docs/agent-worklog.md and coordinate before editing.

Exit: a customer can read what happens to their data before they hand it over.
Everything else in this package can be week one; that sentence cannot.
```

---

## W1-f — Completeness census

```
<universal preamble>

You own work package W1-f. Read master-plan.md §2 first — the completeness gate
is the whole point of this package.

A feature ships only when its loop is closed: backend endpoint with a policy and
a contract entry → the actor can reach it → the office can see and answer it →
the actor finds out what happened. Missing any part means half-built.

Walk all four parts against REAL CODE for every feature — route file, policy,
docs/api/openapi.yaml, the driver screen, the web page, the notification.
Confirm or CORRECT every row in the master plan's seeded table; two rows there
were already wrong when I first assumed them, so verify rather than transcribe.

For each open loop give three options — close it, hide it, ship it half-open
knowingly — with a recommendation and a cost.

You own docs/feature-completeness.md and edit NO source. You hide nothing
yourself; you report so I can choose.

Exit: every feature classified, and a list of surfaces to hide tonight ready for
my yes/no.
```

---

## W2-a — Live verification · needs W1-a deployed

```
<universal preamble>

You own work package W2-a — the brief is in docs/track-a-parallel-plan.md.
Do not start until W1-a reports a deploy is up.

This is not a test run. Drive the real system on the production domain.

Place an order from the public web app as a walk-in customer, end to end. Place
one as a corporate client admin. Watch it become a dispatch offer with the
scheduler running. Confirm the live map shows a position (proves Redis). Confirm
an invoice reproduces from stored data. Sign in as Finance and as Super Admin —
BOTH need a TOTP code, generated from mfa_secret in the same shell call.

Use playwright-core with system Chrome installed to the scratchpad — never add it
as a repo dependency. Screenshot every step; this method has already caught bugs
in this repo that green tests missed.

Exit: screenshots of a complete order → dispatch offer path on the production
domain, for both a corporate client and a public walk-in.
```

---

## Track B — driver app work · always open with `/screen`

```
/screen

Read docs/master-plan.md, then docs/ux-audit-plan.md in full, then
docs/agent-worklog.md.

<name the phase or the screen>

The audit's thresholds are fixed in advance in ux-audit-plan.md so a finding
cannot be shaped to fit whatever was easy to change — do not renegotiate them.
Phase 4 is an approval gate: nothing is implemented until I sign off the
findings.

Rules that keep being broken here: never invent a number the platform cannot
produce (render an em dash and say why), never show what an ADR withholds,
icons are Lucide only and never emoji, tokens not raw hex, 52pt touch targets,
and a screen is not done until you have RUN it and proved each guard by
mutation — then restored every mutation before you finish.
```

---

# The K packages — the platform plan

`docs/platform-plan.md` is the front door for all of these: the model, the ten
packages, the file-ownership matrix, and **§2, what "done" means**.

| Package | Opener | Runs with |
|---|---|---|
| **K0** | plain block | **nobody — solo and blocking** |
| **K1**, K2, K5 | `/screen` for K1 only | each other (wave 1) |
| **K3**, **K7** | `/screen` | each other (wave 2) |
| **K4**, **K6** | `/screen` | each other (wave 3) |
| **K8** | `/screen` | wave 4 |
| K9 | plain block | writes its own plan first |

**Three agents at once is the tested ceiling in this tree.** More has produced
collisions on shared fixtures before.

## The K preamble

Every block below already contains this.

```
Read docs/platform-plan.md in full, then docs/master-plan.md, then
docs/agent-worklog.md. Then AGENTS.md and PRODUCT.md. Those outrank anything I
tell you.

You are building to docs/platform-plan.md §2 — seven gates. Three of them are
routinely skipped and I will ask about each one:

  Gate 4: prove every guard by MUTATION. Break the guard, watch the test fail,
  restore it. Name the mutations in your report. "Tests pass" is not a
  verification claim.

  Gate 5: RUN IT. Web in a real browser (playwright-core + system Chrome, in
  the scratchpad, never a repo dependency) with a screenshot. Backend with
  php -d memory_limit=1G vendor/bin/pest, which is what CI runs.

  Gate 6: it must SAY SO WHEN IT BREAKS. Sentry is the production bug channel.
  No swallowed catches; the failure path reports with allow-listed context AND
  renders a visible error; and you prove it by triggering it and naming the
  Sentry issue id. An untriggered integration is an assumption.

Claim your files in docs/agent-worklog.md BEFORE your first edit — an entry
written afterwards is a collision report, not a plan. The ownership matrix is
docs/platform-plan.md §4; do not edit a file another package owns, report it
instead. Run git status again now, however recently anyone looked.

CI runs MySQL 8.4; local is MariaDB 10.4. Locally green is not evidence.

Run the quality-control decision loop before implementing. No new paid service,
subscription, metered API, dependency or icon set without me.

When you finish, report three things: what you verified (with the mutation list
and the Sentry issue), what you did NOT verify, and what you deliberately left
out.
```

---

## K0 — The record, and the rail · SOLO, BLOCKING

**Run this one alone. No K agent in the tree until it reports done.**

```
[K preamble]

You are K0. Solo and blocking: no other K package may start until you report
done. Two jobs, in this order.

1. Get the eleven F0–S1 migrations through CI on MySQL 8.4, including the
   reversibility gate. They have never run anywhere but MariaDB 10.4. Three
   pieces sit exactly on that difference: the users_access_level_matches_columns
   CHECK constraint, the generated operator_scope column, and a DATETIME vs
   TIMESTAMP default. gh workflow run CI --ref <branch>; push workflow files
   with `gh auth token` via -c http.extraheader, plain git push is rejected.

2. Write three ADRs, in docs/adr/:
   - 0058, what a fleet pays to be on Kangaru. It REVERSES fleet-model-plan.md
     §6, which listed this as out because "the code should not guess" at a
     commercial question. Record the reversal legibly the way ADR-0055 struck
     ADR-0005 — strike it here, do not edit that file's body.
   - 0059, three consoles one codebase. access_level branches the menu before
     role does. Cite ADR-0055 §2: Kangaru reads across no fleet, and reaches a
     fleet by acting as (ADR-0056).
   - 0060, one client many fleets at onboarding. The hazard is two fleets
     creating two rows for one bank. The match key is companies.registration_number
     — today nullable and NOT unique. The client approves a second fleet;
     Kangaru is not in the approval path.

Exit: three ADRs merged; CI green on the branch carrying the migrations;
migrate:rollback + migrate round-trips IN CI, not just locally.

Do NOT write any endpoint, screen, menu change or migration of your own.
```

---

## K1 — The level reaches the console · `/screen`

```
/screen

[K preamble]

You are K1. Every other K package depends on you, so ship the mechanism and
change nothing anyone can see.

Today UserResource does not send access_level and frontend/src/types/auth.ts
has no field for it: the console CANNOT tell a Kangaru account from a fleet
one. Fix that, and make the menu key on level before role.

  - access_level on UserResource (one field) and on the frontend User type.
  - lib/navigation.ts keys on level first, then role. Keep every existing
    role rule — you are adding an axis, not replacing one.
  - The single SECTIONS constant in AppShell.tsx becomes three menu files:
    lib/menu/kangaru.ts, menu/fleet.ts, menu/client.ts. This split exists so
    later packages append to DIFFERENT files instead of racing on one.

SHIP ALL THREE MENUS IDENTICAL TO TODAY'S. K4 makes them differ. That makes
you a provable no-op for every existing account, which is what you want from a
change to the file everything else wants to touch.

You own: UserResource.php, types/auth.ts, lib/navigation.ts + its test, the
three new lib/menu/*.ts. Shared: AppShell.tsx — delete SECTIONS, replace with
a level lookup, and touch NOTHING else in that file.

Exit: a kangaru and a fleet account resolve different menu sources and
identical menu contents; nav tests cover all three levels; the cross-fleet
isolation suite still green — it is the one suite where a failure is a data
breach, not a bug.
```

---

## K2 — A fleet company exists · plain block

```
[K preamble]

You are K2. Backend only — do not load /screen, it loads the wrong context.

You are clearing blocker number one in fleet-model-plan.md §4b: "No way to
create an operator. No endpoint, no screen, no seeder." A second fleet cannot
exist until you land.

  - OperatorController, OperatorPolicy, requests, resource, service in
    Modules/Fleet. Create, list, show, suspend. Kangaru-level only.
  - THE FIRST OWNER ACCOUNT IS CREATED IN THE SAME TRANSACTION AS THE FLEET.
    ADR-0056 acts as a PERSON, not an organisation, so a fleet with zero
    accounts is unreachable to support forever. It must never be possible to
    reach zero — enforce it, do not document it.

You own Modules/Fleet/**/Operator* and app/Models/Operator.php. Shared, one
edit each and name them in your worklog entry: Fleet/Routes/api.php one block,
openapi.yaml /operators paths ONLY (never reformat that file — a whole-file
reformat buries every other agent's diff), RoleSeeder one permission,
Modules/Fleet/README.md.

Exit, and gate 3 is the one that matters: Kangaru staff create a fleet, and a
FLEET-level account is refused every one of these endpoints — proved by a test
asserting the 403, not by a test asserting the success.
```

---

## K5 — One client, one row · plain block

```
[K preamble]

You are K5. Backend only.

companies.registration_number is nullable and NOT unique. Two fleets can both
create "Centenary Bank Ltd" today and nothing objects — and once two rows
exist, the bank has two logins, two trip histories and two sets of invoices,
and no merge afterwards is clean.

  - Migration: required at onboarding, unique platform-wide.
  - DECIDE AND RECORD THE BACKFILL for existing rows. This is the one
    destructive-adjacent step in the whole plan. The plan's recommendation is:
    require it on the next edit rather than inventing one, and block new
    onboarding without it. Look at the real rows before you choose.
  - GET /clients/lookup?registration_number=... → { exists: true|false }

The lookup returns A BOOLEAN AND NOTHING ELSE. No name, no address, no
contact, no count, no hint of who serves them. "Is Centenary on Kangaru?" is
not a question a competitor may ask. Write the test that asserts the response
body carries no name — that test is the deliverable, not the endpoint.

Exit: two fleets cannot create one registration number; the leak test passes
and you broke it to prove it bites.
```

---

## K3 — The fleet console · `/screen` · depends K1, K2

```
/screen

[K preamble]

You are K3. Frontend only. K1 and K2 must both be done.

The register of fleet companies and the record page for one — and the LOG IN
AS button, which is what makes Kangaru's fourteen-item menu safe instead of
blind. Head office gives up nine registers and loses no reach.

The record page carries: identity and status; the fleet's plan (K7 fills this
in — leave the shape, render an em dash until then); its counts; its corporate
clients from operator_client; and Log in as.

docs/screen-rules.md §9 — A SCREEN CARRIES NO EXPLANATION. No "this page
allows you to", no blurb under a heading, no rationale, no Note: boxes. Your
reasoning goes in the code comment and the worklog, never in front of the
user. An empty state is one line and one button, not a paragraph.

You own pages/FleetCompaniesPage.tsx, pages/fleets/*, types/operator.ts.
Shared: router.tsx one route block, lib/menu/kangaru.ts two entries. K7 is
appending to those same two files in this wave — one contiguous block each,
named in your worklog entry.

Exit: Log in as starts a session and lands you in that fleet's console WITH
THE ACTING-AS BANNER UP. Screenshot it. Gate 5 is not satisfied by a passing
test here.
```

---

## K7 — Plans and subscriptions · `/screen` · depends K2

```
/screen

[K preamble]

You are K7. Nothing exists: no table, no model, no billing run. ADR-0058 (K0)
is your decision record — read it before you design the schema.

  - The plan catalogue is ROWS, NOT CODE. A plan changes without a deploy.
  - Free is a real plan and the default. Shanitah is grandfathered by a NAMED
    plan, not by being row 1.
  - A LIMIT BLOCKS ADDING; IT NEVER REMOVES WHAT EXISTS. A free fleet hiring
    an eleventh driver is told at the point of hiring — not silently refused
    deep inside dispatch, and never by breaking the ten who already work
    there. A downgrade below current usage is refused with a message naming
    the number, not silently enforced.
  - SUBSCRIPTION AND COMMISSION ARE TWO DIFFERENT DEBTS AND DO NOT SHARE A
    TABLE. Commission is per-trip, owed by the driver's wallet, reproducible
    from the trip. Subscription is per-period, owed by the fleet, owed in a
    month with no trips. Merging them makes both unauditable.

Shared: router.tsx one block, lib/menu/kangaru.ts and menu/fleet.ts one entry
each, openapi.yaml your own paths. K3 is in those same files this wave.

Exit: a fleet has a plan; a limit refuses an add with a message naming the
number; the refusal is proved by mutation. Money code — gate 4 is not optional.
```

---

## K4 — Kangaru's dashboard, and the cut to fourteen · `/screen` · depends K1, K3

```
/screen

[K preamble]

You are K4. Two jobs, and the order is load-bearing.

1. Kangaru's own dashboard, replacing the three-company-counter stub in
   DashboardPage.tsx. The network counts; the queues only head office can
   clear; governance (live acting-as sessions); platform health. Commission
   waits for K8 — leave the shape, render an em dash.

2. Remove TWELVE entries from lib/menu/kangaru.ts: Bookings, Dispatch, Trips,
   Live map, Routes, Companies, Vehicles, Drivers, Applications, Driver
   reports, Invoices, Rate cards. They are a fleet's, not Kangaru's. That
   takes Kangaru from 21 entries to 14.

DO THIS AFTER K3, NEVER BEFORE. Removing the door before the other way in is
built is how support gets locked out of production.

One open question is YOURS to raise before you build, not to decide: does
Kangaru see a corporate-client count, a list, or nothing? The plan recommends
THE COUNT ONLY — a count is a business metric and a billing input; a list of
rows breaches ADR-0055 §2. It is one endpoint's difference and very easy to
build the wrong one by accident. Confirm before you build it.

docs/screen-rules.md §9 applies to the dashboard hardest of all. A KPI has a
label and a unit. It does not have a sentence explaining what it counts.

Exit: the twelve are gone for a kangaru account and STILL PRESENT for a fleet
account — proved by test, not by looking; every removed destination reachable
by logging in as a fleet.
```

---

## K6 — Onboarding a client, and the client's consent · `/screen` · depends K2, K5

```
/screen

[K preamble]

You are K6. ADR-0060 (K0) is your decision record. This is the procedure that
has to be exactly right.

  Step 1. The fleet enters the client's REGISTRATION NUMBER FIRST — not the
  name. Everything else on the form stays disabled until it is answered. This
  is the whole duplicate defence, so it goes first where it cannot be skipped.

  Step 2. Exact-match lookup (K5's endpoint). Never a browsable directory,
  never fuzzy name search.

  Step 3A. No match: the fleet creates the client, its contract, and the
  client's first admin account. Credit limit and billing email go ON THE
  CONTRACT (operator_client already carries both columns) — not on the client.
  That is what makes two fleets on one client work later.

  Step 3B. Match: the fleet may ONLY ASK. operator_client.status = requested,
  which grants NO READ WHATSOEVER. The response says "this company is already
  on Kangaru, request to serve them?" and nothing more — no name, no address,
  no hint of who serves them.

  Step 4. THE CLIENT APPROVES, in their own console under Our fleets. This is
  the safety catch in the whole flow: without it, any fleet knowing a TIN
  could attach itself to another fleet's client and start reading their
  bookings. Kangaru is NOT in this path — head office would be a bottleneck on
  every fleet's sales cycle.

  Step 6. A contract ends by ended_on. Never by deleting a client.

Exit, and this is gate 3: a fleet holding a `requested` row reads NOTHING of
that client — prove it with a refusal test and break it to watch it bite.
After approval, each fleet sees only its own trips, credit limit and invoices
for that client; the client sees both.
```

---

## K8 — Driver walk-in contracts · `/screen` · depends K2

```
/screen

[K preamble]

You are K8 — fleet-model-plan.md's F3, absorbed. Its §5 question 1 IS
ANSWERED: the driver asks, their fleet consents, Kangaru approves, waived
where drivers.owns_vehicle is true (there is no fleet to ask).

Questions 2 and 3 are still open and block the COMMISSION half, not the
contract half. Build the contract flow first and stop there if they are still
open when you reach it:
  2. who wins when a fleet's own booking and a walk-in want the same on-duty
     driver? (recommended: the fleet's own work, overridable per contract)
  3. does the fleet get a share of a walk-in run on its vehicle? (recommended:
     a fleet share on the contract, defaulting to zero — so the column exists
     before the argument does)

Any driver on any fleet may join the walk-in economy; Shanitah is contracted
site-wide from the start.
```

---

## K9 — Inventory · plain block · writes its own plan first

```
[K preamble]

You are K9. DO NOT START BUILDING. Write docs/inventory-plan.md first and
bring it to the owner.

Fuel, tyres, parts, consumables — owned by a fleet, never by Kangaru. Nothing
exists: no module, no table, no mention anywhere in the backend. This is a
stock-keeping system with issue-and-receipt, per-vehicle fuel logs and
consumption per kilometre. It is the largest single item in the platform plan
and it does not belong as a section in someone else's plan.

Start the plan with fuel: it is the daily cost, and the number nobody has
today is litres per kilometre against the odometer readings trips already
capture (ADR-0035, ADR-0047 — read what the odometer is and is not allowed to
be used for before you build a metric on it).
```
