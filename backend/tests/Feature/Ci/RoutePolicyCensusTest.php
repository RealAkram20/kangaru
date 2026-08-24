<?php

use Illuminate\Routing\Route as RouteDefinition;
use Illuminate\Support\Facades\Route;

/**
 * W1-c · Security gate — the route-by-route policy census, pinned.
 *
 * AGENTS.md Security: *"Every endpoint has a Policy; a route without a policy
 * check fails review."* This codebase authorizes in more than one idiom, and
 * a grep for `authorize(` cannot tell them apart — it produced a false
 * positive on `ClosureRequestController`, which is gated by a private
 * `refuseWithoutPermission()`. So the census was walked by hand
 * (`docs/security-gate.md` §2 has the evidence per route) and **this file
 * pins the result**: every API route, keyed by method and URI so unnamed
 * routes cannot hide, mapped to the idiom that carries it.
 *
 * What fails here, and why that is the point:
 *
 * - **A route added without a census row.** The reviewer has to decide which
 *   idiom carries it and write it down; a route that reaches this file with
 *   no answer is exactly the "route without a policy check" the rule names.
 * - **A census row for a route that no longer exists.** The census would
 *   otherwise drift into describing a surface that is not there.
 * - **An idiom-D (public) route without a throttle**, or a non-D route without
 *   an authentication guard. The former is how an SMS-pumping cost arrives;
 *   the latter is how a leak does.
 * - **The counts.** 195 routes, 16 public — 172/11 on the working tree of 2026-08-18,
 *   plus `GET public/fare-quotes` (ADR-0026's tariff answering the order form) on 2026-08-19,
 *   plus `GET driver-presence` (the live map's on-duty pool) and
 *   `GET public/nearby-vehicles` (the order page's ambient fleet, anonymized) on 2026-08-20 —
 *   the last of which is also the first route file diff since `31c87cb`,
 *   plus the eleven of ADR-0045 (`places` and `routes`, five verbs each,
 *   and `POST routes/preview`) on 2026-08-20 — none of them public, so the
 *   D count is unchanged,
 *   plus `GET colleagues` (the booking dialog's passenger picker, gated on
 *   `bookings.create`) on 2026-08-20 — authenticated, so D is still 13,
 *   plus ADR-0048's public application-document routes on 2026-08-21, which
 *   moved D 13 -> 16 with the reasons on each row,
 *   plus the four of ADR-0050 (`vehicle-categories`, four verbs) on
 *   2026-08-21 — all `vehicles.view` / `vehicles.manage`, none public,
 *   because a corporate client has no fleet menu at all, so D stays 16.
 *
 * Idioms:
 *   A  Policy / Gate — `$this->authorize()`, `Gate::authorize()`, `can()`.
 *   B  Permission helper — `hasPermission()` behind a controller-private
 *      `refuseWithoutPermission()` (only `ClosureRequestController`).
 *   C  Ownership by the token — the query is keyed off `$request->user()`
 *      (a driver's own `/me`, a customer's own orders, a user's own inbox,
 *      the account itself). Refusal is `403 NOT_A_DRIVER` or a scoped 404;
 *      proven request-by-request in `Tenancy/DriverOwnershipIsolationTest`
 *      and `Tenancy/CustomerOwnershipIsolationTest`.
 *   D  Public by design — unauthenticated, throttled, and it echoes nothing
 *      it did not need to (`docs/security-gate.md` §2 per route).
 *
 * `A` and `C` are not exclusive; a route is filed under the idiom that
 * *refuses* it. `bookings.index` calls `authorize('viewAny')`, which returns
 * true for everyone, and is then narrowed by `forActor()` plus a
 * permission-conditioned `where` — that is `A` on paper and `C` in effect,
 * and it is filed `A/C`.
 */

/**
 * @return array<string, string> "METHOD api/v1/uri" => idiom
 */
