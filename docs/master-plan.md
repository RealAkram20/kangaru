# Master plan

The top-level plan. Everything else hangs off this.

| Document | What it holds |
|---|---|
| **this file** | Decisions, the completeness gate, sequence, owners, go/no-go |
| `docs/track-a-parallel-plan.md` | The six Track A agent briefs, verbatim |
| `docs/ux-audit-plan.md` | The driver-app UI/UX audit, six phases |
| `docs/go-live-plan.md` | Track A / Track B split and release plumbing |
| `docs/agent-worklog.md` | Who is building what, right now. Binding. |

---

## 1 · Decisions on record

Taken with the owner, 2026-08-17. These are settled; an agent that disagrees
raises it, does not re-decide it.

1. **The whole system goes live tonight** — corporate clients *and* public
   walk-in customers ordering from the web app. The owner was shown that this
   puts data-protection work on the critical path and chose it deliberately.
   **W1-e is therefore a tonight-blocker, not a parallel nicety.**
2. **The driver app ships as a signed APK on fleet handsets.** No Play Store,
   no review, no developer account.
3. **The full UI/UX audit runs. The APK slips.** Quality over the two-day date.
4. **A blank, fully isolated Coolify project.** The server already hosts other
   projects, so **every dependency is containerised for this project alone** —
   its own MySQL 8, its own Redis, its own volumes. No shared database server,
   no shared cache. A noisy neighbour must not be able to take down a bank
   client's dispatch, and this project must not be able to take down theirs.
5. **Only fully operational features are exposed.** The rule that produces the
   rest of this document — see §2.

---

## 2 · The completeness gate

**A feature ships only when its whole loop is closed.** Anything else is
hidden, not shipped — and hidden deliberately, with the gap written down.

The four parts of a loop:

| Part | Question |
|---|---|
| **Backend** | Does an endpoint exist, with a policy and a contract entry? |
| **Actor surface** | Can the person who *does* the thing reach it? |
| **Office surface** | Can an administrator *see and answer* it? |
| **Return path** | Does the person who acted find out what happened? |

A feature missing any part is **half-built**, and half-built features are what
make an app feel unreliable long before they cause a bug. Two examples,
verified in the code today:

- **Driver profile photo.** Backend complete and tested (`GET/POST/DELETE
  me/photo`, ADR-0041). `DrawerContent` displays `photo_url`. **No upload UI
  exists anywhere**, so no driver can ever set one. A finished backend nobody
  can reach.
- **Driver documents / KYC.** Contrary to the assumption going in, this loop is
  **almost closed**: the driver uploads (`POST me/documents`), the office
  reviews (`DriverDocumentsDialog`, reachable from `DriversPage`, hitting
  `drivers/{driver}/documents/{document}/verify|reject`). **The return path is
  missing** — nothing notifies the driver, so they reopen the screen to guess.

### Seeded findings — features whose loop is open

From the worklog's own "not built, deliberately" entries and a cross-surface
census. **W1-f confirms or corrects every row; none of this is acted on before
it is confirmed.**

| Feature | Backend | Driver app | Office console | Return path |
|---|---|---|---|---|
| Trip lifecycle, odometer, dispatch | yes | yes | yes | yes |
| Driver applications (self-registration) | yes | yes | yes | yes |
| Driver documents / KYC | yes | yes | yes | **missing** |
| Wallet ledger, earnings | yes | yes | yes | n/a |
| Settlement requests | yes | yes | confirm in W1-f | confirm |
| **Profile photo** | yes | **missing** | none | n/a |
| **Referrals** (ADR-0037) | yes | yes | **none — nobody can see who introduced whom** | **none** |
| **Peak hours / promotions** (ADR-0036) | yes | yes | **none found** | **none** |
| **Performance / duty sessions** (ADR-0038) | yes | yes | **no office view of who is on duty** | n/a |
| **Tips** (ADR-0034) | yes | yes | **no console to confirm a tip** | **none** |
| **Safety guidance, emergency number** | yes | yes | **API-only, no console** | n/a |
| **Driver issue reporting** | **none** | none | none | none |

The last row is the worklog's own verdict on the largest gap: *a driver raises
a request, an administrator answers it in the web app.* It needs a table,
endpoints, a policy, a console and an ADR. It is **not** built by this plan.

### What the gate does tonight

For every open loop, W1-f produces **one of three outcomes**, and the owner
picks per row:

- **Close it** — if the missing part is small and the feature is load-bearing.
- **Hide it** — the surface is not reachable in this release; the code stays.
- **Ship it half-open, knowingly** — only where the visible half is honest on
  its own and the gap is recorded.

**Nothing is deleted.** No surface disappears on an agent's judgement.

---

## 3 · Sequence

```
A0   Land the work            SOLO, BLOCKING — nobody else in the tree
 │
 ├─ W1-a  Dockerised isolated stack   ┐
 ├─ W1-b  Production config           │
 ├─ W1-c  Security gate               │  parallel, own worktree each
 ├─ W1-d  Runbook + rollback          │
 ├─ W1-e  Data protection  ★BLOCKER   │
 └─ W1-f  Completeness census         ┘
 │
 W2-a  Live verification      (needs W1-a deployed)
 W2-b  GO / NO-GO             owner's call
 │
 ═══ TONIGHT ENDS HERE ═══
 │
 B0   Release plumbing        (starts now, parallel to everything)
 B1   UI/UX audit             docs/ux-audit-plan.md, six phases
 B2   Implementation          written from the approved findings
 B3   Signed APK on handsets
```

