# Data inventory and retention policy

**Owner:** W1-e · **Status:** written 2026-08-18 · **Legal basis:** Uganda **Data
Protection and Privacy Act, 2019**, as required by `AGENTS.md` Compliance and
`docs/master-plan.md` §5.

Every row below was read off the schema, a migration, or the code that performs
the transfer. Where a row says a thing is **not** collected, that is a verified
absence, not an assumption — the file and line are named so the next person can
re-check rather than re-derive.

---

## 1 · Why this document exists

`master-plan.md` §1 decision 1 records that the owner was shown that including
public walk-in customers puts data-protection work on the critical path, and
chose it deliberately. From that moment members of the public — not employees,
not contracted corporate clients — hand this platform their name, phone number,
email, and the two addresses that describe where they live and where they go.

The Act's obligation is to **inform the data subject at the point of
collection**. §5 of the master plan states the gate in one sentence: *a customer
can read what happens to their data before they hand it over.*

---

## 2 · The inventory

### 2.1 Collected from members of the public

| Data | Where it lands | Why | Retention |
|---|---|---|---|
| Name | `customers.name`, `order_requests.contact_name` | The dispatcher and the driver must know who to meet | 7 years (financial record) |
| Phone | `customers.phone`, `order_requests.contact_phone` | The driver rings the customer; the dispatcher rings back on a failed pickup | 7 years |
| Email | `customers.email` (unique), `order_requests.contact_email` (nullable) | Account identity and the order receipt | 7 years |
| Password | `customers.password` (nullable) | Account access. **Hashed, never recoverable** | Life of account |
| Google account id | `customers.google_id` (nullable, unique) | Sign-in without a password | Life of account |
| Pickup address | `order_requests.pickup_location` | The trip cannot happen without it | 7 years |
| Drop-off address | `order_requests.dropoff_location` | As above | 7 years |
| Pickup/drop-off coordinates | `order_requests.pickup_latitude/longitude`, `dropoff_latitude/longitude` (`DECIMAL(10,7)`) | Proximity dispatch (ADR-0020 §2) | 7 years |
| Free-text note | `order_requests.notes` | Whatever the customer chose to add. **Uncontrolled: a customer may type anything here**, including data nobody asked for | 7 years |
| A third party's name and phone | `order_requests.details` JSON — `recipient_name`, `recipient_phone`, `sender_name`, `sender_phone` | A delivery, or a ride booked for somebody else, needs both ends reachable | 7 years |

**`order_requests.details` is the row to be careful with.** It is a JSON column
carrying other people's phone numbers — people who never visited this site and
cannot have been informed by a notice on it. `docs/screen-rules.md` §2 already
names it: *"a resource emitting that column wholesale leaks two numbers and
looks harmless in review, because the field is called `details`."*

### 2.2 Collected during the trip

| Data | Where it lands | Why | Retention |
|---|---|---|---|
| Driver GPS trace | `trip_locations` — `latitude`, `longitude`, `speed_kph`, `heading_degrees`, `accuracy_metres`, `recorded_at` | Live map, distance measurement, and the odometer reconciliation `PRODUCT.md` sells as audit-grade | **12 months** |
| Trip record | `trips`, `trip_events` | The append-only timeline an auditor reads | 7 years |

`trip_locations` is **partitioned by month** (`RANGE (TO_DAYS(recorded_at))`,
raw DDL in `2026_08_01_180000_create_trip_locations_table.php`). That is what
makes 12-month retention enforceable as a `DROP PARTITION` rather than a
`DELETE` competing with live traffic for row locks — a deliberate ADR-0003
choice, and the only piece of retention infrastructure that already exists.

The trace is the driver's location, not the customer's. It is in this inventory
because for the duration of a trip it is also **a record of where a named
customer travelled**, joinable through `trips`.

### 2.3 Staff and drivers

| Data | Where it lands | Why | Retention |
|---|---|---|---|
| Name, email, phone | `users`, `drivers` | Employment and platform access | Anonymised **90 days** after deactivation |
| Identity and licence documents | `driver_documents`, private disk, **encrypted at rest (ADR-0053)** | ADR-0033 compliance review | Anonymised 90 days after deactivation |
| **Photograph of a driver's face** (`identity_selfie`) | `driver_documents`, private disk, **encrypted at rest (ADR-0053)** | ADR-0048 §2 — for a **human** to set beside the identity document and decide whether they are the same person. **No face matching, no liveness check, no third-party identity service**; ADR-0033 §4's "nothing is auto-verified, ever" is untouched, and a selfie makes automation easier to reach for, which is why the ADR restates it. | Anonymised 90 days after deactivation |
| **Photograph of a driver's vehicle** (`vehicle_photo`) | `driver_documents`, private disk, **encrypted at rest (ADR-0053)** | ADR-0048 §1 — the vehicle as it looks on the road, for the same compliance review. Includes a readable number plate by design. | Anonymised 90 days after deactivation |
| Documents uploaded **with an application**, before anybody is approved | `driver_documents` (`driver_application_id` set, `driver_id` null) | ADR-0048 §§3–5. Streamed behind the same guard as a driver's; **never readable by the applicant's own claim ticket**, which gets metadata only. | Carried onto the driver at approval; **destroyed at rejection**; swept at **90 days** if the application is never decided (`drivers:prune-abandoned-application-documents`) |
| MFA secret | `users.mfa_secret` | Encrypted at rest | Life of account |