function routeCensus(): array
{
    return [
        // ── Administration ──────────────────────────────────────────────
        'GET api/v1/audit-logs' => 'A',   // AuditLogPolicy::viewAny + forActor; unnamed route
        'POST api/v1/auth/login' => 'D',
        'POST api/v1/auth/logout' => 'C',
        'GET api/v1/auth/me' => 'C',
        'DELETE api/v1/auth/mfa' => 'C',
        'POST api/v1/auth/mfa/enrol' => 'C',
        'POST api/v1/auth/mfa/enrol/confirm' => 'C',
        'POST api/v1/auth/mfa/recovery-codes' => 'C',
        'POST api/v1/auth/mfa/verify' => 'D',
        // ADR-0056. Idiom A: `Gate::allows('act-as-another-user')` in
        // `BeginImpersonationRequest::authorize()`, checked before the rules
        // run so a refusal never depends on who was about to be named.
        // Idiom C: answers from the request's own session and nothing else.
        // `null` for everybody who is themselves, which reveals nothing.
        'GET api/v1/support/act-as' => 'C',
        'POST api/v1/support/act-as' => 'A',
        // Idiom C: keyed off the live session on the token's own actor and
        // nothing else. Deliberately ungated beyond authentication — stopping
        // is the one act a support agent must always be able to perform.
        'DELETE api/v1/support/act-as' => 'C',
        'PATCH api/v1/auth/password' => 'C',
        'POST api/v1/auth/password/forgot' => 'D',
        'POST api/v1/auth/password/reset' => 'D',
        // The invitation link (mail plan M2). Public for the same reason the
        // two above are: the caller has an account and no way into it, which
        // is the entire subject of the request. The 48-character token is the
        // credential, it is single use, and neither route sends an email, so
        // there is no outbound-mail cost to defend the way the forgot leg has.
        'GET api/v1/invitations/{token}' => 'D',
        'POST api/v1/invitations/{token}/accept' => 'D',
        // The email menu (mail plan M3). Authenticated, and gated twice: the
        // `SettingPolicy` permission AND `access_level === kangaru`, because
        // every Super Admin holds `settings.manage` including a fleet's own,
        // and `mail_toggles` has no operator_id. A fleet flipping a switch
        // would silence that email for every other fleet.
        'GET api/v1/settings/email' => 'A',
        'PUT api/v1/settings/email' => 'A',
        // A person's own email preferences (mail plan M6). Idiom C: no policy,
        // because there is no subject to authorize against — the route takes
        // no id, scopes to `$request->user()`, and there is deliberately no
        // way to name anybody else. Same shape as the `me/devices` routes.
        'GET api/v1/me/mail-preferences' => 'C',
        'PUT api/v1/me/mail-preferences' => 'C',
        'POST api/v1/auth/social' => 'D',
        'GET api/v1/public/legal' => 'D',
        'GET api/v1/public/settings' => 'D',
        'GET api/v1/roles' => 'A',
        'POST api/v1/roles' => 'A',
        'PATCH api/v1/roles/{role}' => 'A',
        'DELETE api/v1/roles/{role}' => 'A',
        'GET api/v1/settings' => 'A',
        'POST api/v1/settings/assets/{asset}' => 'A',
        'POST api/v1/settings/mail/test' => 'A',
        'PATCH api/v1/settings/{group}' => 'A',
        // Idiom A on `Booking::create` rather than on a user policy, and the
        // borrowed policy is the honest statement of the rule: you may look
        // up a colleague if you may book a car for one. `staff.view` would
        // have been the wrong gate — the Corporate Employee naming a
        // passenger does not administer anybody.
        'GET api/v1/colleagues' => 'A',
        'GET api/v1/users' => 'A',
        'POST api/v1/users' => 'A',
        'GET api/v1/users/{user}' => 'A',
        'PATCH api/v1/users/{user}' => 'A',

        // ── Clients ─────────────────────────────────────────────────────
        'GET api/v1/companies' => 'A',
        'POST api/v1/companies' => 'A',
        'GET api/v1/companies/{company}' => 'A',
        'DELETE api/v1/companies/{company}' => 'A',
        'PATCH api/v1/companies/{company}' => 'A',
        // Which fleets serve a client (owner's decision, 24 Aug). Head office
        // alone - `CompanyPolicy::assignFleets` gates on the level, not on a
        // permission, so a custom role cannot be granted it.
        'PUT api/v1/companies/{company}/fleets' => 'A',
        // ADR-0045. All A: both policies are consulted by
        // `$this->authorize()` on every action, and reads are additionally
        // narrowed by `forActor()` for platform staff (A/C in effect, filed
        // A for the same reason `bookings.index` is).
        'GET api/v1/places' => 'A',
        'POST api/v1/places' => 'A',
        'GET api/v1/places/{place}' => 'A',
        'DELETE api/v1/places/{place}' => 'A',
        'PATCH api/v1/places/{place}' => 'A',
        'GET api/v1/routes' => 'A',
        'POST api/v1/routes' => 'A',
        'POST api/v1/routes/preview' => 'A',   // ClientRoutePolicy::create — drawing a draft is building one
        'GET api/v1/routes/{route}' => 'A',
        'DELETE api/v1/routes/{route}' => 'A',
        'PATCH api/v1/routes/{route}' => 'A',

        // ── Customers (customer guard) and the staff register ────────────
        'POST api/v1/customer/auth/login' => 'D',
        'POST api/v1/customer/auth/logout' => 'C',
        'GET api/v1/customer/auth/me' => 'C',
        'POST api/v1/customer/auth/register' => 'D',
        'GET api/v1/customer/order-requests' => 'C',
        'GET api/v1/customer/order-requests/{orderRequest}' => 'C',
        'GET api/v1/customer/rides/active' => 'C',
        'POST api/v1/customer/rides/active/cancellation' => 'C',
        'POST api/v1/customer/trips/{trip}/rating' => 'C',   // customer_id compared in the controller; binding fixed 2026-08-20 (F5 closed)
        'GET api/v1/customers' => 'A',
        'GET api/v1/customers/{customer}' => 'A',
        'GET api/v1/customers/{customer}/activity' => 'A',
        'POST api/v1/customers/{customer}/suspension' => 'A',
        'DELETE api/v1/customers/{customer}/suspension' => 'A',

        // ── Vehicles ────────────────────────────────────────────────────
        // ADR-0050. The fleet's category vocabulary — read on
        // `vehicles.view` (every platform role, so the rate card dialog can
        // render the choices to Finance), written on `vehicles.manage`.
        'GET api/v1/vehicle-categories' => 'A',
        'POST api/v1/vehicle-categories' => 'A',
        'PATCH api/v1/vehicle-categories/{vehicleCategory}' => 'A',
        'DELETE api/v1/vehicle-categories/{vehicleCategory}' => 'A',
        'GET api/v1/vehicles' => 'A',
        'POST api/v1/vehicles' => 'A',
        'GET api/v1/vehicles/{vehicle}' => 'A',
        'DELETE api/v1/vehicles/{vehicle}' => 'A',
        'PATCH api/v1/vehicles/{vehicle}' => 'A',

        // ── Drivers: the office side ────────────────────────────────────
        'GET api/v1/closure-requests' => 'B',
        'POST api/v1/closure-requests/{closureRequest}/confirm' => 'B',
        'POST api/v1/closure-requests/{closureRequest}/decline' => 'B',
        'POST api/v1/driver-applications' => 'D',
        // ADR-0048 §4. Public, and authorised by a claim ticket rather than a
        // session: an opaque 64-character secret minted at submission that
        // resolves to exactly one `driver_applications` row and reaches
        // nothing else. Filed 'D' because that is what it is — unauthenticated
        // and throttled — and *not* filed as a weaker 'A', which would claim a
        // policy protects it. The ticket is checked in the controller and the
        // 404 is deliberately identical for unknown, expired and decided.
        'GET api/v1/driver-applications/documents' => 'D',
        'POST api/v1/driver-applications/documents' => 'D',
        'DELETE api/v1/driver-applications/documents/{type}' => 'D',
        'GET api/v1/driver-applications' => 'A',
        'GET api/v1/driver-applications/{driverApplication}' => 'A',
        'POST api/v1/driver-applications/{driverApplication}/approve' => 'A',
        'POST api/v1/driver-applications/{driverApplication}/reject' => 'A',
        // ADR-0048 section 4's uploads, read back by the office. 'A' like the
        // rest of the queue: an authenticated staff route behind a policy, and
        // the policy is the application's own - whoever may read the
        // application may read what was attached to it.
        'GET api/v1/driver-applications/{driverApplication}/documents' => 'A',
        'GET api/v1/driver-applications/{driverApplication}/documents/{document}/file' => 'A',
        // ADR-0057: accepting or refusing one document. 'A' like the rest of
        // the queue. Refusing does not close the application, so these are
        // not decisions on the *person* and do not join that pair.
        'POST api/v1/driver-applications/{driverApplication}/documents/{document}/verify' => 'A',
        'POST api/v1/driver-applications/{driverApplication}/documents/{document}/reject' => 'A',
        'GET api/v1/drivers' => 'A',
        'POST api/v1/drivers' => 'A',
        'GET api/v1/drivers/{driver}' => 'A',
        'DELETE api/v1/drivers/{driver}' => 'A',
        'PATCH api/v1/drivers/{driver}' => 'A',
        'POST api/v1/drivers/{driver}/account' => 'A',
        'DELETE api/v1/drivers/{driver}/account' => 'A',
        'GET api/v1/drivers/{driver}/documents' => 'A',
        'POST api/v1/drivers/{driver}/documents' => 'A',
        'GET api/v1/drivers/{driver}/documents/{document}/file' => 'A',
        'POST api/v1/drivers/{driver}/documents/{document}/reject' => 'A',
        'POST api/v1/drivers/{driver}/documents/{document}/verify' => 'A',
        'GET api/v1/drivers/{driver}/payout-account' => 'A',
        'GET api/v1/settlement-requests' => 'A',
        'POST api/v1/settlement-requests/{settlementRequest}/confirm' => 'A',
        'POST api/v1/settlement-requests/{settlementRequest}/decline' => 'A',

        // ── Drivers: the driver's own /me ───────────────────────────────
        'GET api/v1/me/closure-request' => 'C',
        'POST api/v1/me/closure-request' => 'C',
        'DELETE api/v1/me/closure-request' => 'C',
        // ADR-0057 §5: an applicant's own application, before they are a
        // driver. 'C' like the driver's own documents beside them — the
        // subject is the token, and there is no id to authorise against.
        'GET api/v1/me/application/documents' => 'C',
        'POST api/v1/me/application/documents' => 'C',
        'GET api/v1/me/documents' => 'C',
        'POST api/v1/me/documents' => 'C',
        'GET api/v1/me/documents/{document}/file' => 'A',   // DriverDocumentPolicy::view (owner or drivers.manage)
        'GET api/v1/me/earnings' => 'C',
        'GET api/v1/me/ledger-entries' => 'C',
        'GET api/v1/me/payout-account' => 'C',
        'PUT api/v1/me/payout-account' => 'C',
        'DELETE api/v1/me/payout-account' => 'C',
        'GET api/v1/me/performance' => 'C',
        'GET api/v1/me/photo' => 'C',
        'POST api/v1/me/photo' => 'C',
        'DELETE api/v1/me/photo' => 'C',
        'GET api/v1/me/profile' => 'C',
        'PATCH api/v1/me/profile' => 'C',
        'GET api/v1/me/promotions' => 'C',
        'GET api/v1/me/settlement-requests' => 'C',
        'POST api/v1/me/settlement-requests' => 'C',
        'GET api/v1/me/stats' => 'C',
        'GET api/v1/me/trips' => 'C',

        // ── Fleet ───────────────────────────────────────────────────────
        'GET api/v1/allocations' => 'A',
        'POST api/v1/allocations' => 'A',
        'GET api/v1/allocations/{allocation}' => 'A',
        'PATCH api/v1/allocations/{allocation}' => 'A',
        'GET api/v1/availability-blocks' => 'A',
        'POST api/v1/availability-blocks' => 'A',
        'DELETE api/v1/availability-blocks/{availabilityBlock}' => 'A',
        'POST api/v1/availability-blocks/{availabilityBlock}/answer' => 'A',
        'GET api/v1/me/availability-requests' => 'C',
        'POST api/v1/me/availability-requests' => 'C',
        'DELETE api/v1/me/availability-requests/{availabilityBlock}' => 'C',
        'GET api/v1/me/duty' => 'C',
        'PUT api/v1/me/duty' => 'C',
        'POST api/v1/me/presence' => 'C',
        'GET api/v1/driver-presence' => 'A',   // DriverPolicy::viewAny — the fleet register's read; the live map's pool
        'GET api/v1/public/nearby-vehicles' => 'D',   // anonymized positions + silhouettes only; throttled 30/min; radius- and count-bounded
        // ── The register of fleet companies (K2, ADR-0059) ─────────────
        // Kangaru-level only, and the level rather than the permission is
        // what holds that: a fleet's own Super Admin holds `fleets.manage`
        // and OperatorPolicy refuses them on every method.
        'GET api/v1/operators' => 'A',
        'POST api/v1/operators' => 'A',
        'GET api/v1/operators/{operator}' => 'A',
        'PATCH api/v1/operators/{operator}' => 'A',
        // ADR-0056 acts as a person, not an organisation, so Log in as needs somebody to name.
        'GET api/v1/operators/{operator}/accounts' => 'A',
        // Head office's own dashboard: counts only, never a row (ADR-0055 §2).
        // ADR-0058. The catalogue is open to any signed-in account; moving a
        // fleet between plans is head office's.
        // ADR-0055 §5. Three parties, three answers, and no party may perform
        // another's step — `approve` is keyed on the level, not a permission.
        'GET api/v1/walk-in-contracts' => 'A',
        'POST api/v1/walk-in-contracts/{contract}/consent' => 'A',
        'POST api/v1/walk-in-contracts/{contract}/approval' => 'A',
        'POST api/v1/walk-in-contracts/{contract}/refusal' => 'A',
        'GET api/v1/plans' => 'C',
        'PUT api/v1/operators/{operator}/plan' => 'A',
        'GET api/v1/kangaru/overview' => 'A',
        // ADR-0060: a boolean, so two fleets cannot create two rows for one bank.
        'GET api/v1/clients/lookup' => 'A',
        // ADR-0060, the contracts between a fleet and a client. Three verbs and
        // three different parties: a fleet asks, the client answers, either ends.
        'GET api/v1/contracts' => 'A',
        'POST api/v1/contracts' => 'A',
        'POST api/v1/contracts/{contract}/approval' => 'A',
        'DELETE api/v1/contracts/{contract}' => 'A',

        'GET api/v1/zones' => 'A',
        'POST api/v1/zones' => 'A',
        'GET api/v1/zones/resolve' => 'A',
        'PATCH api/v1/zones/{zone}' => 'A',
        'DELETE api/v1/zones/{zone}' => 'A',

        // ── Bookings and the walk-in desk ───────────────────────────────
        'GET api/v1/bookings' => 'A/C',
        'POST api/v1/bookings' => 'A',
        'GET api/v1/bookings/{booking}' => 'A',
        'POST api/v1/bookings/{booking}/approval' => 'A',
        'POST api/v1/bookings/{booking}/cancellation' => 'A',
        'POST api/v1/bookings/{booking}/rejection' => 'A',
        'GET api/v1/order-requests' => 'A',
        'GET api/v1/order-requests/{orderRequest}' => 'A',
        'PATCH api/v1/order-requests/{orderRequest}' => 'A',
        'POST api/v1/public/order-requests' => 'D',
        'GET api/v1/public/fare-quotes' => 'D',

        // ── Dispatch ────────────────────────────────────────────────────
        'POST api/v1/bookings/{booking}/assignment' => 'A',
        'POST api/v1/bookings/{booking}/auto-assignment' => 'A',
        'GET api/v1/bookings/{booking}/candidate-drivers' => 'A',
        'GET api/v1/bookings/{booking}/candidate-vehicles' => 'A',
        'GET api/v1/bookings/{booking}/recommendation' => 'A',
        'GET api/v1/me/offers' => 'C',
        'POST api/v1/me/offers/{offer}/acceptance' => 'C',
        'POST api/v1/me/offers/{offer}/decline' => 'C',

        // ── Trips ───────────────────────────────────────────────────────
        'GET api/v1/live-positions' => 'C',   // forActor + permission-conditioned own-scope; no authorize() call
        'GET api/v1/trips' => 'A/C',
        'POST api/v1/trips' => 'A',
        'GET api/v1/trips/{trip}' => 'A',
        // ADR-0045 measured distance, arrived with the origin/main merge. All three
        // authorize on the policy: viewAny for the queue, view and clearDistance for one.
        'GET api/v1/trips/distance-review' => 'A',
        'GET api/v1/trips/{trip}/distance' => 'A',
        'POST api/v1/trips/{trip}/distance/clearance' => 'A',
        'GET api/v1/trips/{trip}/events' => 'A',
        'POST api/v1/trips/{trip}/locations' => 'A',
        'GET api/v1/trips/{trip}/locations' => 'A',
        'GET api/v1/trips/{trip}/odometer-photo/{moment}' => 'A',
        'GET api/v1/trips/{trip}/route' => 'A',
        'POST api/v1/trips/{trip}/transitions' => 'A',
        // ADR-0045. Both A: `TripPolicy::addStop` (the trip's driver, or
        // `trips.transition.any`) and `TripPolicy::viewStopCandidates` (the
        // trip's driver alone — §10's bounded release of the client's place
        // register). Both additionally 409 outside the journey statuses.
        'POST api/v1/trips/{trip}/stops' => 'A',
        'GET api/v1/trips/{trip}/stop-candidates' => 'A',
        // The §10 follow-up (owner decision, 2026-08-22): the same
        // `viewStopCandidates` policy and 409 gate, answering from a
        // server-side geocoder proxy instead of the register.
        'GET api/v1/trips/{trip}/place-suggestions' => 'A',

        // ── Billing ─────────────────────────────────────────────────────
        'GET api/v1/invoices' => 'A',
        'GET api/v1/invoices/{invoice}' => 'A',
        'GET api/v1/invoices/{invoice}/credit-notes' => 'A',
        'POST api/v1/invoices/{invoice}/credit-notes' => 'A',
        'GET api/v1/rate-cards' => 'A',
        'POST api/v1/rate-cards' => 'A',
        'PATCH api/v1/rate-cards/{rateCard}' => 'A',
        'PUT api/v1/rate-cards/{rateCard}/default' => 'A',
        'POST api/v1/rate-cards/{rateCard}/versions' => 'A',
        'GET api/v1/rate-cards/{rate_card}' => 'A',
        'POST api/v1/trips/{trip}/invoice' => 'A',

        // ── Reports ─────────────────────────────────────────────────────
        // ADR-0045, arrived with the origin/main merge. authorize('viewReports').
        'GET api/v1/reports/distance' => 'A',
        'GET api/v1/reports/drivers' => 'A',
        'GET api/v1/reports/exports' => 'A',
        'POST api/v1/reports/exports' => 'A',
        'GET api/v1/reports/exports/{export}' => 'A',
        'GET api/v1/reports/exports/{export}/download' => 'A',
        'GET api/v1/reports/financial' => 'A',
        'GET api/v1/reports/trips' => 'A',
        'GET api/v1/reports/vehicles' => 'A',

        // ── Notifications ───────────────────────────────────────────────
        'POST api/v1/me/devices' => 'C',
        'DELETE api/v1/me/devices/{token}' => 'C',
        'GET api/v1/notifications' => 'C',
        'PATCH api/v1/notifications' => 'C',
        'PATCH api/v1/notifications/{notification}' => 'C',

        // ── Support (ADR-0044) ──────────────────────────────────────────
        'GET api/v1/me/support-requests' => 'C',
        'POST api/v1/me/support-requests' => 'C',
        'GET api/v1/support-requests' => 'A',
        'GET api/v1/support-requests/{supportRequest}' => 'A',
        'POST api/v1/support-requests/{supportRequest}/answer' => 'A',
    ];
}