Full briefs for A0 and W1-a…W2-b are in `docs/track-a-parallel-plan.md`. Two
of them change under §1's decisions, and one is new:

### W1-a is now infrastructure, not configuration

The Coolify server hosts other projects. This project gets its **own containers
for everything**: MySQL 8, Redis, the PHP app, a queue worker, a scheduler —
with **CPU and memory limits set on each**, so a runaway query here cannot
starve a neighbour, and a neighbour cannot starve dispatch.

Non-negotiable, because a default Coolify PHP deploy satisfies one of these and
looks perfectly healthy:

| Process | Why | Silent failure if missing |
|---|---|---|
| **Scheduler** | `AdvanceDispatchOffers` every **ten seconds** | An offer nobody answers never advances. Dispatch stalls, no error anywhere. |
| **Queue worker** | `QUEUE_CONNECTION=database`; GPS batch-insert (ADR-0003) | GPS never lands, notifications never send. Found stopped once already. |
| **Redis, dedicated** | ADR-0003 reads live positions from Redis, never MySQL | Live map blank. |
| **MySQL 8, dedicated** | Tenancy, billing, `trip_locations` partitioned monthly | Shared-server contention hits a bank client's dispatch. |
| **Persistent volumes** | Driver documents, app-level encrypted (ADR-0033) | Uploads vanish on redeploy. |

Plus, before any client data lands: **an automated MySQL backup schedule, and
one restore actually performed.** An untested backup is not a backup, and
tonight is the last moment it costs nothing to find that out.

### W1-e is a hard blocker

Public walk-ins were included, so members of the public hand over name, phone,
and pickup and drop-off addresses tonight. The Uganda **Data Protection and
Privacy Act, 2019** applies. The go/no-go cannot pass without a privacy notice
**readable from the order form before submission**, a data inventory, and the
written retention policy (trip PII 7 years, raw GPS 12 months, ex-employee
accounts anonymized after 90 days).

### W1-f · Completeness census — new package

**Owns:** `docs/feature-completeness.md`. **Edits no source.**

Method, per feature: walk the four parts of the loop in §2 against real code —
route file, policy, `docs/api/openapi.yaml`, the driver screen, the web page,
the notification. Confirm or correct every seeded row above. Output one table
plus, for each open loop, the three options with a recommendation and a cost.

**Exit:** every feature classified, and a list of surfaces to hide tonight
ready for the owner's yes/no. **Report only — hides nothing itself.**

---

## 4 · Rules every agent obeys

1. **Own a git worktree, not a branch in the shared tree.** A worktree is
   already provisioned — reuse it rather than re-provisioning.
2. **Claim in `docs/agent-worklog.md` before the first edit**, files owned and
   files shared, with the exact edit named.
3. **One named agent owns `main`.** No other agent merges, rebases, or
   force-pushes it.
4. **Run the `quality-control` decision loop before implementing.** Real forks
   go to the owner with concrete options; obvious calls are made and stated.
5. **No new paid service, subscription, or metered API** without the owner.
   Coolify is self-hosted and that is the point.
6. **A file another agent owns is reported, not edited.** A file found
   mid-mutation is someone proving a test bites — leave it.
7. **Report honestly**: verified, not verified, skipped.

---

## 5 · Go / no-go — the owner's call

**Any red is a no-go, not a discussion.**

- [ ] `main` contains everything in the working tree; CI green
- [ ] All five containers up, each with resource limits; `schedule:list`
      correct; a queued job completed
- [ ] MySQL backup scheduled **and one restore performed**
- [ ] Route-by-route policy census, zero gaps
- [ ] Cross-tenant isolation green **against the deployed database**, both
      halves (ADR-0006)
- [ ] `APP_DEBUG=false`; no seeder, no demo TOTP account in the live database
- [ ] Audit log recorded a real mutation
- [ ] Rollback rehearsed and timed
- [ ] **Privacy notice readable before a customer submits an order**
- [ ] Completeness census delivered; every surface the owner chose to hide is
      hidden
- [ ] Order → dispatch offer driven end to end on the production domain, as a
      corporate client and as a public walk-in

---

## 6 · Why the bar stays here

The competitors named — Uber, Bolt — have more engineers and will out-ship this
team on features indefinitely. That race is not winnable and is not the plan.

What this platform has instead is `PRODUCT.md`'s actual claim: **audit-grade
correctness.** Every invoice reproducible from stored data, versioned immutable
rate cards, an append-only trip timeline, odometer readings reconciled against
GPS, and no tenant able to see another. A bank's transport officer can audit any
trip end to end. That is worth more to the anchor client than any feature on
this roadmap, and it is the one asset a rushed launch can destroy in a single
night — a cross-tenant leak is, by ADR-0001's own words, the worst bug this
platform can have.

So: ship the whole surface tonight, as decided — and hold every gate in §5.
The gates are not what slow this down. They are the product.

---

## 7 · Explicitly not in this plan

- **Play Store listing.** Needs a data-safety declaration, privacy policy URL
  and prominent-disclosure wording for `ACCESS_FINE_LOCATION`. Follow-up.
- **iOS.** `PRODUCT.md` is Android-first.
- **i18n extraction.** Strings are literals app-wide; rewrites stay i18n-safe.
- **Driver issue reporting.** The largest known gap. Needs its own ADR.
- **The missing office consoles** (referrals, promotions, duty visibility, tip
  confirmation, safety guidance). W1-f classifies them; building them is
  week-one work.
- **Performance tuning.** Correctness tonight; p95 next week.
