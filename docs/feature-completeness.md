# Feature completeness census

> **Its rule is now gate 1 of `docs/platform-plan.md` §2** — a loop has four parts, and a feature missing any one is half-built. The census itself is unchanged.

**Package W1-f.** Owner: this document. **Edits no source, hides nothing,
deletes nothing.** It reports so the owner can choose.

Written 2026-08-17. Begun against the working tree at `9850702` **plus its 131
uncommitted files** — deliberately, because the features being censused
(promotions, referrals, duty sessions, the driver photo) existed only there, and
a census taken at that `HEAD` or in a worktree would have reported three of them
as absent and been confidently wrong.

**A0 then landed 11 commits mid-census and the tree is now clean at `46d32b3`.**
Every finding below was re-checked against that, and the route census in §4 was
re-run rather than assumed — one of A0's commits was `docs(api): the contract for
everything above`, which could have closed §2.3. It did not.

## The gate being applied

`docs/master-plan.md` §2. A feature ships only when its whole loop is closed:

| Part | Question |
|---|---|
| **Backend** | Does an endpoint exist, **with a policy and a contract entry**? |
| **Actor surface** | Can the person who *does* the thing reach it? |
| **Office surface** | Can an administrator *see and answer* it? |
| **Return path** | Does the person who acted find out what happened? |

The brief warned that two seeded rows were already wrong when first assumed, so
**every row below was walked against real code** — the route file, the policy,
`docs/api/openapi.yaml`, the driver screen, the web page, the notification.
Seven rows changed. The corrections are §2, because they are the part of this
document with new information in it.

---

## 1 · The verdict

| Feature | Backend | Actor surface | Office surface | Return path | Verdict |
|---|---|---|---|---|---|
| Trip lifecycle, odometer, dispatch | yes | yes | yes | yes | **closed** |
| Wallet ledger, earnings (driver-facing) | yes | yes | **none** ⚠ | n/a | **open** |
| Driver applications | yes | yes | yes | **none** ⚠ | **open** |
| Driver documents / KYC | yes | yes | yes | **not told** | **open** |
| Settlement requests | yes | yes | **none** | **not told** | **open** |
| Tips (ADR-0034) | yes | yes | **none** | **not told** | **open** — *same loop as settlement* |
| Profile photo (ADR-0041) | **no contract** ⚠ | **none** | n/a | n/a | **open** |
| Referrals (ADR-0037) | yes | yes | **config only** | via ledger | **open, benign** |
| Peak hours / promotions (ADR-0036) | yes | yes | **config only** ⚠ | via ledger | **open, benign** |
| Performance / duty sessions (ADR-0038) | yes | yes | **presence only** ⚠ | n/a | **open, benign** |
| Safety guidance, emergency number | yes | yes | **API only** | n/a | **open** |
| Driver changes own password | yes | yes | n/a | yes | **closed** |
| Driver **edits own profile** | **none** | **none** | office only | n/a | **open** — §3.8 |
| Driver **closes own account** | **none** | **none** | none | none | **not built** — §3.8 |
| Driver issue reporting | yes | yes | yes | yes | **closed 2026-08-17, ADR-0044** — see §3.9 |

⚠ = this cell differs from the seeded table in `master-plan.md` §2.

**Only one surface in this platform needs hiding tonight** (§3.1). One thing
needs closing and is nearly free (§3.4). One thing is **failing CI right now**
and belongs to A0 (§4).

---

## 2 · Corrections to the seeded table

### 2.1 · The office cannot see a driver's money at all — *new gap*

The seeded table records **"Wallet ledger, earnings · office console: yes"**.
There is no such surface, and no endpoint behind one.

Every office-side route in the Drivers module (`Modules/Drivers/Routes/api.php`,
lines 21–175) is one of: drivers CRUD, attach/detach an account, the settlement
queue, document review, the applications queue. There is **no
`drivers/{driver}/ledger-entries` and no `drivers/{driver}/earnings`**. The
ledger is exposed only as `GET me/ledger-entries` — the driver's own token, the
driver's own rows.

Checked from three directions before claiming it: the route list, a grep of
`frontend/src` for any caller, and the Reports module. Reports' "ledger" is the
**invoice** ledger (`FinancialActivityRepository` — issued less credited); the
`drivers` fleet report carries trips, distance, time on the road and variances
flagged, and **no money**.

**Why this one matters more than its row suggests.** The office is expected to
confirm settlement requests, and confirming one *writes a ledger entry* — money
in somebody's pay. It would be doing that without being able to see the balance
it applies to. That is the operational hazard, not the missing page.

### 2.2 · A rejected applicant is never told anything — and never can be

The seeded table marks driver applications **fully closed**. The return path
does not exist.

`DriverApplicationService::approve()` and `reject()` send nothing — no
notification, no mail. This is not an oversight to be argued with; it is
structural. **Only five notification types exist in the entire platform**
(`Modules/Notifications/Enums/NotificationType.php`): `booking.approved`,
`booking.rejected`, `report.export.ready`, `order_request.received`,
`trip.offered`. There are exactly five dispatch sites in the codebase to match.
None concerns an application.

The two halves are not equally bad:

- **Approved** — the applicant chose their own password at submission, and
  `approve()` passes that same hash to `DriverAccountService::open()`. So they
  *can* sign in, and a successful login is an implicit answer. Nobody tells them
  when to try.
- **Rejected** — there is nothing. No account is created, so there is no screen
  they could open. `rejection_reason` is stored **for the office**. The
  applicant waits indefinitely, and the platform's honest answer to "what
  happened to my application" is silence.

**This is the worst return-path gap in the census**, because it is the only one
where the actor is a **member of the public** with no surface of any kind.

**It is also a W1-e matter, and W1-e should be told.** The platform holds a
rejected stranger's name, phone, email and a rejection reason indefinitely, with
no notice to them and no retention rule. That belongs in `docs/data-inventory.md`
whatever is decided about the notification.

### 2.3 · The driver photo has no contract entry, and CI is red because of it

Seeded as **"Backend: yes"**. Three routes exist — `GET`, `POST`, `DELETE
/api/v1/me/photo` — and the gate asks for "an endpoint, with a policy **and a
contract entry**".

- **Policy: correctly absent.** No id in any of the three paths; the driver is
  the token. The route file documents exactly this, and it is right.
- **Contract entry: missing.** `docs/api/openapi.yaml` describes `photo_url` on
  the driver schema (ADR-0041) and declares **no `/me/photo` path at all**.

`backend/tests/Feature/Ci/OpenApiRouteCensusTest.php` asserts every `api/v1`
route appears in the spec, with **no exemption list**. So it is red. Verified by
running the census logic outside the suite (§5): 156 routes, 153 spec
operations, **three undocumented, zero phantom**.

**This is A0's, not a Track B nicety** — see §4.

### 2.4 · Peak hours and referrals *are* configurable by the office

Seeded as "no office console found" (peak) and "none" (referrals). The office
can already set both, in `SystemSettingsPage.tsx`'s billing group:
`peak_enabled`, `peak_starts_at`, `peak_ends_at`, `peak_uplift_percent`,
`referral_enabled`, `referral_trip_target`, `referral_reward_amount_minor`.

What is missing is **visibility, not control**: no surface lists who earned a
peak uplift, and none lists who introduced whom. For referrals that is sharper
than the seeded row — **there is no referral endpoint anywhere in the
platform**. Referrals surface only inside the `me/promotions` payload.

### 2.5 · The office *can* see who is on duty

Seeded as "no office view of who is on duty". `LiveMapPage` calls
`/live-positions`, which is precisely that view, and ADR-0003 reads those
positions from Redis.

What ADR-0038 added and nobody can see is **duty-session history** — hours
worked over a week. Presence is visible; the timesheet is not.

### 2.6 · Tips are not a separate feature

Seeded as its own row with "no console to confirm a tip". True, but it is the
**same console**: a tip is `SettlementRequestKind::TIP` ("Tip declared"). A
driver declares one through `POST me/settlement-requests` and the office
confirms it through `settlement-requests/{id}/confirm`, exactly like a payout or
a remittance — the kind differs only in that it writes a pair of ledger entries
rather than one signed entry, because a tip is commissionable (ADR-0034 §2).

**One page closes two rows.** That changes the cost of §3.1 materially.

### 2.7 · The safety guidance is half-exposed, not un-exposed

Seeded as "API-only, no console" — nearly right, and the detail matters.
`legal.safety` **is** returned in the legal group. But `LegalCard` in
`SystemSettingsPage.tsx` renders and saves only `terms` and `privacy`, and the
`safety` group holding **`emergency_number`** has no card at all.

**Checked and found safe:** a partial group save does *not* wipe its siblings.
`SettingsService::setGroup()` iterates only the keys supplied and does one
`updateOrCreate` each, so saving terms and privacy cannot blank the safety text.
Worth stating because W1-e will be editing `legal.privacy` tonight through this
exact card, and the hazard was worth ruling out rather than assuming.

### 2.8 · Confirmed exactly as seeded

- **Driver documents / KYC** — driver uploads (`DocumentsScreen`, line 90),
  office reviews (`DriverDocumentsDialog`, reachable from `DriversPage`), **and
  no notification exists** for verify or reject. Return path confirmed missing.
- **Settlement requests** — office console confirmed **absent**: zero references
  to `settlement` anywhere in `frontend/src` outside unrelated billing copy.
- **Driver issue reporting** — confirmed nothing. `SupportScreen` opens `tel:`
  and posts nowhere.
- **Trip lifecycle, odometer, dispatch** — closed. All four parts present,
  including the return path (`TripOfferedNotification`, push *and* the in-app
  row so a driver who refused the OS permission is still told).

---

## 3 · The open loops, with three options each

Cost key, in layers rather than hours: **XS** one file, no new endpoint ·
**S** one layer · **M** endpoint + surface + contract · **L** new table, ADR or
migration.

### 3.1 · Settlement requests and tips — *the one that must not ship as it is*

Drivers can raise requests that **only an API client can answer**. ADR-0032's
own Consequences section names this as the next step.

| Option | What it means | Cost |
|---|---|---|
| **Close** | One `SettlementRequestsPage` — index, confirm, decline, gated on `drivers.manage` — plus a nav entry. Endpoints exist, are policy-gated and **are** in the contract. Frontend only. | **M** |
| **Hide** | Remove Withdraw and Declare-a-remittance from `WalletScreen`, and tip declaration with them. | **S** |
| **Half-open** | Drivers keep asking into a void. | — |

**Recommendation: close it, or hide it. Never ship it half-open.** This is the
one row where the half-open option is not merely imperfect but dishonest: it
creates an expectation about somebody's pay and answers it with nothing. The
one-open-request-per-kind rule makes it worse — a driver whose request is never
answered cannot even ask again.

Closing is a frontend-only page against endpoints that already exist, and it
closes the tips row for free (§2.6). If tonight has room for one build, this is
the one — and **build §3.2 with it**, because confirming a payout blind is the
real hazard.

### 3.2 · The office's view of a driver's money — *bundle with 3.1*

| Option | What it means | Cost |
|---|---|---|
| **Close** | `GET drivers/{driver}/ledger-entries` — policy, contract entry — plus a panel on `DriversPage`. | **M** |
| **Half-open** | Confirm settlements without seeing the balance. | — |
| **Hide** | n/a — there is nothing exposed to hide. | — |

**Recommendation: close it if and only if §3.1 is closed.** If settlement is
hidden tonight, nobody is confirming anything and this can wait for week one.
If settlement ships, this ships with it.

### 3.3 · Driver applications — the rejected stranger

| Option | What it means | Cost |
|---|---|---|
| **Close** | One notification type, one Notification class, one dispatch line — the recipe `NotificationType`'s own docblock gives. **Mail, not database**: a rejected applicant has no account and no inbox, so a `database` channel would deliver to nobody. | **S** |
| **Half-open** | Approved applicants discover it by trying to log in; rejected ones are never told. | — |
| **Hide** | Take down public driver self-registration. | **S** |

**Recommendation: close the rejection half at least, by mail.** The approval
half is defensible half-open — the applicant chose their password and can sign
in. The rejection half is not defensible at all, and the fix is one mail.

Note the restraint rule before adding it: `NotificationType`'s docblock says a
type not on AGENTS.md's list "needs an argument, not just a use case". The
argument here is that **the recipient has no other surface in the platform** —
which is not true of any other gap in this census.

### 3.4 · Safety guidance and the emergency number — *cheapest high-value close*

| Option | What it means | Cost |
|---|---|---|
| **Close** | Add `safety` to `LegalCard`'s two fields, and one card for the `safety` group's `emergency_number`. One file, no backend, no contract change, no ADR. | **XS** |
| **Half-open** | The number stays API-only. | — |

**Recommendation: close it.** This is an **emergency telephone number** that
today only somebody with an API client can change. If it is wrong on launch
night, nobody in the office can fix it, and ADR-0040's stated point is that "no
emergency number is ever hardcoded" — which is undermined by making it
un-editable in practice. One frontend file, and the `useSave('legal')` pattern
already exists beside it.

### 3.5 · Driver documents — told, or left to check

| Option | What it means | Cost |
|---|---|---|
| **Close** | One notification type + one dispatch line in the review service. The driver's in-app inbox already exists (`NotificationsScreen`). | **S** |
| **Half-open** | The driver reopens the Documents screen and reads the status and the rejection reason, which are both already there. | — |

**Recommendation: ship half-open tonight, close in week one.** Unlike §3.3 the
actor *has* a surface showing the real answer, including why a document was
rejected. They are un-nudged, not uninformed. Do not hide it — KYC is
load-bearing.

### 3.6 · Profile photo

| Option | What it means | Cost |
|---|---|---|
| **Contract entry** | Three paths in `openapi.yaml`. **Not optional — CI is red.** See §4. | **XS** |
| **Close** | An upload control on `ProfileScreen`. `DocumentsScreen` and `OdometerScreen` already use `expo-image-picker`, so the pattern and the permission flow exist. | **S** |
| **Half-open** | The drawer shows a placeholder forever; no driver can ever set a photo. | — |

**Recommendation: fix the contract tonight (it is a CI blocker regardless),
ship the feature half-open, build the upload in Track B.** Nothing is dishonest
about a drawer with no photo in it. Nothing is hidden either — there is no
surface to hide, which is the whole finding.

### 3.7 · Referrals, peak hours, duty sessions — the benign three

All three have a **closed money loop and an open reporting loop**: the office
configures it, the driver sees it, `QualifyReferralForCompletedTrip` /
`PeakHoursService` pay it, and the ledger records it. What is missing is an
office *view*.

**Recommendation: ship all three half-open, knowingly.** Each is week-one
reporting work (**M** apiece: referrals need a new endpoint entirely, §2.4).
Nothing on a driver's screen is untrue and nobody is waiting on an answer.

**One risk to record rather than fix: self-referral.** Nobody can list who
introduced whom, so nothing detects a driver referring themselves under a second
identity. The mitigating control is real and deliberate — ADR-0037 §5 resolves
the code **at approval, in front of a human reviewer**, never at submission.
That is why half-open is defensible here; it is not why it is permanent.

### 3.8 · The driver's own account — *raised by the owner during this census*

> "The driver should be able to edit their profile information, account
> passwords, delete the account etc. The profile page should be complete and
> full control. What we have as the current profile page is not complete."

Confirmed: `ProfileScreen` is a **read-only display**. Its only interaction is a
row that navigates to Documents. The ask splits into three parts with three
different answers, and they should not be built as one thing.

#### (a) Change password — **already built, and in the wrong place**

`PATCH /auth/password` exists, is authenticated, and is fully wired:
`SettingsScreen` → "Change password" → `PasswordScreen` → `changePassword()`.
`POST /auth/password/forgot` and `/reset` exist too (ADR-0028 §2), with
`ForgotPasswordScreen` behind them. **This loop is closed.**

So the gap is not capability, it is **placement** — it lives under Settings, and
the owner went looking for it on Profile and did not find it. That is precisely
the complaint that opened the UX audit: *"features spread across pages instead of
placed where drivers expect them."* It belongs to **B1's information-architecture
phase**, and the fix is a row or a cross-link, not an endpoint. **XS.**

#### (b) Edit profile information — needs an endpoint **and a decision**

There is **no write route on `me/profile`** — `GET` only. Today a driver's name,
phone or email can be changed only by the office, through
`PATCH drivers/{driver}`, which accepts `name`, `phone`, `email`,
`license_number`, `license_expiry`, `vehicle_id` and `status`.

**This is a real fork and it is the owner's, because "full control" cannot mean
all seven fields.** Two of them are not the driver's to assert:

- **`license_number` and `license_expiry` are KYC facts the office verifies**
  (ADR-0033). A driver who can edit their own licence expiry can self-certify
  their own compliance, and the document-review queue stops meaning anything.
- **`status`** (`active` / `suspended` / `inactive`) is a dispatch control. A
  suspended driver who can set themselves active has undone the suspension.
- **`vehicle_id`** is a Fleet allocation, not a preference.
- **`email` is the login identity.** Changing it changes the credential the
  driver signs in with, so it needs the same care as a password change —
  re-authentication at minimum, and a decision about whether the old address is
  notified.

| Option | What it means | Cost |
|---|---|---|
| **Close, narrow** | `PATCH me/profile` accepting **`phone` only** (and arguably `name`), contract entry, and edit controls on `ProfileScreen`. Everything else stays office-only, with the screen saying *why* a field is not editable rather than hiding it. | **M** |
| **Close, wide** | Add `email` with re-authentication and a notification to the old address. | **M+** |
| **Half-open** | Profile stays read-only; a driver rings the office to correct their own phone number. | — |

**Recommendation: close it narrow.** A phone number is the field that actually
goes stale, it is the one a driver is the authority on, and it carries no
compliance meaning. Explicitly show the licence fields as office-managed with a
one-line reason — that turns a read-only screen from *incomplete* into
*deliberate*, which is the difference the owner is reacting to.

#### (c) Delete the account — **collides with the platform's core claim**

Nothing exists: no `DELETE me/account`, no self-service closure of any kind.
(`DELETE drivers/{driver}/account` is the *office* detaching a login under
ADR-0016 — a different act by a different actor.)

**A hard delete is not available to this platform at any price.** `PRODUCT.md`
and `master-plan.md` §6 stake everything on audit-grade correctness: every
invoice reproducible from stored data, an append-only trip timeline, an
append-only driver ledger. A driver with completed trips, ledger entries and
invoices behind them cannot be erased without breaking the one property the
anchor client is buying. Deleting them would also silently rewrite finished
invoices' subjects.

**The plan has already decided the shape**, and it should be followed rather than
re-litigated: `master-plan.md` §3 W1-e sets retention as *"ex-employee accounts
anonymized after 90 days"*, with trip PII kept 7 years. So "delete my account"
must mean **close and anonymize on the retention schedule**, not erase. That is
also the correct reading of the DPPA 2019: an erasure right qualified by other
lawful bases for retention, which accounting records are.

| Option | What it means | Cost |
|---|---|---|
| **Close, properly** | A closure **request**, reusing the `DriverSettlementRequest` pattern exactly — driver asks, office confirms, confirmation detaches the login and schedules anonymization; ledger and invoices survive with an anonymized subject. Needs an **ADR**, a table or an extension of the settlement table, an office console, and a return path. | **L** |
| **Half-open** | A driver asks the office by phone. `SupportScreen` already dials. | — |
| **Hide** | n/a — nothing is exposed. | — |

**Recommendation: do not build this tonight; build it in week one with an ADR.**
Two reasons, and neither is reluctance:

1. **An irreversible, unaudited account-closure path shipped in a hurry is the
   one bug class this platform cannot absorb.** It touches the ledger, invoices
   and the trip timeline at once.
2. **The usual forcing function does not apply.** Self-service account deletion
   is a *Play Store* requirement, and decision 2 ships a signed APK with no Play
   Store listing (`master-plan.md` §7). **It becomes mandatory the day a Play
   Store listing is wanted** — worth knowing now, because it also gates the
   data-safety declaration §7 already defers.

Until then the honest surface is a Profile screen that says the office closes
accounts and offers the call — not a button that appears to do it.

**Cross-reference for W1-e:** (b) and (c) are both data-subject rights under the
DPPA 2019 — correction and erasure. `docs/data-inventory.md` should record which
are self-service, which are office-mediated, and how a driver exercises each.
Right now the answer is "ring the office", and that is a defensible answer only
once it is written down somewhere a driver can read it.

### 3.9 · Driver issue reporting — ~~not built, and correctly out of scope~~ **built, 2026-08-17 (ADR-0044)**

The census was right about the state of the code and wrong about one thing, and
the owner is the one who found it. This section read:

> `master-plan.md` §7 excludes it; it needs a table, endpoints, a policy, a
> console and an ADR (**L**). **No action, and nothing to hide**, because the
> current surface does not overclaim: `SupportScreen` offers a phone call and
> delivers a phone call. That is the honest version of an unbuilt feature.

**The surface did overclaim** — not on the Support screen, which was honest, but
one screen earlier. Help & Safety drew five rows shaped exactly like a ticket
queue (*Report an issue*, *Passenger issue*, …), all five opening the same
contact card, with the sentence that told them apart passed as an accessibility
label only. The owner read them as *"repeated and fake"* and asked whether they
were wired to anything. They were not.

**Now closed, all four parts:** `support_requests` + `Modules\Support` (backend),
`ReportIssueScreen` / `MyReportsScreen` (driver app), `SupportRequestsPage`
(office console), and `driver.support.answered` (return path). There is no
"close without answering" anywhere in it, which is what keeps the loop closed by
construction rather than by discipline.

**A lesson for the rest of this census that is worth stating:** a loop can be
open at the *entry point* rather than at the endpoint. Every part of §3.9's
original reasoning was about what the backend lacked, and the defect a human
noticed was five rows that looked like a form. Rows that imply a feature are
part of the loop.

---

## 4 · One thing that cannot wait: CI is red, and it is A0's

**`OpenApiRouteCensusTest` fails at the current working tree.** Three routes
have no contract entry:

```
GET    /api/v1/me/photo
POST   /api/v1/me/photo
DELETE /api/v1/me/photo
```

**Re-verified after A0's 11 commits, and it is now worse, not better.**
`DriverPhotoController` is committed (`d804f2f`), and A0's own
`5801b70 docs(api): the contract for everything above` did **not** add the three
paths — `me/photo` still appears zero times in `openapi.yaml`. So this is no
longer a local-only failure in an uncommitted file: **it is on the branch, and it
fails A0's own exit criterion** ("CI green on the branch").

The fix is three paths in `docs/api/openapi.yaml` — a documentation change, not a
source change. Flagged here rather than fixed: **the contract file is not mine**,
several worklog entries claim specific blocks in it, and W1-f edits no source.

---

## 5 · What was verified, and how

**Verified by running:** the route census, reproduced outside the Pest suite
(`artisan route:list --json` diffed against the spec with the same Symfony YAML
parser the real test uses). 156 routes, 153 spec operations, three undocumented,
zero phantom. Two independent methods agree — a grep for `me/photo` in the spec
returns nothing. The result is not vacuous: the spec side parsed correctly, or
all 153 operations would have shown as phantom.

**Verified by reading real code**, not by transcribing the seeded table: every
row in §1. Route files, the notification enum and its five dispatch sites,
policies, `openapi.yaml`, the frontend page and dialog list, the mobile screen
list, the drawer's fifteen rows, `SettingsService::setGroup`, and the Reports
module.

**NOT verified:**

- **The Pest suite was not run.** Deliberate: A0 is live in this tree and the
  test database is shared — memory of this repo says two concurrent runs
  corrupt each other. My replication of `OpenApiRouteCensusTest` is a faithful
  transcription of its logic, not the gate itself. **A0 should let CI be the
  authority.**
- **Nothing was verified against a deployed system.** No deploy exists yet
  (W1-a). Every finding here is about code in this tree.
- **No screen was rendered and no endpoint was called.** This package reads;
  W2-a drives the real thing.
- **Permission and client-scope gating on the `/me` routes was not audited.**
  `app/Support/Auth/ClientScope.php` is modified in the tree and per-client-app
  abilities (ADR-0022) are **W1-c's** census, not this one. I did not check
  whether a non-driver token can reach `me/promotions`.

**Deliberately not done:** nothing hidden, nothing deleted, no source file
edited, no missing console built, no notification type added, and no row in
`master-plan.md` §2 rewritten — the corrections are §2 of this document, for the
owner to fold back or reject.

---

## 6 · The list the owner asked for

**Surfaces to hide tonight — one, and only if it is not being closed:**

- [ ] `WalletScreen`'s **Withdraw** and **Declare a remittance**, and tip
      declaration with them — *unless* §3.1's console ships. (**S**)

**Closes recommended tonight, cheapest first:**

- [ ] §3.6 · Three `me/photo` paths in `openapi.yaml` — **CI blocker, A0** (XS)
- [ ] §3.4 · Safety guidance + emergency number in System Settings (XS)
- [ ] §3.3 · Mail a rejected applicant (S)
- [ ] §3.1 + §3.2 · Settlement console and the office's ledger view (M + M)

**Ship half-open knowingly, gaps recorded above:** driver documents (§3.5),
profile photo (§3.6), referrals, peak hours, duty sessions (§3.7).

**Needs an owner decision before anyone builds it** — §3.8, raised by the owner
during this census:

- [ ] Which profile fields may a driver edit? Recommended: **`phone` (and
      `name`) only**; licence, status and vehicle stay office-managed, shown on
      the screen with the reason. (M)
- [ ] Does "delete my account" mean **close-and-anonymize via an office-confirmed
      request** — the only version compatible with reproducible invoices — and is
      it week-one work with an ADR? Recommended: **yes to both.** (L)
- [ ] "Change password" already works; move or cross-link it from Settings onto
      Profile. B1's information-architecture phase. (XS)

**Not built, correctly:** driver issue reporting (§3.9).
