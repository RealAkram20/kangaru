# Security gate — W1-c

**Package:** W1-c · Security gate (`docs/master-plan.md` §3, brief in
`docs/agent-briefs.md` and `docs/track-a-parallel-plan.md`).
**Written:** 2026-08-18. **Author:** the W1-c agent. **Status of the two exit
criteria:** the local half is **done**; the deployed half is **not done and
cannot be until the owner creates the Coolify project** — §5 says exactly what
that leaves open, and §5 is the part to read if you have two minutes.

This document is the census the brief asked for, the resource review, the
isolation results, and the findings — each finding addressed to the module
that owns it, because W1-c edits no module source. Everything below that says
*proved* was proved by running a test that fails when the property is broken
(§3 names each mutation); everything that says *read* was read in the working
tree and cited to a line.

---

## 0 · What was audited, and against what

- **The surface: 172 API routes, 62 controllers**, taken from `route:list` on
  the working tree of 2026-08-18. **The working tree and `HEAD` (`31c87cb`)
  have identical route tables** — no route file, controller signature or
  middleware differs between them. Four `backend/Modules` files *are* dirty
  in the tree (`OrderRequestServiceType`, `OrderRequestService`,
  `DispatchOfferService`, `CustomerRideController` — the walk-in auto-dispatch
  work); the diff was read and touches no authorization: `CustomerRideController`
  still scopes on `customer_id`, the other three add a service-type guard to
  dispatch. So the census below is true of both states, and the tests in §3
  were run against the working tree.
- **Method.** A grep cannot do this — a first pass produced a false positive
  on `ClosureRequestController`, which is gated by a controller-private
  `refuseWithoutPermission()`. So every controller was read, route by route,
  by seven parallel readers with one fixed brief and a shared schema, and the
  two groups whose readers were cut off (Billing/Bookings/Clients wrote its
  file first; Reports/Trips did not) were finished by hand. Each row in §2
  names the idiom that **refuses** the route and the mechanism, and the
  agents' full evidence (file:line per route) is condensed into it.
- **Not audited, and stated as such:** the frontend and driver app (they enforce
  nothing; the API does), rate limits beyond "is there a throttle", the
  correctness of the audit log's *content* beyond the two things in F4 and F6,
  and anything against a deployed database (§5).

## 1 · The idioms

| Idiom | What carries the route | Count |
|---|---|---|
| **A** | A Policy or Gate — `$this->authorize()`, `Gate::authorize()`, `can()` | 105 |
| **A/C** | `authorize('viewAny')` that returns `true` for everyone, then narrowed by `forActor()` and a permission-conditioned `where` (`bookings.index`, `trips.index`) | 2 |
| **B** | A permission helper — `hasPermission()` behind a controller-private `refuseWithoutPermission()` (only `ClosureRequestController`, three routes) | 3 |
| **C** | Ownership by the token — the query is keyed off `$request->user()` and nothing else: the driver's `/me`, the customer's `/customer`, a user's inbox and devices, the account's own auth calls | 51 |
| **D** | Public by design — unauthenticated, throttled, and echoing nothing it did not have to | 11 |

**Every one of the 172 routes has one.** There is no route filed "none", and no
route filed "tenant scope only, any role" — the two categories the brief said
would be a tonight-blocker. That is pinned by `tests/Feature/Ci/RoutePolicyCensusTest.php`
(§3.1), which fails on a route without a row, a row without a route, a public
route without a throttle, or a guarded route without a guard.

The interesting boundary is not A-vs-B-vs-C. It is **which records a route can
name**, and that splits three ways:

1. **Tenant-owned records** (16 models carry `BelongsToTenant`; 8 of them are
   bound from a URL — `booking`, `company`, `invoice`, `rateCard`, `trip`,
   `allocation`, `notification`, `export`). Cross-tenant answers **404** through
   `BelongsToTenant::resolveRouteBinding` before any policy runs. Proved on all
   32 such routes (§3.2).
2. **Platform-owned records** (`Driver`, `Vehicle`, `Zone`, `Customer`,
   `OrderRequest`, `DispatchOffer`, `AvailabilityBlock`, `User`, `Role`,
   `SupportRequest`, the driver's documents/settlements/closures/payout
   account — ADR-0005). There is no "other tenant" for these; the question is
   which **permission** may read them, and the answer for a real id without it
   is 403 (a missing id is 404). That is by design and documented on each
   policy, but it is an existence oracle on ids — F12 lists them. Two of these,
   `users.show/update`, are the exception where the model *is* logically
   tenant-scoped and the answer is still 403 — F3.
3. **The actor's own records** (idiom C). Refusal is `403 NOT_A_DRIVER` for a
   token with no driver row, and a scoped 404 for another driver's or
   customer's id. Proved on all 35 `/me` routes and the customer routes (§3.3,
   §3.4).

## 2 · The route-by-route census

Columns: the route (name); the idiom; the mechanism that refuses it, with the
policy method or permission or scope named; what the boundary answers
(cross-tenant 404, permission 403, own-only); whether ADR-0022's driver-app
allow-list reaches it. `Fn` in a cell points at a finding in §4.

#### Administration

| Route | Idiom | Refusing mechanism (evidence in the walk) | Boundary answer | Driver token |
|---|---|---|---|---|
| `DELETE api/v1/auth/mfa` (auth.mfa.disable) | C | self; refuses roles that require MFA; needs a current TOTP or recovery code. | own account only | no |
| `DELETE api/v1/roles/{role}` (roles.destroy) | A | `RolePolicy::delete` → `roles.manage` and not system; 409 if any holder. | platform-owned record; permission decides (403), 404 if missing | no |
| `GET api/v1/audit-logs`  | A | `AuditLogPolicy::viewAny` → `audit.view`; rows via `AuditLog::forActor()` (tenant rows for a client, all for platform). Unnamed route → driver token refused (null name fails closed). | listing scoped by actor | no |
| `GET api/v1/auth/me` (auth.me) | C | `UserResource` of the token holder; `mfa_secret`/codes `$hidden`. | own account only | yes |
| `GET api/v1/public/legal` (public.legal) | D | throttle 30/min; `legal` group only. | public | no |
| `GET api/v1/public/settings` (public.settings) | D | throttle 30/min; `public`-flagged keys only; every `secret` key is masked to `{configured}` before this reads it — verified key by key, no secret is also public. | public | no |
| `GET api/v1/roles` (roles.index) | A | `RolePolicy::viewAny` → `roles.manage` or `staff.view`. `users_count` is platform-wide (minor). | listing scoped by actor | no |
| `GET api/v1/settings` (settings.index) | A | `SettingPolicy::viewAny` → `settings.manage` (Super Admin only as seeded); secrets masked. | listing scoped by actor | no |
| `GET api/v1/users` (users.index) | A | `UserPolicy::viewAny` → `staff.view`; `User::forActor()` adds `where tenant_id` for a client actor (User is not BelongsToTenant by design). | listing scoped by actor | no |
| `GET api/v1/users/{user}` (users.show) | A | `UserPolicy::view` → `staff.view` && same tenant. **Another tenant's user id → 403, not 404** (F3). | platform-owned record; permission decides (403), 404 if missing | no |
| `PATCH api/v1/auth/password` (auth.password.change) | C | self; current password re-checked; all tokens revoked. | own account only | yes |
| `PATCH api/v1/roles/{role}` (roles.update) | A | `RolePolicy::update` → `roles.manage`; system roles not renamable; cannot strip own `roles.manage`. | platform-owned record; permission decides (403), 404 if missing | no |
| `PATCH api/v1/settings/{group}` (settings.update) | A | `SettingPolicy::update`; unknown group 404; secrets encrypted at rest and `***` in audit. | listing scoped by actor | no |
| `PATCH api/v1/users/{user}` (users.update) | A | `UserPolicy::update` → `staff.manage` && same tenant; role escalation closed. Same 403-not-404 (F3); validation-before-policy oracle (F7). | platform-owned record; permission decides (403), 404 if missing | no |
| `POST api/v1/auth/login` (auth.login) | D | throttle 5/min/IP; unknown email, wrong password and suspended all answer the same message; `client` self-declared (ADR-0022 §1). | public | no |
| `POST api/v1/auth/logout` (auth.logout) | C | deletes `currentAccessToken()` only. | own account only | yes |
| `POST api/v1/auth/mfa/enrol` (auth.mfa.enrol) | C | self; **no re-authentication** (F6). | own account only | no |
| `POST api/v1/auth/mfa/enrol/confirm` (auth.mfa.enrol.confirm) | C | self; code must match the unconfirmed secret; throttle 10/min. | own account only | no |
| `POST api/v1/auth/mfa/recovery-codes` (auth.mfa.recovery-codes) | C | self; **no code/password proof, not audited** (F6). | own account only | no |
| `POST api/v1/auth/mfa/verify` (auth.mfa.verify) | D | throttle 10/min; single-use challenge; `client` re-declared here (ADR-0022 §6). | public | no |
| `POST api/v1/auth/password/forgot` (auth.password.forgot) | D | throttle 3/min; identical 202 whether or not the email exists. | public | no |
| `POST api/v1/auth/password/reset` (auth.password.reset) | D | throttle 5/min; wrong code and unknown email → same 422; 5 attempts burn the row. | public | no |
| `POST api/v1/auth/social` (auth.social) | D | throttle 5/min; provider token verified server-side; mints a driver-scoped token only. | public | no |
| `POST api/v1/roles` (roles.store) | A | `RolePolicy::create` → `roles.manage`; permissions ⊆ actor's (escalation rule). | listing scoped by actor | no |
| `POST api/v1/settings/assets/{asset}` (settings.assets.upload) | A | `SettingPolicy::update`; asset ∈ {logo, favicon}; SVG accepted (F19). | listing scoped by actor | no |
| `POST api/v1/settings/mail/test` (settings.mail.test) | A | `SettingPolicy::update`; throttle 5/min. | listing scoped by actor | no |
| `POST api/v1/users` (users.store) | A | `UserPolicy::create` → `staff.manage`; role ⊆ actor's; tenant forced to actor's for a client. Validation runs before the policy → email/tenant oracle (F7). | listing scoped by actor | no |