---

## 3 · What is deliberately NOT collected

Stated because a privacy notice that over-claims is as wrong as one that
under-claims, and because each of these is a decision somebody could undo by
accident.

1. **Rental identity documents never leave the customer's device.**
   `KycVerification` collects them in browser state; `OrderPage.tsx:567` sends
   only `Object.keys(kycFiles)` — the *names* of the document types — as
   `details.kyc_documents`. No national ID, passport or licence image belonging
   to a member of the public is uploaded, stored, or transmitted. **Verified by
   reading the payload builder, not by trusting the comment beside it.**
2. **No passenger contact detail reaches a driver before they accept.**
   ADR-0024 §7, and offer payloads become push notifications that land on a lock
   screen.
3. **No analytics, advertising, or tracking script.** Searched the public funnel
   for `gtag`, `analytics`, and third-party pixels: none present.
4. **No non-essential cookie.** The funnel sets no cookie of its own. It uses
   `localStorage` — see §4.

---

## 4 · Stored on the customer's own device

Not transmitted, but personal data all the same, and a notice that ignores it is
incomplete.

| Key | Contents | Set by |
|---|---|---|
| `kr.recent-destinations` | Recently entered addresses | `places.ts:198` |
| `kr.favourite-captains` | Drivers the customer marked as favourite | `favouriteCaptains.ts:20` |

Clearing the browser's site data removes both. Neither is readable by this
platform's servers.

---

## 5 · Third parties that receive personal data

**This is the section most likely to be missing from a privacy notice written
from memory, and the one a regulator asks about first.** Each was verified by
reading the request that makes the transfer.

| Recipient | What reaches them | When | Evidence |
|---|---|---|---|
| **Google** (Maps JavaScript API) | The map viewport, which is centred on the customer's pickup | Whenever the map renders | `googleMaps.ts:50` loads `maps.googleapis.com` |
| **Google** (Identity Services) | Email and profile name | Only if the customer chooses Google sign-in | `OrderPage.tsx:1454` loads `accounts.google.com/gsi/client` |
| **Mapbox** | The **address text typed into the search box** | Only when `VITE_MAPBOX_TOKEN` is configured | `places.ts` → `api.mapbox.com/geocoding/v5` |
| **komoot (Photon)** | The address text typed into the search box | The keyless fallback when Mapbox is not configured — **so this is the live path unless a token is set** | `places.ts` → `photon.komoot.io/api` |
| **komoot (Photon)**, via this platform's own server | The drop-off text a **driver** types into the add-a-drop-off search — the query alone; no driver identity, trip id or position accompanies it | Owner decision of 2026-08-22 (ADR-0045 §10 follow-up). Server-side: the handset never contacts komoot and no key ships in the app | `PlaceSuggestionService` → `photon.komoot.io/api`, cached 60 s |
| **CARTO** | Basemap tile requests | Map fallback path | `MapPanel.tsx:44` → `basemaps.cartocdn.com` |
| **Sentry** (Functional Software, Inc.) | **Whatever was in the failing request** — passenger name and phone, pickup and drop-off, the signed-in user's id and email, the URL, and the stack trace | Only when an error or a sampled transaction occurs, from the API, the web app and the driver app | ADR-0054; `SENTRY_SEND_DEFAULT_PII=true` in `backend/.env.production.example`; `config/sentry.php` |

**The geocoder is the transfer that matters.** A customer typing their home
address into the pickup box sends that text to a third party **as they type**,
before they have submitted anything. Under §2 this platform is the data
controller and these are processors; a cross-border transfer disclosure is
required, and no data-processing agreement with any of them is on file.

**Sentry is the one that was chosen deliberately, so it is recorded
deliberately.** The owner was shown two options — scrubbed reports carrying no
personal data, or full request data — and chose full request data (ADR-0054
§2). The consequence is that a crash while somebody is ordering a car sends
that person's name, number and journey to a third party, and a bank client's
trip data reaches it the same way.

Three things narrow it, and none of them is the same as not sending it:

- **The EU region** (`ingest.de.sentry.io`), chosen at organisation creation
  and unchangeable afterwards. Frankfurt rather than the United States.
- **Credentials never go**, whatever the personal-data setting says.
  Passwords, tokens, TOTP secrets, cookies and idempotency keys are redacted
  before the event leaves the server — `App\Support\Observability\ScrubsSecrets`,
  with tests that fail if the list is narrowed.
- **No session replay and no screenshots**, on any of the three apps. Those
  record the screen rather than the request, and nobody was asked about them.

**Still owed, and this is the gap:** a data-processing agreement with Sentry,
and a 90-day retention setting on the Sentry project itself — Sentry's default
is 90 days for errors, which happens to match §6's floor, but it is a setting
in somebody else's console rather than something this repository enforces. §8
carries both.

---

