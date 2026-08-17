# Go-live plan

Decided with the owner on 2026-08-17.

**Two tracks, different deadlines.**

- **Track A — the system goes live tonight.** Backend and web app on the
  owner's Coolify server. Corporate clients and walk-in customers order from
  the web app.
- **Track B — the driver app follows.** A **signed APK installed directly on
  fleet handsets** — no Play Store, no review, no developer account. The owner
  chose the **full audit** over the two-day deadline: *launch slips, quality
  does not.*

Track B's implementation detail is written after the audit's Phase 4 findings,
per `docs/ux-audit-plan.md`. What is fixed now is the sequence, the gates, and
the parts of Track B that do not depend on what the audit finds.

---

## Track A — tonight

### The blocker, before anything else

**`main` is not the app.** It is missing **247 backend files and 21,058
insertions** — PR #9, open since 14 August, 59 commits, no review, no checks
reported. On top of that, **125 files are uncommitted in the working tree**,
including 38 more backend module files and 4 ADRs.

If Coolify deploys `main` tonight it deploys a platform with **no dispatch
offers, no driver earnings or wallet ledger, no duty sessions, no promotions or
referrals, no driver notifications, and no driver app API at all.** The web app
would come up and look healthy.

Order of operations, and none of it is optional:

1. Commit the 125 working-tree files. Conventional Commits, split by module —
   commitlint gates the PR.
2. Run CI on the branch (`gh workflow run`; the workflow has
   `workflow_dispatch` for exactly this). The last green run *is* `HEAD`, so
   everything from 16–17 August has been verified by nothing.
3. Review and merge PR #9.
4. Deploy `main`.

### What the deploy must run — not just a web container

The code demands four processes. A single PHP container satisfies one of them.

| Process | Why it is load-bearing | Breaks if missing |
|---|---|---|
| **Scheduler** (`schedule:work` / cron) | `AdvanceDispatchOffers` runs **every ten seconds** | An offer nobody answers never advances to the next driver. Dispatch stalls silently. |
| **Queue worker** | `QUEUE_CONNECTION=database`; GPS batch-insert per ADR-0003 | GPS never lands, notifications never send. This process has already been found stopped once — see the worklog, 15 Aug. |
| **Redis** | ADR-0003: live positions are read from Redis, never MySQL | The live map goes blank. |
| **Persistent volume** | Driver documents, app-level encrypted (ADR-0033) | Uploads vanish on redeploy. |

Also required before drivers or clients touch it: `APP_KEY` set and kept
stable, HTTPS terminated, `php artisan migrate --force` in the release step,
`storage:link`, and the scheduler's other jobs — `AwardWeeklyBonuses`
(Mondays 03:15), `CloseStaleDutySessions` (every minute),
`PruneReportExports`, `sanctum:prune-expired`.

**Seed data is not production data.** `DriverAppSeeder` and the demo TOTP
secret must not run against the live database. AGENTS.md: staging uses
anonymized data, never a production dump — and the reverse holds too.

### Exit criteria for tonight

- `main` contains everything in this working tree, and CI is green on it.
- All four processes up on Coolify; a trip can be ordered from the web app and
  reach a dispatch offer.
- The audit log records a mutation, proving the append-only path works
  (AGENTS.md: this must exist before the first bank demo).

---

## Track B — the driver app

### B0 · Release plumbing — starts now, runs parallel to the audit

None of this depends on a single audit finding, and **none of it exists yet**.
It is the reason "two days" was never about the UI.

- **`eas.json` and an EAS project.** There is no build config in `mobile/` at
  all — the app has only ever run inside Expo Go. Needs an `apk` build profile
  (`buildType: apk`, not `app-bundle`, because these are sideloaded).
- **A signing keystore, backed up somewhere that is not a laptop.** Lose it and
  every handset must uninstall before it can take an update.
- **`EXPO_PUBLIC_API_BASE_URL` pointed at the Coolify domain over HTTPS.**
  Today it defaults to `http://10.0.2.2:8000/api/v1`, the emulator's route to
  the host machine. Android blocks cleartext by default in a release build, so
  HTTP would fail on the handset while working perfectly in Expo Go.
- **`versionCode` and an update path.** Sideloaded apps have no store to
  update them; decide now how handset #12 gets version 1.0.1.
- **FCM credentials** for `expo-notifications`, or push silently does nothing
  in a standalone build.
- **A CI job for `mobile/`.** It has never had one — jest, tsc, eslint and
  Prettier are local-only on the app about to be installed on fleet handsets.
  Three shared mobile files already fail `prettier --check` at `HEAD`.
- **A first release build installed on one handset and driven end to end**,
  before the audit's fixes land — so a build failure is found now rather than
  on the last day.

### B1 · The audit

`docs/ux-audit-plan.md`, all six phases, unchanged. Phase 4 is an approval
gate: nothing is implemented until the findings are signed off.

### B2 · Implementation

Written after Phase 4, from the approved findings. Its shape is fixed now:

- Ranked by cost to the driver, not ease of fix.
- One screen per commit, worklog claim first.
- Shared modules extended, never forked.
- Definition of Done per screen: contract, tests, module README, authorization.
- Every changed screen rendered on a handset with screenshots; every guard
  proved by mutation and restored.

### B3 · Release

Signed APK, installed on fleet handsets, against the live Coolify backend.

**Gates, all of which must be green:**

1. Phase 4 findings approved and implemented.
2. `mobile/` CI green — the job from B0.
3. Every changed screen verified on a real handset, not only the emulator.
4. A full trip driven end to end on a **release** build against **production**:
   offer → accept → pickup → odometer → in progress → complete → ledger entry.
   Expo Go against localhost proves none of it.
5. Rollback known: which APK version is the last good one, and where it is.

---

## What is not in this plan

- **Play Store.** A public listing needs a data-safety declaration, a privacy
  policy URL, and prominent-disclosure wording for `ACCESS_FINE_LOCATION`. It
  is a follow-up, not a gate on the fleet APK.
- **iOS.** `PRODUCT.md` is Android-first; the bundle identifier exists and
  nothing else does.
- **i18n extraction.** Strings are literals app-wide. Rewrites stay i18n-safe;
  extraction is separate work.
- **Office consoles for driver-app features.** Referrals, safety guidance and
  the emergency number, duty visibility, and tip confirmation are API-only —
  the driver app shows them and no administrator can see or change them. The
  worklog names the issue-reporting backend as the largest gap. All are
  recorded as findings; none is built by this plan.