#### Clients

| Route | Idiom | Refusing mechanism (evidence in the walk) | Boundary answer | Driver token |
|---|---|---|---|---|
| `DELETE api/v1/companies/{company}` (companies.destroy) | A | `CompanyPolicy::delete` → `companies.delete` (Super Admin). | 404 cross-tenant (tenant-bound binding, proved) | no |
| `GET api/v1/companies` (companies.index) | A | `CompanyPolicy::viewAny` → `companies.view` (every role); `Company::forActor()` — a client sees its own company row. | listing scoped by actor | no |
| `GET api/v1/companies/{company}` (companies.show) | A | `CompanyPolicy::view` → `companies.view`. | 404 cross-tenant (tenant-bound binding, proved) | no |
| `PATCH api/v1/companies/{company}` (companies.update) | A | `CompanyPolicy::update` → `companies.update` (Corporate Admin) — **may set own `credit_limit_minor` and `status`** (F9). | 404 cross-tenant (tenant-bound binding, proved) | no |
| `POST api/v1/companies` (companies.store) | A | `CompanyPolicy::create` → `companies.create` (Super Admin); `tenant_id` from body, `exists:tenants` validated before the policy (F8). | listing scoped by actor | no |

#### Customers

| Route | Idiom | Refusing mechanism (evidence in the walk) | Boundary answer | Driver token |
|---|---|---|---|---|
| `DELETE api/v1/customers/{customer}/suspension` (customers.suspension.destroy) | A | `CustomerPolicy::suspend` → `customers.manage`. | platform-owned record; permission decides (403), 404 if missing | no |
| `GET api/v1/customer/auth/me` (customer.auth.me) | C | own `CustomerResource`. | own customer only | no |
| `GET api/v1/customer/order-requests` (customer.order-requests.index) | C | `where customer_id = token`; paginated. `CustomerOrderRequestResource` emits `details` whole — the customer's own form (F1). | own customer only | no |
| `GET api/v1/customer/order-requests/{orderRequest}` (customer.order-requests.show) | C | `int` param, `where customer_id`->`find` → another customer's id is 404 (proved). | own customer only | no |
| `GET api/v1/customer/rides/active` (customer.rides.active) | C | no id; `activeRideFor(customer)` + `Trip::forCustomer()`; captain phone only in live statuses (ADR-0024 §7). | own customer only | no |
| `GET api/v1/customers` (customers.index) | A | `CustomerPolicy::viewAny` → `customers.view` (Dispatcher, Ops, Super Admin); Customer is platform-owned by design. | listing scoped by actor | no |
| `GET api/v1/customers/{customer}` (customers.show) | A | `CustomerPolicy::view` → `customers.view`; platform-owned binding → 403 for an existing id without the permission, 404 for a missing one (F12 class). | platform-owned record; permission decides (403), 404 if missing | no |
| `GET api/v1/customers/{customer}/activity` (customers.activity.index) | A | `CustomerPolicy::view`; **uses the staff `OrderRequestResource`** → `dispatcher_notes` and whole `details` to `customers.view` holders (F11). | platform-owned record; permission decides (403), 404 if missing | no |
| `POST api/v1/customer/auth/login` (customer.auth.login) | D | throttle 5/min; generic message for unknown/wrong/suspended. | public | no |
| `POST api/v1/customer/auth/logout` (customer.auth.logout) | C | own token. | own customer only | no |
| `POST api/v1/customer/auth/register` (customer.auth.register) | D | throttle 5/min; `email.unique` message is an exists-oracle (standard trade-off). | public | no |
| `POST api/v1/customer/rides/active/cancellation` (customer.rides.cancel) | C | no id; same lookup; writes the reason into `dispatcher_notes` (F20). | own customer only | no |
| `POST api/v1/customers/{customer}/suspension` (customers.suspension.store) | A | `CustomerPolicy::suspend` → `customers.manage` (Super Admin). | platform-owned record; permission decides (403), 404 if missing | no |

#### Vehicles

| Route | Idiom | Refusing mechanism (evidence in the walk) | Boundary answer | Driver token |
|---|---|---|---|---|
| `DELETE api/v1/vehicle-categories/{vehicleCategory}` (vehicle-categories.destroy) | A | `VehicleCategoryPolicy::delete` → `vehicles.manage`. Refuses 409 `VEHICLE_CATEGORY_IN_USE` when a vehicle, rate card price or invoice line names the key — the count is read across every tenant (`allTenants()`), and nothing but the count is returned. ADR-0050. | platform-owned record; permission decides (403) | no |
| `GET api/v1/vehicle-categories` (vehicle-categories.index) | A | `VehicleCategoryPolicy::viewAny` → `vehicles.view` **or `bookings.create`** — the second arm is ADR-0051 §3, so a corporate client's booking form can offer the choices. **Names, not the roster:** `vehicles_count` is omitted for anyone without `vehicles.view`, because the fleet's composition is the register F2 withholds; proved by a test, and by mutation. Coverage figures use `forActor()` on cards, versions and rates, so a client sees only their own tariffs named. ADR-0050, ADR-0051. | listing scoped by actor | no |
| `PATCH api/v1/vehicle-categories/{vehicleCategory}` (vehicle-categories.update) | A | `VehicleCategoryPolicy::update` → `vehicles.manage`. `key` is `prohibited`, so a rename is 422 rather than a silent no-op. | platform-owned record; permission decides (403) | no |
| `POST api/v1/vehicle-categories` (vehicle-categories.store) | A | `VehicleCategoryPolicy::create` → `vehicles.manage`. Sets no price and grants no money power; `ratecards.manage` still gates every rate. | listing scoped by actor | no |
| `DELETE api/v1/vehicles/{vehicle}` (vehicles.destroy) | A | `VehiclePolicy::delete` → `vehicles.manage`. | platform-owned record; permission decides (403), 404 if missing | no |
| `GET api/v1/vehicles` (vehicles.index) | A | `VehiclePolicy::viewAny` → `vehicles.view` (every role); platform fleet, `Vehicle::all()`; emits VIN and plate. | listing scoped by actor | no |
| `GET api/v1/vehicles/{vehicle}` (vehicles.show) | A | `VehiclePolicy::view` → `vehicles.view`. | platform-owned record; permission decides (403), 404 if missing | no |
| `PATCH api/v1/vehicles/{vehicle}` (vehicles.update) | A | `VehiclePolicy::update` → `vehicles.manage`. | platform-owned record; permission decides (403), 404 if missing | no |
| `POST api/v1/vehicles` (vehicles.store) | A | `VehiclePolicy::create` → `vehicles.manage`. | listing scoped by actor | no |

#### Drivers