## 6 · The retention policy, written

Required by `AGENTS.md` Compliance and reproduced here as the authoritative
statement.

| Category | Period | Clock starts |
|---|---|---|
| Trip and order PII (financial records) | **7 years** | Trip completion / order close |
| Raw GPS (`trip_locations`) | **12 months** | `recorded_at` |
| Ex-employee and closed driver accounts | **Anonymised 90 days after deactivation** | `users.deactivated_at`, `driver_closure_requests.closed_at` |
| Generated report exports | Per `PruneReportExports` | File creation |

### 6.1 Enforcement — two of four, after W1-b

**Corrected 2026-08-18 by W1-b. This section first said there was "no GPS prune
at 12 months", and that was wrong in a way worth preserving rather than
overwriting:** the prune had been **written and never scheduled**.
`MaintainTripLocationPartitions` — `dropExpired()`, `DROP PARTITION`, written
against ADR-0003 — was registered in `bootstrap/app.php` and absent from
`routes/console.php`, so a census that reads the schedule (as this one did)
correctly reports the retention as not happening and incorrectly concludes the
job does not exist. **The distinction changes the fix from "build a retention
job" to "add one `Schedule::command` line", which W1-b did.**

**Where each row now stands:**

| Row | Enforced by | Status |
|---|---|---|
| Report exports | `PruneReportExports`, daily 02:30 | **enforced** |
| Raw GPS, 12 months | `trip-locations:maintain`, monthly on the 1st at 03:45 | **enforced from W1-b** |
| Ex-employee / closed accounts, 90 days | nothing | **not enforced** |
| Trip and order PII, 7 years | nothing — but this is a *keep* period, not a delete | n/a until the 7 years elapse |

**The same command was also the only thing keeping ingestion partitioned**, and
neither half failed loudly. `trip_locations` is RANGE-partitioned by month with a
`p_future` MAXVALUE catch-all, and this database carries months only to
**November 2026** (verified against `INFORMATION_SCHEMA.PARTITIONS`). Unscheduled,
every ping from December onwards would have landed in the catch-all: no error, no
alert, and the monthly carving ADR-0003 calls this platform's growth mitigation
quietly doing nothing — while the 12-month retention **this document promises the
public** never ran.

**Still not enforced, and this is the one with legal exposure:** the 90-day
anonymisation. `app/Enums/UserStatus.php:22` says *"anonymisation job is not
built"*, and `DriverClosureService.php:83` calls `closed_at` *"the clock the
retention sweep runs"* off — **the sweep does not exist**, so ADR-0043's closure
loop stops at "marked closed". A stated 90 days that does not happen is worse
than no stated period. **Not built by W1-e or W1-b**; it needs a command, and it
is named here so it is not rediscovered as a surprise.

`PruneReportExports.php:14` still states the principle better than this section
can: *"a retention policy nothing enforces is a document"*.

---

## 7 · Personal Data Protection Office registration

The brief asks for the requirement to be checked and reported. Reported, with
its confidence marked, because getting this wrong in either direction is
expensive.

**What the framework is.** The Data Protection and Privacy Act, 2019 is
administered by the **Personal Data Protection Office (PDPO)**, established
under NITA-U. The Data Protection and Privacy Regulations, 2021 provide for a
**register of data collectors, data controllers and data processors**, and for
registration with the PDPO. A commercial platform processing the personal data
of members of the public — name, phone, email and location — is squarely the
kind of entity the register is for, and location data raises the sensitivity.

**What this platform would have to be able to say:** who the data controller is,
what categories it processes, the purposes, the retention periods (§6), the
third parties it discloses to (§5), and its security measures.

**What I could not verify, and the owner must:** the current fee, the exact
threshold and any exemption, the filing mechanism, and whether registration must
precede go-live or follow it within a period. **I did not reach the PDPO's own
guidance from this environment, so nothing above should be treated as the
current filing requirement.** This needs a lawyer or a direct enquiry to the
PDPO; it is not an engineering task and it is not closed by this package.

**It is also not a blocker on the notice.** Registration is an obligation on the
operator. Informing the customer is an obligation at the moment of collection,
and that one is code — which is what W1-e builds.

---

## 8 · Owed, and not built here

- **A documented breach-response procedure.** `AGENTS.md` Compliance requires
  one. It does not exist. Not written by this package because it is an
  operational runbook and `W1-d` owns `docs/runbook.md` — named here so it lands
  somewhere rather than nowhere.
- **The four retention jobs** in §6.1.
- **Data-processing agreements** with the processors in §5. **Sentry is now
  the sharpest of these**, because it is the only one that was switched on by
  a deliberate decision after this document existed, and the only one
  receiving a bank client's data rather than a member of the public's typing.
- **A retention setting on the Sentry project.** Sentry's default is 90 days
  for errors, which is inside §6's floor — but it is a setting in a third
  party's console, not a job in this repository, so it is not enforced by
  anything here and nothing will notice if it changes.
- **A subject-access and erasure route.** ADR-0043 built closure for *drivers*.
  A member of the public has no way to ask what is held about them, or to have
  it removed. The Act provides those rights.
