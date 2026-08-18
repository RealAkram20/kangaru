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
 * - **The counts.** 172 routes, 11 public, on the working tree of 2026-08-18
 *   (identical to `31c87cb` for routes: no route file differs).
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
        'PATCH api/v1/auth/password' => 'C',
        'POST api/v1/auth/password/forgot' => 'D',
        'POST api/v1/auth/password/reset' => 'D',
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

        // ── Customers (customer guard) and the staff register ────────────
        'POST api/v1/customer/auth/login' => 'D',
        'POST api/v1/customer/auth/logout' => 'C',
        'GET api/v1/customer/auth/me' => 'C',
        'POST api/v1/customer/auth/register' => 'D',
        'GET api/v1/customer/order-requests' => 'C',
        'GET api/v1/customer/order-requests/{orderRequest}' => 'C',
        'GET api/v1/customer/rides/active' => 'C',
        'POST api/v1/customer/rides/active/cancellation' => 'C',
        'POST api/v1/customer/trips/{trip}/rating' => 'C',   // dead today: W1-c-F5
        'GET api/v1/customers' => 'A',
        'GET api/v1/customers/{customer}' => 'A',
        'GET api/v1/customers/{customer}/activity' => 'A',
        'POST api/v1/customers/{customer}/suspension' => 'A',
        'DELETE api/v1/customers/{customer}/suspension' => 'A',

        // ── Vehicles ────────────────────────────────────────────────────
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
        'GET api/v1/driver-applications' => 'A',
        'GET api/v1/driver-applications/{driverApplication}' => 'A',
        'POST api/v1/driver-applications/{driverApplication}/approve' => 'A',
        'POST api/v1/driver-applications/{driverApplication}/reject' => 'A',
        'GET api/v1/drivers' => 'A',
        'POST api/v1/drivers' => 'A',
        'GET api/v1/drivers/{driver}' => 'A',
        'DELETE api/v1/drivers/{driver}' => 'A',
        'PATCH api/v1/drivers/{driver}' => 'A',
        'POST api/v1/drivers/{driver}/account' => 'A',
        'DELETE api/v1/drivers/{driver}/account' => 'A',
        'GET api/v1/drivers/{driver}/documents' => 'A',
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
        'GET api/v1/trips/{trip}/events' => 'A',
        'POST api/v1/trips/{trip}/locations' => 'A',
        'GET api/v1/trips/{trip}/locations' => 'A',
        'GET api/v1/trips/{trip}/odometer-photo/{moment}' => 'A',
        'GET api/v1/trips/{trip}/route' => 'A',
        'POST api/v1/trips/{trip}/transitions' => 'A',

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
    expect(count($router))->toBe(172);
});

it('uses only the four idioms, and files eleven routes as public', function () {
    $idioms = array_count_values(routeCensus());

    expect(array_keys($idioms))->each->toBeIn(['A', 'B', 'C', 'D', 'A/C']);
    expect($idioms['D'])->toBe(11);
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

    expect($public)->toBe(11);
    expect($guarded)->toBe(161);
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
    expect($staff)->toBe(147);
});