| Route | Idiom | Refusing mechanism (evidence in the walk) | Boundary answer | Driver token |
|---|---|---|---|---|
| `DELETE api/v1/drivers/{driver}` (drivers.destroy) | A | `DriverPolicy::delete` → `drivers.manage`. | platform-owned record; permission decides (403), 404 if missing | no |
| `DELETE api/v1/drivers/{driver}/account` (drivers.account.destroy) | A | `DriverPolicy::manageAccount`. | platform-owned record; permission decides (403), 404 if missing | no |
| `DELETE api/v1/me/closure-request` (me.closure-request.destroy) | C | same gate; own pending row or 404. | own driver / own user only | yes |
| `DELETE api/v1/me/payout-account` (me.payout-account.destroy) | C | gate; `where driver_id`. | own driver / own user only | yes |
| `DELETE api/v1/me/photo` (me.photo.destroy) | C | gate. | own driver / own user only | yes |
| `GET api/v1/closure-requests` (closure-requests.index) | B | controller-private `refuseWithoutPermission()` → `drivers.manage` (the idiom the grep missed; `DriverAccountClosureTest:285-297` proves it). | listing scoped by actor | no |
| `GET api/v1/driver-applications` (driver-applications.index) | A | `DriverApplicationPolicy::viewAny` → `drivers.view` — **every role**, incl. Corporate Employee: applicant name/phone/email (F2). | listing scoped by actor | no |
| `GET api/v1/driver-applications/{driverApplication}` (driver-applications.show) | A | `DriverApplicationPolicy::view` → `drivers.view` (F2). | platform-owned record; permission decides (403), 404 if missing | no |
| `GET api/v1/drivers` (drivers.index) | A | `DriverPolicy::viewAny` → `drivers.view` — **every role**; unpaginated; `DriverResource` emits phone, email, `license_number`, `license_expiry`, account email (F2). | listing scoped by actor | no |
| `GET api/v1/drivers/{driver}` (drivers.show) | A | `DriverPolicy::view` → `drivers.view` (F2); platform-owned, any id resolves (ADR-0005, tested). | platform-owned record; permission decides (403), 404 if missing | no |
| `POST api/v1/drivers/{driver}/documents` (drivers.documents.store) | A | `DriverDocumentPolicy::create` → `drivers.manage` (ADR-0052 §5). Shares `StoreDriverDocumentRequest` with the driver's own upload, so the 8 MB ceiling and the closed mime list apply identically. **Writes `pending`** — filing is not verifying, and there is no path here that reaches `verify()`. | platform-owned record; permission decides (403) | no |
| `GET api/v1/drivers/{driver}/documents` (drivers.documents.index) | A | `DriverDocumentPolicy::viewAny` → `drivers.manage`; `file_path` `$hidden`. | platform-owned record; permission decides (403), 404 if missing | no |
| `GET api/v1/drivers/{driver}/documents/{document}/file` (drivers.documents.file) | A | `DriverDocumentPolicy::view` (owner or `drivers.manage`) **then** explicit `document.driver_id === driver.id` else 404 — `/drivers/1/documents/999/file` cannot stream driver 2's file. Files **encrypted at rest** since ADR-0053, decrypted on this path only (`DriverDocumentStore::download`) — F23 **closed**. | platform-owned record; permission decides (403), 404 if missing | no |
| `GET api/v1/drivers/{driver}/payout-account` (drivers.payout-account.show) | A | `DriverPolicy::viewPayoutAccount` → `drivers.manage` (route comment says `@view` — stale); **full account number** to Fleet Owner/Branch/Depot Manager; read not audited (F17). | platform-owned record; permission decides (403), 404 if missing | no |
| `GET api/v1/me/closure-request` (me.closure-request.show) | C | `driverFor()`→403 `NOT_A_DRIVER`; `where driver_id`. | own driver / own user only | yes |
| `GET api/v1/me/documents` (me.documents.index) | C | same gate; `DriverDocumentService::forDriver()`. | own driver / own user only | yes |
| `GET api/v1/me/documents/{document}/file` (me.documents.file) | A | `DriverDocumentPolicy::view` — owner **or** `drivers.manage`; another driver's id → **403** (existence oracle, F12); the one `/me` route without the `NOT_A_DRIVER` gate. | platform-owned record; permission decides (403), 404 if missing | yes |
| `GET api/v1/me/earnings` (me.earnings.show) | C | gate; `DB::table(driver_ledger_entries/trips) where driver_id`. | own driver / own user only | yes |
| `GET api/v1/me/ledger-entries` (me.ledger-entries.index) | C | gate; `where driver_id`; reads only `trip_id, service_type` from order_requests, never `details`. | own driver / own user only | yes |
| `GET api/v1/me/payout-account` (me.payout-account.show) | C | gate; `where driver_id`; **masked** holder and number. | own driver / own user only | yes |
| `GET api/v1/me/performance` (me.performance.show) | C | gate; all aggregates `where driver_id`. | own driver / own user only | yes |
| `GET api/v1/me/photo` (me.photo.show) | C | gate; streams own `photo_path` (not fillable elsewhere). | own driver / own user only | yes |
| `GET api/v1/me/profile` (me.profile.show) | C | gate; own name/phone/email/vehicle/compliance; no licence number. | own driver / own user only | yes |
| `GET api/v1/me/promotions` (me.promotions.index) | C | gate; own referral code and progress. | own driver / own user only | yes |
| `GET api/v1/me/settlement-requests` (me.settlement-requests.index) | C | gate; `where driver_id`. | own driver / own user only | yes |
| `GET api/v1/me/stats` (me.stats.show) | C | gate; all `where driver_id`. | own driver / own user only | yes |
| `GET api/v1/me/trips` (me.trips.index) | C | gate; `Trip::forDriver()`; `DriverTripResource` — no passenger, no client, no `details`. | own driver / own user only | yes |
| `GET api/v1/settlement-requests` (settlement-requests.index) | A | `DriverSettlementRequestPolicy::viewAny` → `drivers.manage`. | listing scoped by actor | no |
| `PATCH api/v1/drivers/{driver}` (drivers.update) | A | `DriverPolicy::update` → `drivers.manage`. | platform-owned record; permission decides (403), 404 if missing | no |
| `PATCH api/v1/me/profile` (me.profile.update) | C | gate; `status`, `license_*`, `vehicle_id`, `email` **prohibited**; service fills `name`,`phone` only (double-gated). | own driver / own user only | yes |
| `POST api/v1/closure-requests/{closureRequest}/confirm` (closure-requests.confirm) | B | same helper → `drivers.manage`. | platform-owned record; permission decides (403), 404 if missing | no |
| `POST api/v1/closure-requests/{closureRequest}/decline` (closure-requests.decline) | B | same helper → `drivers.manage`; `DeclineClosureRequest::authorize()` true, defers to controller. | platform-owned record; permission decides (403), 404 if missing | no |
| `POST api/v1/driver-applications` (public.driver-applications.store) | D | throttle 5/min; **202 carrying only the ADR-0048 §4 claim ticket** — still no id and no echo; duplicates accepted silently (no oracle), and both answers have identical key sets. | public | no |
| `GET api/v1/driver-applications/documents` (public.driver-applications.documents.index) | D | throttle 5/min; authorised by the claim ticket, **not** by an email address — so it is not the status checker ADR-0027 §6 refuses. Returns slot metadata only; `file_url` is null for an application-owned row, so a stolen ticket cannot read anybody's national ID. Unknown, expired and already-decided all answer an identical 404. | public; **no `{application}` segment — the row is whichever the ticket resolves to, so there is no id to change** | no |
| `POST api/v1/driver-applications/documents` (public.driver-applications.documents.store) | D | throttle 5/min; same mime allow-list and 8 MB ceiling as the authenticated driver upload, by class extension rather than by copy. Ticket dies at the decision and after 24h. | public; ticket-scoped to one row | no |
| `DELETE api/v1/driver-applications/documents/{type}` (public.driver-applications.documents.destroy) | D | throttle 5/min; withdraws one document before any decision. 204 whether or not anything was held, so a retried withdrawal is not a 404. Destroys the file, not just the row. | public; ticket-scoped; `{type}` is an enum case, not an id | no |
| `POST api/v1/driver-applications/{driverApplication}/approve` (driver-applications.approve) | A | `DriverApplicationPolicy::decide` → `drivers.manage` && `UserPolicy::create`; role escalation re-checked in the FormRequest. | platform-owned record; permission decides (403), 404 if missing | no |
| `POST api/v1/driver-applications/{driverApplication}/reject` (driver-applications.reject) | A | `DriverApplicationPolicy::decide`. | platform-owned record; permission decides (403), 404 if missing | no |
| `POST api/v1/drivers` (drivers.store) | A | `DriverPolicy::create` → `drivers.manage`. | listing scoped by actor | no |
| `POST api/v1/drivers/{driver}/account` (drivers.account.store) | A | `DriverPolicy::manageAccount` → `drivers.manage` && `UserPolicy::create`; role escalation + can-drive in FormRequest. | platform-owned record; permission decides (403), 404 if missing | no |
| `POST api/v1/drivers/{driver}/documents/{document}/reject` (drivers.documents.reject) | A | `DriverDocumentPolicy::review` → `drivers.manage`; same driver-mismatch 404. | platform-owned record; permission decides (403), 404 if missing | no |
| `POST api/v1/drivers/{driver}/documents/{document}/verify` (drivers.documents.verify) | A | `DriverDocumentPolicy::review`; owner may not review own; same mismatch 404. | platform-owned record; permission decides (403), 404 if missing | no |
| `POST api/v1/me/closure-request` (me.closure-request.store) | C | same gate; row created for the token's driver; 409 if one is open. | own driver / own user only | yes |
| `POST api/v1/me/documents` (me.documents.store) | C | same gate; `mimes` jpg/png/webp/pdf ≤8 MB; stored under a hashed name, no client path segment. | own driver / own user only | yes |
| `POST api/v1/me/photo` (me.photo.store) | C | gate; `image` + `mimes` ≤4 MB; hashed name on the private disk. | own driver / own user only | yes |
| `POST api/v1/me/settlement-requests` (me.settlement-requests.store) | C | gate; a tip's `trip_id` checked with `Trip::forDriver()` → 404 "not one of yours" (proved). | own driver / own user only | yes |
| `POST api/v1/settlement-requests/{settlementRequest}/confirm` (settlement-requests.confirm) | A | `DriverSettlementRequestPolicy::answer` → `drivers.manage` (ADR-0032 §5 compromise: writes a ledger row without MFA). | platform-owned record; permission decides (403), 404 if missing | no |
| `POST api/v1/settlement-requests/{settlementRequest}/decline` (settlement-requests.decline) | A | `DriverSettlementRequestPolicy::answer`. | platform-owned record; permission decides (403), 404 if missing | no |
| `PUT api/v1/me/payout-account` (me.payout-account.update) | C | gate; `updateOrCreate(driver_id = token)`; `last_four` prohibited. | own driver / own user only | yes |