/**
 * @return array<string, RouteDefinition>
 */
function apiRoutesByKey(): array
{
    $routes = [];

    foreach (Route::getRoutes() as $route) {
        if (! str_starts_with($route->uri(), 'api/v1/')) {
            continue;
        }

        $method = collect($route->methods())->reject(fn ($m) => $m === 'HEAD')->first();

        $routes["{$method} {$route->uri()}"] = $route;
    }

    ksort($routes);

    return $routes;
}

/**
 * `gatherMiddleware()` yields whatever the route file wrote — an alias
 * (`tenant`, `throttle:5,1`) or a class name — so both spellings are
 * accepted for each thing asked about.
 *
 * @param  array<int, string>  $needles
 */
function hasMiddleware(RouteDefinition $route, array $needles): bool
{
    foreach ($route->gatherMiddleware() as $middleware) {
        foreach ($needles as $needle) {
            if ($middleware === $needle || str_starts_with($middleware, $needle)) {
                return true;
            }
        }
    }

    return false;
}

const MW_AUTH_STAFF = ['auth:sanctum'];
const MW_AUTH_CUSTOMER = ['auth:customer'];
const MW_THROTTLE = ['throttle:', 'Illuminate\Routing\Middleware\ThrottleRequests'];
const MW_TENANT = ['tenant', 'App\Http\Middleware\IdentifyTenant'];

