# The corporate client panel — plan

> **Amended in one respect by `docs/platform-plan.md`:** a corporate client is now onboarded by a **fleet company**, not by Kangaru, and may be served by more than one (package `K6`, ADR-0060). Everything else in this plan stands.

**For:** Centenary Bank, the anchor client, and every corporate client after
them.
**Against:** Centenary Rural Development Bank Ltd, ref **CRDB/CS/F/26**,
22 July 2026, *"Automation of motor vehicles used for car-hire"*, signed by
the Chief Manager Corporate Services after the meeting of 13 July 2026.
**Owner's framing (2026-08-19):** *"Centenary Bank is simply another client,
not a tenant. They don't have fleet-related menus. They are clients served by
Shanitah General Enterprises Ltd. We give them only what they deserve; they
manage their own staff. This was the problem they requested us to solve."*

Everything in this plan is judged against one question: **can the Bank's
transport officer, on their own screen, prove every trip we billed them
for?** That is what the letter asks for and it is what `PRODUCT.md` calls
audit-grade correctness.

---

## 1 · What the Bank asked for, verbatim

> To improve efficiency, accountability, and service delivery, we request
> that all vehicles supplied to the Bank operate an automated system capable
> of capturing and reporting, to a minimum, the following information for
> each trip:
>
> 1. Date and time of trip commencement and completion.
> 2. Vehicle registration details.
> 3. Details of trip origin and destination.
> 4. Opening and closing odometer (mileage) readings.
> 5. Total distance travelled.
> 6. Trip duration in terms of hours / minutes.
>
> This system will help streamline vehicle tracking, booking, mileage
> monitoring and reporting, create transparency, ease administrative
> workload while ensuring better management of the fleet and improved
> service to the Bank.
>
> The Bank will review the proposed solutions and will give you a platform
> to carry out demonstration sessions where necessary to assess their
> suitability before implementation.

Two things to read out of that:

- **Six data points per trip, "to a minimum".** Every one must be captured
  by the driver's handset, stored immutably, and readable by the Bank
  without asking us.
- **Five outcomes** — vehicle tracking, booking, mileage monitoring,
  reporting, transparency — and **one event**: a demonstration session
  before implementation. The panel is what we demonstrate.

---

## 2 · Where each requirement stands today

Verified on 2026-08-19 by signing in as the seeded Centenary admin
(`admin@centenarybank.test`) and reading the screens and the API. "Panel"
means the corporate client's web console.

| # | The letter asks for | Captured by | Stored as | The Bank sees it at | Status |
|---|---|---|---|---|---|
| 1 | Commencement and completion date-time | Driver app transitions (`trip_started`, `trip_completed`), server clock | `trips.started_at / completed_at` + append-only `trip_events` | Trips page (row + timeline), Dashboard "Recent trips", Trip report, exports | **Done** |
| 2 | Vehicle registration | Dispatch assignment | `trips.vehicle_id` → `vehicles.registration_number` | Every trip row and report row; Organisation → "Vehicles supplied to you" | **Done** |
| 3 | Origin and destination | Booking form; walk-in order | `trips.origin / destination` (+ pickup/dropoff coordinates) | Every trip row and report row | **Done** |
| 4 | Opening / closing odometer | Driver types the reading **and photographs the dashboard** at start and end (`OdometerScreen`, ADR-0016) | `trips.odometer_start / odometer_end` + photo files (`trips/{trip}/odometer-photo/{moment}`) | Readings: every trip row and report row. **Photos: not shown anywhere in the panel** — the endpoint exists, the screen does not | **Readings done · photos gap** |
| 5 | Total distance | `odometer_end − odometer_start`, reconciled against GPS distance | `trips.distance_km`, `gps_distance_km`, `distance_variance_flagged` | Trip rows, report rows, Dashboard "Distance this month", Vehicle report | **Done**; the GPS-vs-odometer variance flag is not surfaced to the client |
| 6 | Duration hours/minutes | Derived from 1 | `trips.duration_minutes` | Every trip row and report row ("5h 32m") | **Done** |

And the five outcomes:

| Outcome | Today | Gap |
|---|---|---|
| **Vehicle tracking** | Live map — the Bank's trips only, GPS positions every 10 s | A finished trip's GPS route (`/trips/{id}/route`) is served but not drawn for the client |
| **Booking** | Employees request; Corporate Admin approves/rejects; dispatch assigns; requester is notified on approve/reject | No notification on assignment, driver arrival or completion; no recurring bookings; no branch / cost-centre on a booking |
| **Mileage monitoring** | Vehicle report per registration (trips, km, hours, average) for the Bank's own trips; "Records complete %" tells them when a driver skipped a reading | No per-vehicle monthly statement; variance flag hidden |
| **Reporting** | Trip / Vehicle / Financial reports, CSV / Excel / PDF exports, generated in the background, notified when ready | The **Driver report** is also offered to the client and its rows carry driver **licence numbers** — Shanitah's HR data (security-gate F2 shape) |
| **Transparency** | Dashboard: trips, km, invoiced, outstanding this month; Invoices with credit notes and per-line fare breakdown; Organisation page | No downloadable invoice document; no monthly statement per branch |