#### Fleet

| Route | Idiom | Refusing mechanism (evidence in the walk) | Boundary answer | Driver token |
|---|---|---|---|---|
| `DELETE api/v1/availability-blocks/{availabilityBlock}` (availability-blocks.destroy) | A | `AvailabilityBlockPolicy::delete` → same by resource type. | platform-owned record; permission decides (403), 404 if missing | no |
| `DELETE api/v1/me/availability-requests/{availabilityBlock}` (me.availability-requests.destroy) | C | gate; explicit `resource_id === own` else 404 (proved); answered → 409. | platform-owned record; permission decides (403), 404 if missing | yes |
| `DELETE api/v1/zones/{zone}` (zones.destroy) | A | `ZonePolicy::delete` → same (F15). | platform-owned record; permission decides (403), 404 if missing | no |
| `GET api/v1/allocations` (allocations.index) | A | `VehicleAllocationPolicy::viewAny` → `allocations.view`; `forActor()`. | listing scoped by actor | no |
| `GET api/v1/allocations/{allocation}` (allocations.show) | A | `VehicleAllocationPolicy::view` → `allocations.view`. | 404 cross-tenant (tenant-bound binding, proved) | no |
| `GET api/v1/availability-blocks` (availability-blocks.index) | A | `AvailabilityBlockPolicy::viewAny` → `drivers.view` **or** `vehicles.view` (every role); platform-wide, incl. free-text `reason` and `answer_note` (F2). | listing scoped by actor | no |
| `GET api/v1/me/availability-requests` (me.availability-requests.index) | C | gate; `forResource(DRIVER, own id)`; `authorize('requestOwn')` is a no-op `true`. | own driver / own user only | yes |
| `GET api/v1/driver-presence` (driver-presence.index) | A | `DriverPolicy::viewAny` → `drivers.view` (the fleet register's read; corporate roles refused per F2). Allow-listed fields: name + plate, no phone/licence/VIN. Added 2026-08-20. | listing scoped by permission | no |
| `GET api/v1/me/duty` (me.duty.show) | C | gate; presence read by own driver id; no `authorize()` call (structural). | own driver / own user only | yes |
| `GET api/v1/public/nearby-vehicles` (public.nearby-vehicles.index) | D | throttle 30/min/IP; coordinates in, anonymized positions + silhouettes out (hourly-rotating opaque key, category, kind, coords, age); radius 15km, cap 12 — one call can never dump the fleet; excludes off-duty, stale, and mid-trip drivers; no identity of any kind. Added 2026-08-20. | public | no |
| `GET api/v1/zones` (zones.index) | A | `ZonePolicy::viewAny` → `zones.view`; `visibleTo(tenant)` for a client (platform zones + own). | listing scoped by actor | yes |
| `GET api/v1/zones/resolve` (zones.resolve) | A | `ZonePolicy::viewAny`; resolver scoped `visibleTo(actor tenant)`. | listing scoped by actor | yes |
| `PATCH api/v1/allocations/{allocation}` (allocations.end) | A | `VehicleAllocationPolicy::update` → `allocations.manage`. | 404 cross-tenant (tenant-bound binding, proved) | no |
| `PATCH api/v1/zones/{zone}` (zones.update) | A | `ZonePolicy::update` → `zones.manage` && `isVisibleTo`; a client holder's cross-tenant zone id → **403** (F15). | platform-owned record; permission decides (403), 404 if missing | no |
| `POST api/v1/allocations` (allocations.store) | A | `VehicleAllocationPolicy::create` → `allocations.manage` (Super Admin); body `tenant_id` restricted to own tenant for a client actor — the pattern F15 should copy. | listing scoped by actor | no |
| `POST api/v1/availability-blocks` (availability-blocks.store) | A | `AvailabilityBlockPolicy::createFor()` → `drivers.manage`/`vehicles.manage` by resource type. | listing scoped by actor | no |
| `POST api/v1/availability-blocks/{availabilityBlock}/answer` (availability-blocks.answer) | A | `AvailabilityBlockPolicy::respond` → same, and not your own unanswered request. | platform-owned record; permission decides (403), 404 if missing | no |
| `POST api/v1/me/availability-requests` (me.availability-requests.store) | C | gate; type/id/status/creator all set server-side; throttle 10/min. | own driver / own user only | yes |
| `POST api/v1/me/presence` (me.presence.store) | C | gate; `driver_id` never from the body — Redis key and DB row keyed by the token's driver (spoof-proof); throttle 30/min. | own driver / own user only | yes |
| `POST api/v1/zones` (zones.store) | A | `ZonePolicy::create` → `zones.manage`; body `tenant_id` only `exists:tenants` (F15). | listing scoped by actor | no |
| `PUT api/v1/me/duty` (me.duty.update) | C | gate; `setDuty(own id)`; `vehicle_id` may be any existing vehicle (operational note). | own driver / own user only | yes |

#### Bookings

| Route | Idiom | Refusing mechanism (evidence in the walk) | Boundary answer | Driver token |
|---|---|---|---|---|
| `GET api/v1/bookings` (bookings.index) | A/C | `BookingPolicy::viewAny` = true; `Booking::forActor()`; narrowed to own requests without `bookings.view.all`. | listing scoped by actor | no |
| `GET api/v1/bookings/{booking}` (bookings.show) | A | `BookingPolicy::view` → `bookings.view.all` or requester; nests `DriverResource` (driver phone/licence to the requester — F2 shape). | 404 cross-tenant (tenant-bound binding, proved) | no |
| `GET api/v1/order-requests` (order-requests.index) | A | `OrderRequestPolicy::viewAny` → **platform-level** && `order_requests.manage` (a tenant user is 403 even with the permission, tested); `OrderRequestResource` emits `details` whole (F1). | listing scoped by actor | no |
| `GET api/v1/order-requests/{orderRequest}` (order-requests.show) | A | `OrderRequestPolicy::view`; platform-owned binding → 403 for a client on an existing id, 404 on a missing one (F12 class, tested as 403 by design). | platform-owned record; permission decides (403), 404 if missing | no |
| `PATCH api/v1/order-requests/{orderRequest}` (order-requests.update) | A | `OrderRequestPolicy::update`; status enum + `dispatcher_notes` only. | platform-owned record; permission decides (403), 404 if missing | no |
| `POST api/v1/bookings` (bookings.store) | A | `BookingPolicy::create` → `bookings.create`; `tenant_id` from context — a platform actor has none → NOT NULL violation (F18, not run). | listing scoped by actor | no |
| `POST api/v1/bookings/{booking}/approval` (bookings.approve) | A | `BookingPolicy::approve` → `bookings.approve`. | 404 cross-tenant (tenant-bound binding, proved) | no |
| `POST api/v1/bookings/{booking}/cancellation` (bookings.cancel) | A | `BookingPolicy::cancel` → `bookings.cancel.any` or requester. | 404 cross-tenant (tenant-bound binding, proved) | no |
| `POST api/v1/bookings/{booking}/rejection` (bookings.reject) | A | `BookingPolicy::reject` → `bookings.approve`. | 404 cross-tenant (tenant-bound binding, proved) | no |
| `POST api/v1/public/order-requests` (public.order-requests.store) | D | throttle from settings (floor 1/min/IP); 503 when walk-ins paused; honeypot returns a fake reference without a write; **201 echoes `reference` only**; unknown `details.*` keys stripped by validation; no route resolves an order by reference. | public | no |
| `GET api/v1/public/fare-quotes` (public.fare-quotes.index) | D | throttle 30/min/IP; coordinates in, the public tariff's arithmetic out (one quote per ride class, or null); keyed by nothing a customer owns; no write. Added 2026-08-19. | public | no |

#### Dispatch

| Route | Idiom | Refusing mechanism (evidence in the walk) | Boundary answer | Driver token |
|---|---|---|---|---|
| `GET api/v1/bookings/{booking}/candidate-drivers` (bookings.candidate-drivers.index) | A | `BookingPolicy::dispatch`; spreads `DriverResource` into `CandidateDriverResource` (allow-listed at one remove; pinned). | 404 cross-tenant (tenant-bound binding, proved) | no |
| `GET api/v1/bookings/{booking}/candidate-vehicles` (bookings.candidate-vehicles.index) | A | `BookingPolicy::dispatch`; spreads `VehicleResource` (pinned). | 404 cross-tenant (tenant-bound binding, proved) | no |
| `GET api/v1/bookings/{booking}/recommendation` (bookings.recommendation.index) | A | `BookingPolicy::dispatch`. | 404 cross-tenant (tenant-bound binding, proved) | no |
| `GET api/v1/me/offers` (me.offers.index) | C | gate; `where driver_id ... live()`; `details` only via `OrderDetails` allow-lists. | own driver / own user only | yes |
| `POST api/v1/bookings/{booking}/assignment` (bookings.assignment.store) | A | `BookingPolicy::dispatch` → `bookings.dispatch`; FormRequest docblock claims a tenant check on driver/vehicle it does not perform (harmless, ADR-0005). | 404 cross-tenant (tenant-bound binding, proved) | no |
| `POST api/v1/bookings/{booking}/auto-assignment` (bookings.auto-assignment.store) | A | `BookingPolicy::dispatch`; 409 unless automatic dispatch enabled. | 404 cross-tenant (tenant-bound binding, proved) | no |
| `POST api/v1/me/offers/{offer}/acceptance` (me.offers.acceptance.store) | C | gate; `ownOffer()` = `where driver_id`->`find` → another driver's offer is **404** (proved); `DispatchOfferService::accept()` itself trusts its caller. | own driver / own user only | yes |
| `POST api/v1/me/offers/{offer}/decline` (me.offers.decline.store) | C | gate; `ownOffer()` → 404 (proved). | own driver / own user only | yes |

#### Trips

| Route | Idiom | Refusing mechanism (evidence in the walk) | Boundary answer | Driver token |
|---|---|---|---|---|
| `GET api/v1/live-positions` (live-positions.index) | C | no `authorize()`; `Trip::forActor()` + own-driver/own-booking narrowing unless `trips.view.all` (ADR-0019); positions filtered to those trips. | listing scoped by actor | yes |
| `GET api/v1/trips` (trips.index) | A/C | `TripPolicy::viewAny` = true; `Trip::forActor()`; narrowed to own driver / own booking without `trips.view.all`. | listing scoped by actor | yes |
| `GET api/v1/trips/{trip}` (trips.show) | A | `TripPolicy::view` → `trips.view.all` or assigned driver or requester. | 404 cross-tenant (tenant-bound binding, proved) | yes |
| `GET api/v1/trips/{trip}/events` (trips.events.index) | A | `TripPolicy::view`. | 404 cross-tenant (tenant-bound binding, proved) | yes |
| `GET api/v1/trips/{trip}/locations` (trips.locations.index) | A | `TripPolicy::view`; `meta.gps_distance_km` null on a trip with no points vs non-nullable in the spec (F14). | 404 cross-tenant (tenant-bound binding, proved) | yes |
| `GET api/v1/trips/{trip}/odometer-photo/{moment}` (trips.odometer-photo.show) | A | `TripPolicy::view`; 404 with the controller's own message when no photo is held. | 404 cross-tenant (tenant-bound binding, proved) | yes |
| `GET api/v1/trips/{trip}/route` (trips.route.show) | A | `TripPolicy::view`. | 404 cross-tenant (tenant-bound binding, proved) | yes |
| `POST api/v1/customer/trips/{trip}/rating` (customer.trips.rating.store) | C | controller compares `trip.customer_id` (404 for another customer's trip, proved). ~~Binding failed closed under TenantScope for a Customer — endpoint dead~~ (F5, **closed 2026-08-20**: the resolver now drops the scope for a Customer actor exactly as for platform staff; `Trips/TripRatingTest` covers the lifecycle). | 404 cross-tenant (controller ownership check, proved) | no |
| `POST api/v1/trips` (trips.store) | A | `TripPolicy::create` → `trips.create`. | listing scoped by actor | no |
| `POST api/v1/trips/{trip}/locations` (trips.locations.store) | A | `TripPolicy::recordLocations` → `trips.locations.record` and (`trips.transition.any` or assigned driver) — driver A cannot push GPS onto B's trip. | 404 cross-tenant (tenant-bound binding, proved) | yes |
| `POST api/v1/trips/{trip}/transitions` (trips.transitions.store) | A | `TripPolicy::transition` → `any` / `finance` (disputed, closed) / `own` (journey states, assigned driver only). `stop_id` (ADR-0045 §2) is validated against the route's trip and refused 422 on another trip's stop. | 404 cross-tenant (tenant-bound binding, proved) | yes |
| `POST api/v1/trips/{trip}/stops` (trips.stops.store) | A | `TripPolicy::addStop` → `trips.transition.any`, or `trips.transition.own` + assigned driver; 409 TRIP_NOT_ACTIVE outside the journey statuses; a `client_place_id` from another client is refused 422 in one masked sentence (`TripStopService::resolvePlace`, proved). | 404 cross-tenant (tenant-bound binding, proved) | yes |
| `GET api/v1/trips/{trip}/stop-candidates` (trips.stop-candidates.index) | A | `TripPolicy::viewStopCandidates` → the trip's own driver only (ADR-0045 §10 — F2's direction of leak is the reason dispatchers are 403 here and read `/places` instead); 409 outside the journey statuses; serves name/address/pin only, capped at 12; walk-in trips answer an empty list. | 404 cross-tenant (tenant-bound binding, proved) | yes |
| `GET api/v1/trips/{trip}/place-suggestions` (trips.place-suggestions.index) | A | The §10 follow-up (owner decision, 2026-08-22): same `TripPolicy::viewStopCandidates` gate and 409 outside the journey statuses. Proxies the typed query — nothing else — to a public geocoder server-side; fails soft to `[]`; capped at 6; nothing tenant-owned is read, so nothing can leak. | 404 cross-tenant (tenant-bound binding, proved) | yes |

#### Billing

| Route | Idiom | Refusing mechanism (evidence in the walk) | Boundary answer | Driver token |
|---|---|---|---|---|
| `GET api/v1/invoices` (invoices.index) | A | `InvoicePolicy::viewAny` → `invoices.view`; `InvoiceRepository::listing(actor)` (`forActor`). | listing scoped by actor | no |
| `GET api/v1/invoices/{invoice}` (invoices.show) | A | `InvoicePolicy::view` → `invoices.view` (platform Dispatcher → 403 by design, ADR-0006). | 404 cross-tenant (tenant-bound binding, proved) | no |
| `GET api/v1/invoices/{invoice}/credit-notes` (invoices.credit-notes.index) | A | `InvoicePolicy::view` on the parent invoice. | 404 cross-tenant (tenant-bound binding, proved) | no |
| `GET api/v1/rate-cards` (rate-cards.index) | A | `RateCardPolicy::viewAny` → `ratecards.view`; `forActor()` on card, versions and rates. | listing scoped by actor | no |
| `GET api/v1/rate-cards/{rate_card}` (rate-cards.show) | A | `RateCardPolicy::view`; `{rate_card}` still binds `$rateCard` (snake fallback) through the tenant-aware resolver — 404 cross-tenant proved. | 404 cross-tenant (tenant-bound binding, proved) | no |
| `PATCH api/v1/rate-cards/{rateCard}` (rate-cards.update) | A | `RateCardPolicy::update` → `ratecards.manage`. | 404 cross-tenant (tenant-bound binding, proved) | no |
| `POST api/v1/invoices/{invoice}/credit-notes` (invoices.credit-notes.store) | A | `InvoicePolicy::credit` → `invoices.credit`; `invoice_line_id` exists-check is tenant-scoped. | 404 cross-tenant (tenant-bound binding, proved) | no |
| `POST api/v1/rate-cards` (rate-cards.store) | A | `RateCardPolicy::create` → `ratecards.manage`; `tenant_id` = actor's (platform actor makes a platform-owned card). | listing scoped by actor | no |
| `POST api/v1/rate-cards/{rateCard}/versions` (rate-cards.versions.store) | A | `RateCardPolicy::update`; service re-reads via `forActor()->lockForUpdate()`. | 404 cross-tenant (tenant-bound binding, proved) | no |
| `POST api/v1/trips/{trip}/invoice` (trips.invoice.store) | A | `InvoicePolicy::create` → `invoices.create`; walk-in trip → 409 not invoiceable. | 404 cross-tenant (tenant-bound binding, proved) | no |
| `PUT api/v1/rate-cards/{rateCard}/default` (rate-cards.default.update) | A | `RateCardPolicy::update`. | 404 cross-tenant (tenant-bound binding, proved) | no |

#### Reports

| Route | Idiom | Refusing mechanism (evidence in the walk) | Boundary answer | Driver token |
|---|---|---|---|---|
| `GET api/v1/reports/drivers` (reports.drivers.index) | A | `Gate viewReports` → `reports.view`; `ReportScope` forces a client actor to own tenant. | listing scoped by actor | no |
| `GET api/v1/reports/exports` (reports.exports.index) | A | `Gate viewReports`; `ReportExport` is BelongsToTenant. | listing scoped by actor | no |
| `GET api/v1/reports/exports/{export}` (reports.exports.show) | A | `Gate viewReport(export.report)`; tenant-bound binding → 404 cross-tenant (proved). | 404 cross-tenant (tenant-bound binding, proved) | no |
| `GET api/v1/reports/exports/{export}/download` (reports.exports.download) | A | `Gate viewReport(export.report)`; 404 cross-tenant (proved). | 404 cross-tenant (tenant-bound binding, proved) | no |
| `GET api/v1/reports/financial` (reports.financial.index) | A | `Gate viewReport(FINANCIAL)` → `reports.view` + `invoices.view` (a Dispatcher is refused). | listing scoped by actor | no |
| `GET api/v1/reports/trips` (reports.trips.index) | A | `Gate viewReports`; `ReportScope`. | listing scoped by actor | no |
| `GET api/v1/reports/vehicles` (reports.vehicles.index) | A | `Gate viewReports`; `ReportScope`. | listing scoped by actor | no |
| `POST api/v1/reports/exports` (reports.exports.store) | A | `Gate viewReport(type)` → per-report permissions (`ReportType::isReadableBy`). | listing scoped by actor | no |

#### Notifications

| Route | Idiom | Refusing mechanism (evidence in the walk) | Boundary answer | Driver token |
|---|---|---|---|---|
| `DELETE api/v1/me/devices/{token}` (me.devices.destroy) | C | `where user_id = token holder`; 204 either way, no oracle. | own driver / own user only | yes |
| `GET api/v1/notifications` (notifications.index) | C | `Notification::for(user)` = `forActor()` + `where user_id`. | listing scoped by actor | yes |
| `PATCH api/v1/notifications` (notifications.read-all) | C | same scope, `unread()->update`. | listing scoped by actor | yes |
| `PATCH api/v1/notifications/{notification}` (notifications.read) | C | `int` param; `for(user)->find` → 404 (proved) but through a `success` envelope with no `code` (F13). | listing scoped by actor | yes |
| `POST api/v1/me/devices` (me.devices.store) | C | keyed to the *user*: `updateOrCreate(token → user_id)` — re-homes any token string to the caller (F10). | own driver / own user only | yes |

#### Support

| Route | Idiom | Refusing mechanism (evidence in the walk) | Boundary answer | Driver token |
|---|---|---|---|---|
| `GET api/v1/me/support-requests` (me.support-requests.index) | C | gate; `where driver_id`. | own driver / own user only | yes |
| `GET api/v1/support-requests` (support-requests.index) | A | `SupportRequestPolicy::viewAny` → `drivers.manage` — tenant Fleet/Branch/Depot Managers read every driver's free-text reports (F16, documented compromise). | listing scoped by actor | no |
| `GET api/v1/support-requests/{supportRequest}` (support-requests.show) | A | `SupportRequestPolicy::view` → `drivers.manage`; platform-owned binding → 403/404 oracle (F12 class). | platform-owned record; permission decides (403), 404 if missing | no |
| `POST api/v1/me/support-requests` (me.support-requests.store) | C | gate; `trip_id` checked with `Trip::forDriver()` → 404 (proved). | own driver / own user only | yes |
| `POST api/v1/support-requests/{supportRequest}/answer` (support-requests.answer) | A | `SupportRequestPolicy::answer` → `drivers.manage` (F16). | platform-owned record; permission decides (403), 404 if missing | no |

## 3 · What was proved by running

All in `backend/tests/Feature/Ci/*` and `backend/tests/Feature/Tenancy/*`
(this package's files). Every assertion is a count or an exact status; each
refusal has an owning-side twin that must succeed, so a fixture that failed
to create the record cannot make the refusal pass on nothing. Each was proved
to bite by mutation, restored before commit.

| Test | Proves | Pinned counts | Mutation that made it fail (restored) |
|---|---|---|---|
| **3.1** `Ci/RoutePolicyCensusTest` | every route has a census row and idiom; every non-public route carries `auth:sanctum` or `auth:customer`; every public route carries a throttle; every staff route but the seven `auth/*` self-service ones runs `IdentifyTenant` | 175 routes · 14 public · 3 idiom-B · 154 sanctum (147 + 7) · 7 customer-guard — **the three new public routes are ADR-0048 §4's applicant KYC verbs; the hard-coded public count is the tripwire that caught them** | (structural — a route added without a row fails it; asserted by construction rather than mutated) |
| **3.2** `Tenancy/CrossTenantAnswers404Test` | another client's **Super Admin** — the most-permissioned actor a tenant can hold, so a 403 could only be a leak — gets **404 NOT_FOUND on all 32 tenant-bound routes**; the owning client gets anything but 404 on the same 32 URLs. Routes found by reflection over `BelongsToTenant` and pinned by hand | 32 routes · 1 named exemption for the missing `code` on `notifications.read` (F13) | `resolveRouteBinding` made to drop `TenantScope` for every actor → **`allocations.show` answered 200 to another client**, caught on the first route |
| **3.3** `Tenancy/DriverOwnershipIsolationTest` | a console token with **no driver row** is refused `403 NOT_A_DRIVER` on **32 of the 35** `/me` routes; the three that answer it are pinned by name and status (`me.devices.*` are the user's own; `me.documents.file` is `DriverDocumentPolicy` — owner *or* `drivers.manage`, the same permission as the office route). A real driver clears all 35 gates. Driver A → driver B's offer/block/trip-in-body: **404**; B's document file: **403** (F12); B's trip via `trips.show`: not 200. Listings exact: 1/1/1/1/1/1 for A, 3 trips for B. No phantom name in `ClientScope::routesFor('driver')` | 35 `/me` routes · 32 refused · 3 open · 52 names on the allow-list, all real | `if ($driver === null)` gate disabled in `DriverStatsController` → **`me.stats.show` answered 500** instead of 403, caught |
| **3.4** `Tenancy/CustomerOwnershipIsolationTest` | customer A lists exactly 2 of 6 orders; another customer's order id → 404 and its owner → 200; another customer's trip rating → 404 | 2 own · 3 theirs · 1 anonymous | (the ownership `where` is the mechanism; see F5 for why the rating half is pinned rather than proved) |
| **3.5** `Ci/ResourceAllowListTest` | across all 41 `Resources/*.php`: no `parent::toArray`, `attributesToArray`, `getAttributes`, `$this->resource->toArray`; **exactly two** resources emit `'details' => $this->details` (F1), pinned by path; exactly two resource-into-resource spreads (`Candidate{Driver,Vehicle}Resource`), pinned; no `details[` indexing anywhere | 41 files · 2 · 2 · 0 | a third `details` emitter and a `parent::toArray(` added to `DispatchOfferResource` → **both scans caught** |

**Ran, and green:** all 77 tests in the two directories (781 assertions),
locally against MariaDB via XAMPP; and — the closest thing to "against the
deployed database" available tonight — the whole Pest suite in CI against
**MySQL 8.4**, the engine the production stack runs, after this package
bumped the `backend` job's service image from 8.0 (EOL April 2026) as W1-a
handed over. **Run [32163521362](https://github.com/RealAkram20/kangaru/actions/runs/32163521362) on `063c8ab`: all six jobs green; Backend pulled `mysql:8.4` and ran 1241 tests, 4874 assertions.**

**Also proved, by the failing half of a test:** the customer rating endpoint
is dead (F5). A test that expected 201 on the customer's own completed trip
got 404 with the framework's message, not the controller's — the binding
never resolved.

## 4 · Findings

Ranked. **None is a missing policy**, so by the brief's own definition none
is a tonight-blocker; F2 and F4 are the two the owner should read before
go-live anyway, because both hand personal or financial data to a wider
audience than anyone decided. Each is addressed to the module that owns the
fix. **W1-c changed none of this.**

| # | Severity | Finding | Owner |
|---|---|---|---|
| F1 | Medium | **`order_requests.details` emitted wholesale by two resources.** `Bookings/Resources/OrderRequestResource.php:45` (the desk queue: `order-requests.index/show/update`, and `customers.activity.index`) and `Customers/Resources/CustomerOrderRequestResource.php:39` (the customer's own read-back). `details` can hold exactly the 15 keys `StorePublicOrderRequest` validates — including `sender_phone`, `recipient_phone`, `kyc_documents` — since Laravel strips unvalidated nested keys. The desk needs the phones; the customer is reading their own form; **but** `OrderDetails.php` documents itself as "the one place `order_requests.details` is read", which is false, and the whole point of that class was that the set of escaping keys is greppable in one place. `DispatchOfferResource`, `TripResource`, `CustomerRideResource` do it right (allow-lists). **Fix:** route both through `OrderDetails` allow-lists (a `DESK_FIELDS` constant); the pin in 3.5 then fails and comes out. | Bookings, Customers |
| F2 | **High** (data protection) | **`drivers.view` is in `$everyoneReads` (`RoleSeeder.php:78`), so every seeded role — Corporate Admin, Corporate Employee, Driver — can list all drivers.** `GET /drivers` is unpaginated and `DriverResource` emits `phone`, `email`, `license_number`, `license_expiry`, and the login account's email/role/status; the same permission opens `driver-applications.index/show` (applicant name/phone/email) and `availability-blocks.index` (every driver's leave with free-text `reason` — sickness, funeral — and the office's `answer_note`); `vehicles.view`, likewise universal, emits VIN. ADR-0005 makes the *roster* platform-visible so dispatching roles can assign; it does not argue for licence numbers and phone numbers reaching a bank's employees. Compounded by ADR-0022 §1: a driver-role user who omits `client` on login mints an unscoped console token and reaches all of it. **Fix (either):** drop `DRIVERS_VIEW`/`VEHICLES_VIEW` from Corporate Admin/Employee/Driver; or mask `license_number`, `phone`, `email`, `account` in `DriverResource` unless `drivers.manage`, and drop `reason`/`answer_note` from `AvailabilityBlockResource` for non-managers. **2026-08-19: the corporate half is done** — `DRIVERS_VIEW` and `VEHICLES_VIEW` are off Corporate Admin and Corporate Employee (`RoleSeeder` `$clientReads`; `tests/Feature/Clients/CorporateConsoleTest.php`); the web console hides the fleet section from both roles. The Driver role still holds both; the resource-masking alternative was not taken. | Administration (RoleSeeder), Drivers, Fleet |
| F3 | Medium | **`GET/PATCH /users/{user}` answer 403 for another tenant's user id, not 404.** `UserPolicy::view/update` require `sharesTenant`; `User` binds any id; refusal renders 403 (`UserPolicy.php:206-223,260-267`). AGENTS.md: "never return 403 for another tenant's resource". A Corporate Admin can distinguish existing from missing user ids platform-wide, including platform staff. **`UserAdminTest.php:81-91` asserts the 403** — the test enshrines it. **Fix:** 404 when `!sharesTenant` and the actor is not platform-level; flip the test. | Administration |
| F4 | Medium-High | **Plaintext bank account number and holder in `audit_logs.changes`, served by `GET /audit-logs`.** `DriverPayoutAccount` casts both `encrypted` but does not `$hidden` them; `AuditLog` snapshots via `attributesToArray()`, which applies casts. **Verified by execution** in a rolled-back transaction: the `created` row and every update's `before` hold the decrypted number. Rows carry `tenant_id` null so only platform `audit.view` holders see them, but it is an immutable copy that defeats the encrypt-at-rest intent, and it is exactly the surface a bank auditor will be shown. `Setting` shows the intended pattern (`Setting.php:40-49` masks). **Fix:** hide/mask on the model as `Setting` does; redact existing rows out-of-band. | Drivers (model), Administration (AuditLog) |
| F5 | Medium (completeness) — **CLOSED 2026-08-20** (`BelongsToTenant::resolveRouteBinding` drops TenantScope for a Customer actor; own-trip test flipped to 201; `Trips/TripRatingTest` added; the ride screen's rating card now actually calls the endpoint, which is how the owner found it) | **`POST /customer/trips/{trip}/rating` was dead — 404 for every customer, including on their own completed trip.** Proved. `{trip}` resolves through `BelongsToTenant::resolveRouteBinding`, which drops `TenantScope` only for a platform *User*; the actor is a Customer, customer routes run no `IdentifyTenant`, so the scope fails closed and the binding 404s before `TripRatingController` runs (the message is the framework's, not the controller's "No such trip."). No test in the suite hits this route. ADR-0030's loop is open at the backend. Pinned in 3.4 so the day it is fixed the test flips to 201 on purpose. **Fix:** resolve `{trip}` with `Trip::forCustomer($customer)` in the controller (as `CustomerRideController` does), or teach the resolver about the customer guard. Also a W1-f row: seeded "Trip ratings — yes" is wrong. | Trips, Customers |
| F6 | Medium | **MFA self-service needs no re-authentication, and half of it is not audited.** `POST /auth/mfa/enrol` on an unenrolled account and `POST /auth/mfa/recovery-codes` need only a bearer token (`AuthController.php:119-132,165-183`). A stolen console token can (a) enrol an attacker's authenticator and lock the owner out permanently — ADR-0008 has no admin reset and password reset does not clear `mfa_secret`; or (b) mint a fresh recovery sheet. **Verified by execution:** regeneration and recovery-code sign-in write **no** audit row (`mfa_recovery_codes` is `$hidden`, so `AuditLog::record` at `MfaService.php:323` is a no-op despite its "audited deliberately" comment); `confirmEnrolment` writes two. **Fix:** require current password or a code on both; record these events explicitly. | Administration |
| F7 | Low-Medium | **`POST /users` and `PATCH /users/{user}` validate before authorising** — `Rule::unique('users','email')` and `exists:tenants,id` answer 422 vs 403 to any authenticated tenant user, including a Driver on a console token: a platform-wide email-exists oracle. Same shape as `BookingIndexRequest.php:39-50` already closed for bookings. **Fix:** move the permission into `authorize()`. | Administration |
| F8 | Low | **`POST /companies` `tenant_id` exists-oracle** — same validate-before-policy shape; a Corporate Employee tells existing tenant ids (403) from missing (422). Auto-increment ids, low value; same fix as F7. | Clients |
| F9 | Medium (when enforcement lands) | **A Corporate Admin can PATCH their own company's `credit_limit_minor` and `status`.** `CompanyCrossTenantIsolationTest.php:74-86` asserts it is allowed; the Clients README says the limit is not yet enforced. The client sets its own credit limit and can un-suspend itself. **Fix before enforcement:** split those two fields to a finance-only permission. | Clients |
| F10 | Low-Medium | **`POST /me/devices` re-homes any push-token string to the caller** — `updateOrCreate(['token' => …], ['user_id' => caller])` with no proof the caller's device issued it (`DeviceTokenController.php:147-160`). Documented as the shared-handset feature; residual risk is a user who learns another's Expo token silently unregistering the victim's device (no job-offer pushes). **Fix:** only re-home when the previous owner's token is revoked, or require the platform/provider to match. | Notifications |
| F11 | Low-Medium | **`GET /customers/{customer}/activity` uses the staff `OrderRequestResource`**, so `customers.view` (Ops Manager holds it; not `order_requests.manage`) reads the desk's `dispatcher_notes` and whole `details` for the customer's last 50 orders. **Fix:** a customer-register-shaped resource, or `CustomerOrderRequestResource` + `handled_by`. | Customers |
| F12 | Low | **403-vs-404 existence oracles on platform-owned ids** — `me.documents.file` (another driver's document → 403; `me.settlement-requests.store` in the same module chose 404 for the same case), `drivers.documents.*` for non-managers, `customers.show`, `support-requests.show`, `order-requests.show/update`, `zones.update/destroy` (F15). Drivers/customers/orders are not "another tenant", so AGENTS.md's rule does not strictly apply and each policy documents the choice; but the ids are enumerable and two of them (`me.availability-requests.destroy`) leak only by message text. **Fix, if wanted:** render policy refusals on these bindings as 404 for non-platform actors. | Drivers, Customers, Support, Bookings, Fleet |
| F13 | Cosmetic | **`PATCH /notifications/{notification}` sends its 404 through `ApiResponse::success(null, …, 404)`** — right status, no `code`, a `success: true` envelope on a not-found. Named exemption in 3.2. | Notifications |
| F14 | Cosmetic (contract) | **`GET /trips/{trip}/locations` on a trip with no GPS points answers `meta.gps_distance_km: null`; `openapi.yaml` declares it non-nullable** (line ~4723). Every request in the suite is contract-validated, so any test that reads an empty trip's locations fails on the contract before its own assertion; W1-c's fixture had to add two points to get past it. **Fix:** `type: ['number','null']` in the spec, or `0` from the controller — an owner decision (AGENTS.md: never invent a number, so probably the spec). | Trips / contract |
| F15 | Low | **Zones: a tenant-bound `zones.manage` holder** would get 403 (not 404) on another client's zone id, and `StoreZoneRequest` accepts any existing `tenant_id` (or null) with no actor restriction — could create/re-parent zones under another tenant. Not exploitable with seeded roles (`zones.manage` is Ops Manager + Super Admin, platform-level), but roles are editable (ADR-0004) and the policy docblock plans for client holders. `StoreVehicleAllocationRequest::tenantRule()` is the pattern to copy. | Fleet |
| F16 | Low-Medium | **`SupportRequestPolicy` on `drivers.manage`** lets tenant-bound Fleet/Branch/Depot Managers read and *answer* every driver's free-text report platform-wide (assault accounts, per the resource's own comment; `trip_id`s of other tenants' trips). Documented compromise (`SupportRequestPolicy.php:18-22`); flagged because it is the most sensitive free text on the platform. | Support |
| F17 | Low | **`GET /drivers/{driver}/payout-account` is not audited** despite `OfficePayoutAccountResource.php:136` saying so — `Auditable` logs writes only. Full account number to `drivers.manage` (five roles, no MFA); acknowledged in-code as a Finance-vs-Fleet compromise. Route comment says `DriverPolicy@view`; actual is the stricter `viewPayoutAccount`. | Drivers |
| F18 | Low (not run) | **`POST /bookings` by platform staff** (Dispatcher/Finance/Ops hold `bookings.create`, have no tenant, and the request has no `tenant_id`) → `bookings.tenant_id` NOT NULL violation → 500. Read, not executed. No leak; a missing platform-actor path with no test. | Bookings |
| F19 | Low | **`POST /settings/assets/{asset}` accepts SVG** and serves it from the public disk to every visitor — stored XSS if a Super Admin is compromised. | Administration |
| F20 | Low (integrity) | **`POST /customer/rides/active/cancellation` writes the customer's reason into `order_requests.dispatcher_notes`**, overwriting any desk note on a NEW/CONTACTED order. | Customers |
| F21 | Design note | **A driver-role user can mint a console token** by omitting `client` on login. ADR-0022 §1 says so and explains why (self-declared client, not a defence against the person). Recorded because it is what turns F2 from "clients" into "clients and every driver". | — |
| F22 | **Not done** | **The deployed half.** §5. | owner (Coolify), then W1-c/W2-a |
| F23 | **CLOSED 2026-08-21 (ADR-0053)** | ~~**Driver documents are stored unencrypted**~~ — `DriverDocumentStore::store()` writes with `storeAs`, no app-level encryption; AGENTS.md line 338 requires IDs and licences "additionally app-level encrypted"; `master-plan.md` §3 asserts it as fact; ADR-0033 never mentions it; no test asserts it. Reported to W1-c and W1-e by the Driver Profile entry (worklog 2026-08-17 20:37) and **confirmed** on this walk. Needs a migration of stored files, so it is not a one-line fix. Note W1-d's runbook §6: `APP_KEY` is in no backup — the moment these *are* encrypted, that becomes the thing that loses them. **Closed by ADR-0053**: `Crypt::encryptString` on write, `driver_documents.encrypted` per row so pre-existing plaintext files still stream, one decrypting read path shared by both streaming controllers, and `DriverDocumentNotificationTest` asserts the bytes on disk are not the document. **The `APP_KEY` warning above is now live rather than hypothetical** and is the one open thread this leaves: the key is load-bearing for stored data, and W1-d's runbook still has to say so. There is deliberately **no backfill** — a shrinking set of pre-ADR files stays plaintext until replaced. | Drivers, W1-e |

**Verified as clean, and worth saying so:** `GET /public/settings` and `GET
/settings` emit no secret (checked key by key: SMTP password, Google Directions
key, Facebook app secret, SMS and payment credentials never serialise; there is
no FCM key in the catalogue). `POST /public/order-requests` echoes only the
6-character `reference`, no id, and no route resolves an order by reference.
`me.presence.store` cannot spoof another driver's position (driver id never
comes from the body). `me.profile.update` prohibits `status`, `license_*`,
`vehicle_id`, `email` and the service fills `name`,`phone` only. The
driver-side payout resource masks holder and number. `TenantScope` still fails
closed with nothing bound (`PlatformStaffIsolationTest`), and both ADR-0006
halves are green.

## 5 · Exit criteria — what is done and what is not

| Criterion (brief) | Status |
|---|---|
| Route-by-route policy census, zero gaps | **Done.** 172/172 routes carry an idiom; §2; pinned in CI (3.1). |
| Cross-tenant isolation, both halves (ADR-0006), green | **Done locally and in CI against MySQL 8.4** — the client half (`*CrossTenantIsolationTest` ×6, `WalkInTripIsolationTest`, `EmployeeTripVisibilityTest`, `TripReportCrossTenantIsolationTest`, and 3.2 above) and the platform half (`Tenancy/PlatformStaffIsolationTest`, `PlatformReportScopeTest`, `PlatformExportScopeTest`, `PlatformTenantBindingTest`). |
| Cross-tenant answers 404, never 403 | **Done for every tenant-owned record** (3.2, all 32 routes). **Two exceptions found and filed**, not fixed: `users.show/update` (F3, 403); platform-owned ids answer 403 by documented design (F12). |
| No resource spreads a whole object; `details` not emitted wholesale | **Reviewed, all 41 resources.** No model spread anywhere (3.5). `details` **is** emitted wholesale by two resources (F1) — pinned so it cannot become three. |
| ADR-0022: a driver token must not reach console routes; a non-driver token must not reach driver data | **Done.** The first was already proved by `TokenScopeTest`; the second is 3.3 (32/35 refused, 3 pinned as legitimately the user's own). |
| Audit log records a real mutation **in the deployed environment** | **NOT DONE — blocked.** No Coolify project exists. Locally, `AuditLogTest` and the `Auditable` trait's tests record mutations, and F4/F6 above came from reading and executing the log's own content; but nothing was verified on a deployed database. |
| Both isolation halves green **against the deployed database** | **NOT DONE — blocked.** Same reason. The closest honest substitute — the entire suite against MySQL 8.4 in CI on every push — is in place, and it is not the same thing. When the project exists, the runbook step is: `php artisan test --testsuite=Feature --filter='Isolation|Tenancy|CrossTenant'` against a *copy* of the production database (never the live one — RefreshDatabase truncates), plus a hand-driven `GET /api/v1/trips/{id-of-tenant-B}` as tenant A's admin on the production domain, expecting 404 NOT_FOUND. |

## 6 · What was deliberately not done

- **No module source edited.** Every finding above is addressed, not fixed.
  An auditor who fixes what they audit has audited nothing; and several fixes
  (F2, F4, F23) are decisions, not patches.
- **No red test left behind.** Two defects are *pinned* rather than left
  failing or skipped (F5's dead endpoint at 404; F13's missing code): the pin
  fails the day the owner fixes it, so the fix is a visible edit here, and a
  green suite meanwhile does not claim the endpoint works.
- **The audit log's completeness** was not audited beyond what F4 and F6
  turned up while reading; "every mutation to rate cards, contracts, invoices,
  payments, roles/permissions, credit limits" (AGENTS.md) was not walked
  mutation by mutation.
- **The frontend and driver app** were not read for what they *show* — that is
  W1-e's inventory and Track B's audit; the API is the boundary this package
  guards.
- **No performance or rate-limit tuning**, only "is there a throttle".

## 7 · Files

**Owned, new:** `backend/tests/Feature/Ci/RoutePolicyCensusTest.php`,
`backend/tests/Feature/Ci/ResourceAllowListTest.php`,
`backend/tests/Feature/Tenancy/CrossTenantAnswers404Test.php`,
`backend/tests/Feature/Tenancy/CustomerOwnershipIsolationTest.php`,
`backend/tests/Feature/Tenancy/DriverOwnershipIsolationTest.php`, this
document. **Shared, one edit each:** `.github/workflows/ci.yml` (the `backend`
job's MySQL image, 8.0 → 8.4, as W1-a handed over); `docs/agent-worklog.md`
(the W1-c entry and its amendments). **Read, not touched:** everything else.
