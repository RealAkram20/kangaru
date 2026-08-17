# Track A — parallel execution plan

The plan to hand to agents. Each work package below is a self-contained brief:
copy it, give it to one agent, and it has everything it needs.

Goal: **the backend and web app live on Coolify, with real clients ordering,
without losing the thing that makes this platform worth more than a cheaper
competitor — that every invoice is reproducible and no tenant can see another.**

Governed by `AGENTS.md`, `DESIGN.md`, `PRODUCT.md`, `docs/screen-rules.md` and
the `quality-control` skill. Those outrank this file.

---

## The binding constraint — read before assigning anyone

**Agent count is not the bottleneck. The shared working tree is.**

125 files are dirty right now, and this repo's `docs/agent-worklog.md` exists
entirely because parallel agents kept overwriting each other in it. Adding
agents to a dirty tree does not go faster; it loses work.

So the shape is fixed:

```
A0  (SOLO, BLOCKING — nobody else in the tree)
 │
 ├── W1-a  Deploy config        ┐
 ├── W1-b  Production config    │  parallel, disjoint files,
 ├── W1-c  Security gate        │  each in its own git worktree
 ├── W1-d  Runbook + rollback   │
 └── W1-e  Data protection      ┘
 │
 └── W2-a  Live verification    (needs a deploy to exist)
     W2-b  Go/no-go
```

---

## Rules every agent obeys

1. **Own a git worktree, not a branch in the shared tree.** `git worktree add`
   per agent. A worktree already exists and is provisioned — reuse rather than
   re-provision.
2. **Claim in `docs/agent-worklog.md` before the first edit.** Files owned and
   files shared, with the exact edit named. An entry written afterwards is a
   collision report.
3. **One agent owns `main`.** Named at assignment time. No other agent merges,
   force-pushes, or rebases `main`. A broken `main` at 2am is how tonight is
   lost.
4. **Run the `quality-control` decision loop before implementing.** Name the
   decisions; for each, ask whether a better version exists judged against the
   north star. Real forks go to the owner with concrete options. Obvious calls
   are made, stated, and not asked about.
5. **No new paid service, subscription, or metered API.** `PRODUCT.md` cost
   discipline; Coolify is self-hosted and that is the point. This is an owner
   decision, never an implementation detail.
6. **A file another agent owns is reported, not edited.**
7. **Report honestly.** What was verified, what was not, what was skipped.
   A gap someone can see is a gap they will not rebuild badly.

---

## A0 · Land the work — **SOLO, BLOCKING**

Nothing else runs while this does. One agent, alone in the tree.