**Done this session (the skeleton):** the panel's menu (Dashboard · Bookings
· Trips · Live map · Organisation · Invoices · Reports · Staff ·
Notifications), the client dashboard, the Organisation page with "Vehicles
supplied to you", the fleet register closed to corporate roles, the client's
own name in the chrome. See `docs/agent-worklog.md`, 2026-08-19.

---

## 3 · The plan, in phases

Ordered by what the demonstration session needs first. Each item names its
acceptance test in the Bank's own words.

### Phase A — Close the six-point record (before the demo)

The letter's minimum, made unarguable. **All four delivered 2026-08-19**
(`docs/agent-worklog.md`): `/trips/:id` is the record page; the "Record"
column and verdict; the driver report gated on `drivers.view`; the
completeness stat on the dashboard.

| # | Work | Acceptance | Size |
|---|---|---|---|
| A1 ✅ | **Trip detail for the client** — a full-page record per trip: the six data points as a fact sheet, the timeline, **both odometer photos**, the GPS route on a map, and the invoice it produced. Route: `/trips/{id}`. | "Show me trip #29." One page answers all six, with the dashboard photo behind each reading. | M |
| A2 ✅ | **Surface the odometer-vs-GPS check** — on the trip record and as a column ("Verified" / "Check") on the Trips page and Trip report, from `distance_variance_flagged`. | The Bank sees which readings we ourselves flagged, before they ask. Transparency is the point. | S |
| A3 ✅ | **Driver report off the client's Reports page**, and licence numbers out of any report a client can reach. | A client's report picker offers Trip · Vehicle · Financial. | S |
| A4 ✅ | **Records-completeness on the dashboard** — "Records complete: 98 % (2 trips missing a closing reading)" with a link to those trips. | The transport officer chases a missing reading the day it happens, not at month end. | S |

### Phase B — Booking, end to end, for a bank's staff