it('has a census row for every API route and a route for every census row', function () {
    $router = array_keys(apiRoutesByKey());
    $census = array_keys(routeCensus());
    sort($census);

    $uncensused = array_values(array_diff($router, $census));
    $phantom = array_values(array_diff($census, $router));

    expect($uncensused)->toBe([], 'Routes with no census row — decide which idiom carries each, and add it here and to docs/security-gate.md');
    expect($phantom)->toBe([], 'Census rows for routes that no longer exist');
    /**
     * 187 until ADR-0048, 190 now: the three applicant KYC verbs (§4).
     *
     * Hard-coded for the same reason the public count below is — a route
     * appearing without anybody deciding its idiom is the thing this file
     * exists to make impossible, and a total that drifted silently would let
     * a census row be *deleted* alongside its route with nothing to notice.
     */
    // 197: ADR-0045's two stop routes (add, and the driver's bounded place
    // search) on 2026-08-21, both filed A.
    // 199: the office's read-only view of an applicant's documents, 2026-08-22.
    // 201: ADR-0057 added accept and refuse for one applicant document.
    // 203: ADR-0057 §5's two applicant self-service routes.
    // 207: the §10 geocoder follow-up, `trips.place-suggestions.index`,
    // 2026-08-22.
    // 211: the fleet-company register (K2, ADR-0059) — index, store, show,
    // update. No destroy: a fleet that leaves is suspended, because six
    // operational tables carry `operator_id`.
    // 230: mail plan M2's two invitation routes, 2026-08-24. Public, and the
    // reason they are worth the tripwire firing: until they existed, a fleet
    // owner and a corporate client admin were active accounts nobody could
    // sign into, because onboarding minted a random password and discarded it.
    // 232: the email menu's read and write, 2026-08-24. Authenticated,
    // so the public count below is unchanged.
    // 235: the two `me/mail-preferences` routes, 2026-08-24. They are the
    // destination of the footer link in every email since M1, which until
    // now 404'd.
    expect(count($router))->toBe(235);
});