**Why it is first.** `main` is missing **247 backend files / 21,058
insertions** (PR #9, open since 14 Aug, 59 commits, never reviewed), and **125
files are uncommitted** on top of that. Deploying `main` tonight ships a
platform with no dispatch offers, no driver earnings or ledger, no duty
sessions, no promotions or referrals, and no driver-app API — while the web app
comes up looking healthy.

**Do:**

1. Kill the hung `jest` process on `SafetyScreen.test.tsx` (PIDs 5368 / 23168
   at time of writing) before anything else.
2. Commit the 125 files, **split by module**, Conventional Commits — commitlint
   gates the PR. Multi-line messages go through `git commit -F <file>`; a
   chained here-string mangles into pathspecs on this machine.
3. `gh workflow run` CI against the branch. The workflow carries
   `workflow_dispatch` for exactly this, because it otherwise only fires on
   `main` and on PRs into it.
4. Fix whatever CI reports. Do not merge red.
5. Hand PR #9 to the owner for review.

**Do not:** reformat other agents' files. Three shared `mobile/` files already
fail `prettier --check` at `HEAD`; that is a recorded finding, not a licence to
touch sixty files and bury the real diff.

**Exit criteria:** working tree clean · CI green on the branch · PR #9 ready
for review with a description naming what it contains.

---

## W1-a · Coolify deployment configuration

**The single most important thing in this package: the app is four processes,
not one.** A default Coolify PHP deploy satisfies one of them and looks fine.

| Process | Why | Silent failure if missing |
|---|---|---|
| **Scheduler** | `AdvanceDispatchOffers` runs **every ten seconds** | An offer nobody answers never advances to the next driver. Dispatch stalls, no error anywhere. |
| **Queue worker** | `QUEUE_CONNECTION=database`; GPS batch-insert (ADR-0003) | GPS never lands, notifications never send. Already found stopped once — worklog, 15 Aug. |
| **Redis** | ADR-0003: live positions read from Redis, never MySQL | Live map blank. |
| **Persistent volume** | Driver documents, app-level encrypted (ADR-0033) | Uploads vanish on every redeploy. |

Also: `migrate --force` in the release step, `storage:link`, `config:cache` /
`route:cache`, HTTPS terminated, and the scheduler's other jobs —
`AwardWeeklyBonuses` (Mon 03:15), `CloseStaleDutySessions` (every minute),
`PruneReportExports`, `sanctum:prune-expired`.

**Recommendation, not a fork:** an explicit `Dockerfile` over Nixpacks
auto-detection. Four processes with different commands is exactly what
auto-detection gets wrong, and an explicit file is what a rollback can be
reasoned about.

**Owns:** `Dockerfile`, `.dockerignore`, any compose/process file, deploy
scripts. All new files — no collision with anyone.
**Must not touch:** `backend/config/*`, `.env.example` (W1-b owns those).
**Exit:** a deploy that comes up with all four processes running, proved by
`schedule:list` output and a queued job completing.

---

## W1-b · Production configuration and secrets

**Owns:** `backend/config/*`, `backend/.env.example`, `backend/bootstrap/app.php`.

- `APP_KEY` generated **once** and kept stable — rotating it makes every
  encrypted driver document unreadable.
- `APP_DEBUG=false`, `APP_ENV=production`. A stack trace is a data leak.
- **`DriverAppSeeder` and the demo TOTP account must not run against the live
  database.** AGENTS.md: staging uses anonymized data — the reverse holds too.
- `config/cors.php` is **not published**, so the framework default applies.
  Decide and pin it explicitly for the web app's origin and the mobile client.
- Sanctum token expiry and **per-client-app abilities** (ADR-0022) confirmed
  live, not just in tests.
- Structured JSON logs with `request_id`, `tenant_id`, `user_id`, `module`
  (AGENTS.md Observability). Log channel pointed somewhere that survives a
  redeploy.
- Rate limits confirmed in production, especially the OTP/SMS paths —
  AGENTS.md names SMS pumping fraud as a real East African cost, and it is a
  bill, not a hypothetical.

**Exit:** a documented, complete production env template with every value
either set or explicitly marked as owner-supplied. No secret in the repo —
gitleaks runs on every push.

---

## W1-c · Security gate — the one that protects the differentiator

**Why this package exists.** You are competing with companies that have more
engineers. You are not going to beat them on features tonight. What you have
that they do not is `PRODUCT.md`'s promise: audit-grade correctness for
corporate and bank clients. **A cross-tenant leak is the single worst bug this
platform can have** (ADR-0001), and 247 backend files are about to go live
having never been reviewed.

**Do:**

- Run the cross-tenant isolation suite, **both halves** (ADR-0006): that a
  client sees only their own, and that a platform user with no permission on a
  surface sees nothing of it either.
- **Census every route against a policy.** A route without a policy check fails
  review (AGENTS.md Security). Produce the list; a missing policy is a
  tonight-blocker, not a finding.
- Confirm cross-tenant access answers **404, never 403**.
- Verify the append-only `audit_log` actually records a mutation in the
  deployed environment. AGENTS.md: this must exist before the first bank demo.
- Confirm no resource spreads a whole object — `order_requests.details` carries
  `sender_phone` and `recipient_phone`, and a resource emitting that column
  wholesale leaks two numbers while looking harmless.

Coverage is better than feared: `backend/tests/Feature/Drivers/` already holds
18 test files including `DriverCrossTenantIsolationTest`. **This package
verifies against the deployed system, not only against green local tests.**

**Owns:** `backend/tests/Feature/Ci/*`, `backend/tests/Feature/Tenancy/*`, and
a findings document. **Must not** edit module source — a gap is reported to
whoever owns that module.
**Exit:** a route-by-route policy census with zero gaps, and both isolation
halves green **against the deployed database**.

---

## W1-d · Runbook and rollback

Deploys are "tagged, logged, and reversible" and the rollback is "written down
and rehearsed **before first client onboarding**" (AGENTS.md Delivery). Tonight
is first client onboarding.

**Owns:** `docs/runbook.md` (new).

Must contain: deploy steps · **rollback rehearsed at least once, not just
written** · what to do when the queue worker dies · how to tell whether the
scheduler is running · the minimum alert set (5xx > 2% for 5 min, oldest queued
job > 5 min, GPS lag > 60s, failed invoice generation, disk > 80%, cert expiry
< 14 days) · who is called at 2am.

**Exit:** a rollback performed on the live server and timed. An unrehearsed
rollback is a wish.

---

## W1-e · Data protection for the public order flow

**Real members of the public will place orders tonight**, submitting name,
phone, and pickup and drop-off addresses. The Uganda **Data Protection and
Privacy Act, 2019** applies (AGENTS.md Compliance).

**Owns:** the privacy page and its route in `frontend/`, `docs/data-inventory.md`.
**Coordinates with:** whoever owns `frontend/src/pages/public/*` — check the
worklog first.

Needs: a data inventory (what PII, where, why, retention) · the written
retention policy (trip PII 7 years, raw GPS 12 months, ex-employee accounts
anonymized after 90 days) · a privacy notice reachable **from the order form
before submission**, not buried in a footer · Personal Data Protection Office
registration requirements checked before launch.

**Exit:** a customer can read what happens to their data before they hand it
over. Everything else here can be week one; that sentence cannot.

---

## W2-a · Live verification — needs W1-a deployed

Not a test run. **Drive the real system.**

- Place an order from the public web app as a walk-in customer, end to end.
- Place one as a corporate client admin.
- Watch it become a dispatch offer, on the live server, with the scheduler
  running.
- Confirm the live map shows a position (proves Redis).
- Confirm an invoice reproduces from stored data (proves the differentiator).
- Sign in as Finance and as Super Admin — **both need a TOTP code**, generated
  from `mfa_secret` in the same shell call.

Use `playwright-core` with system Chrome, installed to the scratchpad, not
added as a repo dependency. Screenshots at every step — this method has already
caught bugs in this repo that green tests missed.

**Exit:** screenshots of a complete order → offer path on the production
domain.

---

## W2-b · Go / no-go

The owner's call, made against this list. **Any red is a no-go, not a
discussion:**

- [ ] `main` contains everything, CI green
- [ ] All four processes up; `schedule:list` correct; a queued job completed
- [ ] Route-by-route policy census, zero gaps
- [ ] Cross-tenant isolation green **against the deployed database**
- [ ] `APP_DEBUG=false`; no seeder or demo account in the live database
- [ ] Audit log recorded a real mutation
- [ ] Rollback rehearsed and timed
- [ ] Privacy notice readable before a customer submits an order
- [ ] Order → dispatch offer driven end to end on the production domain

---

## What this plan deliberately does not do

- **No driver APK.** Track B, `docs/go-live-plan.md`.
- **No UI/UX changes.** The audit runs separately; a redesign mid-deploy is how
  both fail.
- **No new dependency or paid service** without the owner.
- **No performance tuning.** Correctness tonight; p95 next week. The dashboard
  and alerts in AGENTS.md Observability are W1-d's list, not W1-d's build.