| # | Work | Acceptance | Size |
|---|---|---|---|
| B1 ✅ | **Notify the requester** at every step after approval: driver assigned (registration + driver first name), driver arrived, trip completed (with the six data points). New `NotificationType` cases; in-app first, email when SMTP is configured. | An employee who booked a car is never left refreshing. | M |
| B2 | **Branch / department on a booking** — a free-text-with-suggestions "Cost centre" field, stored on the booking, carried to the trip and the invoice line, filterable in reports. (Modules/Clients README's deferred "departments, branches, cost centres", started small.) | The Bank's finance can split a month's spend by branch. | M |
| B3 | **Scheduled and recurring bookings** — `scheduled_for` exists; add "repeat weekly until". | The Nakawa branch's Monday cash run is booked once. | M |
| B4 | ~~Approval routing~~ — folded into E2 (per-user capabilities). | — | — |

### Phase C — Money the Bank can file

| # | Work | Acceptance | Size |
|---|---|---|---|
| C1 | **Invoice document (PDF)** — one per invoice, from stored data (rate-card version, calculation inputs, credit notes), downloadable from the Invoices page. Same background-export machinery as reports. | Finance files a PDF against the trip; the numbers match the screen to the shilling. | M |
| C2 | **Monthly statement** — per client, per month: every trip with its six points and its invoice, subtotals by cost centre (B2), credits, total. PDF + Excel. | One document replaces the month-end reconciliation the Bank does today by hand. | M |
| C3 | **Query an invoice line** — a client raises a query on a line ("this trip did not happen"); Shanitah answers with a credit note or a note; both sides see the thread. Audited. | Disputes leave a trail; nothing is edited. | M |

### Phase E — Staff, access control and the client's own settings

**E2 delivered 2026-08-19** as `App\Enums\ClientCapability` — three
switches (`approves_bookings`, `sees_finance`, `manages_staff`) plus
`books_without_approval`, set per person on the Staff page, unioned onto the
role server-side, escalation-checked, audited, and read by the menu.

The owner (2026-08-19): *"their dashboard with the important information,
settings etc.; user or staff management and access control."* Today a
Corporate Admin can add, edit, suspend and re-role their own people on
**Staff** (two roles: Corporate Admin, Corporate Employee); there is no
client-side settings page and no finer access control than those two roles.

| # | Work | Acceptance | Size |
|---|---|---|---|
| E1 | **Staff, finished for a client** — invite by email (today the admin types the first password), resend invite, deactivate with reason, last sign-in, and a "what this person can do" summary per row. Only their own people, only their two roles (already enforced by `UserPolicy` and `meta.assignable_roles`). | The Bank's transport officer onboards a new branch officer in one minute without calling Shanitah. | M |
| E2 ✅ | **Access control inside the client** — per-user capabilities a Corporate Admin can switch on: *approves bookings*, *books without approval*, *sees invoices and reports*, *manages staff*. Stored on the user, enforced by policy, audited. This is the honest step short of client-defined roles: the role catalogue is platform-wide (ADR-0004), so a client cannot own a role, but they can own a person's switches. Retire B4 into this. | A branch manager approves for their branch; a finance officer sees invoices and nothing else; a driver's-pool clerk books without waiting. | M |
| E3 | **Organisation settings** — a settings page for the client, backed by a per-client settings group: approval policy (every booking / none / per user via E2), booking horizon, **cost centres list** (feeds B2), notification recipients (statement, invoices, booking events), whether the driver's name appears on records (Bank question 3), default pickup addresses (Head Office, branches). Every change audited. | The Bank configures how they use us; nobody at Shanitah edits a client's preferences by hand. | L |
| E4 | **Dashboard, second pass** — beside the month's figures: today's pickups (scheduled bookings), trips in progress with vehicle and stage, records-completeness (A4), and a "needs you" strip: approvals waiting, invoices issued this week, a reading missing. Everything a transport officer checks before their first meeting. | The dashboard is the morning page. | M |

### Phase D — The demonstration session

| # | Work | Size |
|---|---|---|
| D1 | **Seed a demo Centenary**: three months of realistic Kampala / branch runs (`DemoHistorySeeder` already does this), one trip flagged on variance, one missing a reading, one credit note, four allocated vehicles, two admins and six employees. | S |
| D2 | **Demo script** (30 min): sign in as the Bank → dashboard → book a trip as an employee → approve as admin → watch it on the live map (a real handset, on the projector) → driver captures odometer + photo → trip completes → open the trip record (A1) → find it on the Trip report → export PDF → open its invoice → the monthly statement (C2). | S |
| D3 | **A one-page leave-behind**: the six data points and where each lives, in the Bank's language. | S |

**Order:** A1 → A3 → A2 → A4 → E1 → E2 → D1 → D2 → B1 → C1 → E3 → E4 →
B2 → C2 → B3 → C3. A is the demo's spine; E1/E2 are what the Bank's officer
touches first after sign-in; D can be rehearsed as soon as A and E1 land; B1
and C1 are the two the Bank will ask for in the room; E3 waits for B2's cost
centres and the Bank's answers in §5.

---

## 4 · Rules this panel is built under

- **Never a number the platform did not produce.** A missing reading is an
  em dash and a "Check" badge, not a zero (`docs/screen-rules.md` §1).
- **Never the fleet.** No driver phone, licence, payout, document or
  application reaches a corporate role — by permission (`RoleSeeder`
  `$clientReads`) and by menu. The driver on the Bank's trip is named on
  that trip, and that is all.
- **Never "tenant" on a screen.** The client sees their own name.
- **The client's figures come from the same endpoints their reports use**
  (`/reports/trips`, `/reports/financial` summaries), so the dashboard can
  never disagree with the report the Bank prints.
- **Every new endpoint ships with policy, contract entry, README and tests
  — and the client-scope isolation test** (`CompanyCrossTenantIsolationTest`
  is the pattern). A leak between clients is the one bug that ends this.

---

## 5 · Questions for the Bank (take to the first meeting)

1. Who books — employees themselves, or the transport office on their
   behalf? (Decides B4 and how many accounts we create.)
2. What is the Bank's branch / cost-centre list, and does finance want the
   invoice split by it? (Decides B2's shape.)
3. Do they want the driver named on the record, or only the vehicle? (We
   show first name today; some clients want none.)
4. Which email addresses receive the monthly statement and the invoices?
   (C1/C2 delivery; SMTP is configured but disabled until the owner
   enables it.)
5. Is a photograph of the odometer acceptable evidence to their auditors, or
   do they need the reading counter-signed by the passenger? (A1 shows the
   photo; a passenger sign-off would be a new capture step.)

---

## 6 · Out of scope for this plan

- Anything on Shanitah's side of the console (dispatch, fleet, drivers).
- The driver app, beyond what it already captures — the six data points
  are captured today.
- Payments recorded on the platform. Outstanding = invoiced − credited, and
  the panel says so.
- Self-service client onboarding — Shanitah creates the client and its
  first admin.