it('uses only the four idioms, and files sixteen routes as public', function () {
    $idioms = array_count_values(routeCensus());

    expect(array_keys($idioms))->each->toBeIn(['A', 'B', 'C', 'D', 'A/C']);

    /**
     * **Thirteen until ADR-0048, sixteen now**, and the number is hard-coded
     * on purpose: it is a tripwire, so that opening a route to the whole
     * internet is never something that happens quietly as a side effect of a
     * feature. It caught these three, which is the system working.
     *
     * The three are the applicant KYC verbs (ADR-0048 §4). Each is throttled
     * at ADR-0027 §5's 5/min/IP, none returns file bytes, and none takes an
     * id in the URL — the row is whichever one the claim ticket resolves to,
     * so there is nothing to enumerate by changing a path segment.
     */
    // 16 -> 18: mail plan M2's two invitation routes.
    expect($idioms['D'])->toBe(18);
    expect($idioms['B'])->toBe(3);
});

it('authenticates every route that is not filed as public, and throttles every one that is', function () {
    $routes = apiRoutesByKey();
    $public = 0;
    $guarded = 0;

    foreach (routeCensus() as $key => $idiom) {
        $route = $routes[$key];
        $authenticated = hasMiddleware($route, MW_AUTH_STAFF) || hasMiddleware($route, MW_AUTH_CUSTOMER);

        if ($idiom === 'D') {
            expect($authenticated)->toBeFalse("{$key}: filed public but carries an auth guard — refile it");
            expect(hasMiddleware($route, MW_THROTTLE))->toBeTrue("{$key}: a public route with no throttle");
            $public++;

            continue;
        }

        expect($authenticated)->toBeTrue("{$key}: filed {$idiom} but no authentication guard is on the route");
        $guarded++;
    }

    // 13 -> 16: ADR-0048 §4's three applicant KYC verbs, all throttled at
    // ADR-0027 §5's 5/min/IP. `$guarded` is unchanged because all three are
    // public by design, not by omission.
    // 16 -> 18: the two invitation routes, both throttled at 5/min/IP.
    expect($public)->toBe(18);
    // 181: the two ADR-0045 stop routes, both authenticated.
    // 183: the two application-document reads, both authenticated. They serve
    // somebody's identity document, so being counted here is the point.
    // 185: the same two, both authenticated.
    // 187: the same two, both authenticated.
    // 191: the geocoder place-suggestions route, authenticated like the
    // register search beside it.
    // 195: the four fleet-company routes, all authenticated. Head office's
    // register is the least public surface on the platform.
    // 214: the email menu's two routes, both authenticated.
    // 217: the two mail-preference routes, both authenticated. Nobody
    // reads or writes anybody else's; the route takes no id.
    expect($guarded)->toBe(217);
});

