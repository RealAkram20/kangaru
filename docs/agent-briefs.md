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