it('binds the actor\'s tenant on every staff route, so TenantScope has something to scope by', function () {
    // Every `auth:sanctum` route runs IdentifyTenant. A staff route without
    // it would leave TenantContext unset and TenantScope failing closed —
    // visible as an empty screen for a client, which is safe, but a route
    // that then reached for `allTenants()` to "fix" it would not be.
    //
    // The seven authenticated `auth/*` routes — logout, me, the four MFA
    // self-service calls, password change — are the exception: they act on
    // the account itself and touch no tenant-owned model, and they run under
    // `auth:sanctum` alone. Pinned at seven so an eighth cannot join them
    // without a decision.
    $routes = apiRoutesByKey();
    $staff = 0;
    $selfService = 0;

    foreach ($routes as $key => $route) {
        if (! hasMiddleware($route, MW_AUTH_STAFF)) {
            continue;
        }

        if (str_starts_with($route->uri(), 'api/v1/auth/')) {
            expect(hasMiddleware($route, MW_TENANT))->toBeFalse("{$key}: an auth self-service route now binds a tenant — refile it");
            $selfService++;

            continue;
        }

        expect(hasMiddleware($route, MW_TENANT))->toBeTrue("{$key}: a staff route without IdentifyTenant");
        $staff++;
    }

    expect($selfService)->toBe(7);
    // 167: ADR-0045's stop routes joined the staff surface on 2026-08-21.
    // 169: the two read-only routes that let a reviewer see an applicant's
    // documents joined it on 2026-08-22. This number is meant to be edited by
    // hand and only with a reason - that is the whole point of counting.
    // 171: and both are staff routes (ADR-0057).
    // 173: and both bind the actor's tenant like every other `me/` route.
    // 177: place-suggestions, same middleware stack as stop-candidates.
    // 181: the fleet-company register (K2, ADR-0059). Four staff routes, and
    // they bind the actor's tenant like the rest even though a Kangaru
    // account has none - IdentifyTenant binding a null is the fail-closed
    // state, and exempting them would be a second way to be unscoped.
    // 200: the email menu's two routes. Head office only, and they bind
    // the actor's tenant like the fleet register does.
    // 203: the two mail-preference routes, staff-guarded like `me/devices`.
    expect($staff)->toBe(203);
});
