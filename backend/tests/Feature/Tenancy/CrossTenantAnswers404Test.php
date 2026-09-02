<?php

use App\Concerns\BelongsToTenant;
use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Str;
use Modules\Billing\Models\Invoice;
use Modules\Bookings\Models\Booking;
use Modules\Clients\Models\ClientPlace;
use Modules\Clients\Models\ClientRoute;
use Modules\Clients\Models\Company;
use Modules\Fleet\Models\VehicleAllocation;
use Modules\Notifications\Enums\NotificationType;
use Modules\Notifications\Models\Notification;
use Modules\Reports\Enums\ExportFormat;
use Modules\Reports\Enums\ExportStatus;
use Modules\Reports\Enums\ReportType;
use Modules\Reports\Models\ReportExport;
use Modules\Trips\Enums\TripStopKind;
use Modules\Trips\Enums\TripStopSource;
use Modules\Trips\Enums\TripStopStatus;
use Modules\Trips\Models\TripStop;
use Tests\Support\BillingFixtures;
use Tests\Support\GpsFixtures;

/**
 * W1-c · Security gate. AGENTS.md Security: *"Cross-tenant resource access
 * returns 404, never 403."* A 403 confirms the record exists, and for a
 * client probing another client's identifiers that confirmation is itself
 * the leak (ADR-0001, ADR-0006 implementation notes).
 *
 * ## What this proves, and how it cannot pass vacuously
 *
 * Every single-resource API route whose bound record carries
 * `BelongsToTenant` is requested twice, at the same URL:
 *
 *  1. by **another client's Super Admin** — the most-permissioned user a
 *     tenant can have, so a 403 could never be a permission denial and could
 *     only be the record's existence leaking — and must answer **404
 *     NOT_FOUND**;
 *  2. by **the owning client's own Super Admin**, who must answer anything
 *     **but** 404. Without this half, a fixture that failed to create the
 *     record would make half 1 pass on nothing at all.
 *
 * ## Why the route list is derived AND pinned
 *
 * The routes are found by reflection — every route parameter whose
 * controller-method type is a model using the trait — and that set is then
 * asserted equal to a hand-written list with a pinned count. Reflection
 * means a new `Trip $trip` route added next month is a failing test until it
 * gets a row here; the pinned list means a route that stops binding a model
 * (say, `int $id` and a hand-rolled lookup) does not silently drop out of
 * the census. `notifications.read` is exactly that case today, so it is on
 * the list and invisible to reflection.
 *
 * `customer.trips.rating.store` also binds a `Trip`, but under the `customer`
 * guard, so its actor is a Customer and not a User; it is covered by
 * `CustomerOwnershipIsolationTest` and excluded from the reflection here by
 * guard rather than by name.
 */

/**
 * Routes whose 404 is the right status but the wrong envelope. Finding
 * W1-c-F13 in `docs/security-gate.md`: `NotificationController::markRead`
 * sends its not-found through `ApiResponse::success(null, …, 404)`, so the
 * body carries no `code`. The status is what protects the record's
 * existence, so the route stays in the census; the missing code is a
 * Notifications-module fix. Pinned at exactly one entry.
 */
const ROUTES_WITH_A_404_THAT_CARRIES_NO_ERROR_CODE = ['notifications.read'];

/**
 * Route name => [method, uri-with-placeholders].
 *
 * The placeholders name the fixture key that fills them. Ordered as the
 * route table is, so a diff against `route:list` reads top to bottom.
 *
 * @return array<string, array{0: string, 1: string}>
 */
function tenantBoundRoutes(): array
{
    return [
        'allocations.show' => ['GET', '/api/v1/allocations/{allocation}'],
        'allocations.end' => ['PATCH', '/api/v1/allocations/{allocation}'],
        'bookings.show' => ['GET', '/api/v1/bookings/{booking}'],
        'bookings.approve' => ['POST', '/api/v1/bookings/{booking}/approval'],
        'bookings.assignment.store' => ['POST', '/api/v1/bookings/{booking}/assignment'],
        'bookings.auto-assignment.store' => ['POST', '/api/v1/bookings/{booking}/auto-assignment'],
        'bookings.cancel' => ['POST', '/api/v1/bookings/{booking}/cancellation'],
        'bookings.candidate-drivers.index' => ['GET', '/api/v1/bookings/{booking}/candidate-drivers'],
        'bookings.candidate-vehicles.index' => ['GET', '/api/v1/bookings/{booking}/candidate-vehicles'],
        'bookings.recommendation.index' => ['GET', '/api/v1/bookings/{booking}/recommendation'],
        'bookings.reject' => ['POST', '/api/v1/bookings/{booking}/rejection'],
        // Added by 129bc6f (acting as somebody at a corporate client) and
        // missing from this census, which is what left the suite red. The
        // route binds a Company, so it belongs here like every other
        // `{company}` route in the list.
        'companies.accounts.index' => ['GET', '/api/v1/companies/{company}/accounts'],
        'companies.show' => ['GET', '/api/v1/companies/{company}'],
        // `update` before `destroy`: the owning-client pass below runs the
        // whole table against one fixture, and a soft-deleted company would
        // 404 on its own update for the wrong reason.
        'companies.update' => ['PATCH', '/api/v1/companies/{company}'],
        // Before `destroy`, like `update` above it and for the same reason
        // this file already states: the loop runs in list order against one
        // fixture, so anything after the delete meets a soft-deleted row and
        // 404s for a reason that has nothing to do with tenancy. It cost an
        // hour to find, because the failure names the route that is fine.
        'companies.fleets.update' => ['PUT', '/api/v1/companies/{company}/fleets'],
        'companies.destroy' => ['DELETE', '/api/v1/companies/{company}'],
        // ADR-0045. Same `update` before `destroy` ordering as companies,
        // and for the same reason. `place` is deliberately not on `route`'s
        // stop list in the fixture: a place a route visits answers 409
        // CLIENT_PLACE_IN_USE, which would still prove the row resolved but
        // would stop testing the delete path itself.
        'places.show' => ['GET', '/api/v1/places/{place}'],
        'places.update' => ['PATCH', '/api/v1/places/{place}'],
        'places.destroy' => ['DELETE', '/api/v1/places/{place}'],
        'routes.show' => ['GET', '/api/v1/routes/{route}'],
        'routes.update' => ['PATCH', '/api/v1/routes/{route}'],
        'routes.destroy' => ['DELETE', '/api/v1/routes/{route}'],
        'invoices.show' => ['GET', '/api/v1/invoices/{invoice}'],
        'invoices.credit-notes.index' => ['GET', '/api/v1/invoices/{invoice}/credit-notes'],
        'invoices.credit-notes.store' => ['POST', '/api/v1/invoices/{invoice}/credit-notes'],
        'notifications.read' => ['PATCH', '/api/v1/notifications/{notification}'],
        'rate-cards.update' => ['PATCH', '/api/v1/rate-cards/{rateCard}'],
        'rate-cards.default.update' => ['PUT', '/api/v1/rate-cards/{rateCard}/default'],
        'rate-cards.versions.store' => ['POST', '/api/v1/rate-cards/{rateCard}/versions'],
        'rate-cards.show' => ['GET', '/api/v1/rate-cards/{rateCard}'],
        'reports.exports.show' => ['GET', '/api/v1/reports/exports/{export}'],
        'reports.exports.download' => ['GET', '/api/v1/reports/exports/{export}/download'],
        'trips.show' => ['GET', '/api/v1/trips/{trip}'],
        'trips.events.index' => ['GET', '/api/v1/trips/{trip}/events'],
        'trips.invoice.store' => ['POST', '/api/v1/trips/{trip}/invoice'],
        'trips.locations.store' => ['POST', '/api/v1/trips/{trip}/locations'],
        'trips.locations.index' => ['GET', '/api/v1/trips/{trip}/locations'],
        'trips.odometer-photo.show' => ['GET', '/api/v1/trips/{trip}/odometer-photo/start'],
        'trips.route.show' => ['GET', '/api/v1/trips/{trip}/route'],
        // ADR-0045. On the owning pass the fixture trip is completed, so the
        // add answers 409 TRIP_NOT_ACTIVE and the candidates search answers
        // 403 (driver-only, §10) — both of which prove the row resolved.
        'trips.stop-candidates.index' => ['GET', '/api/v1/trips/{trip}/stop-candidates'],
        // The §10 geocoder follow-up (2026-08-22): the same driver-only
        // policy, so the owning pass answers 403/409 like the two rows
        // around it — which is what proves the row resolved.
        'trips.place-suggestions.index' => ['GET', '/api/v1/trips/{trip}/place-suggestions'],
        // ADR-0045 §2, merged from main on 2026-08-23: the distance evidence
        // and the clearance act, both bound to the trip.
        'trips.distance.index' => ['GET', '/api/v1/trips/{trip}/distance'],
        'trips.distance.clear' => ['POST', '/api/v1/trips/{trip}/distance/clearance'],
        'trips.stops.store' => ['POST', '/api/v1/trips/{trip}/stops'],
        // The extension (2026-08-28). Bound to the trip exactly as the stop
        // route beside it, so another client naming a trip that is not
        // theirs gets the same 404. The two answer routes additionally bind
        // `{extension}`, but the trip is what carries the tenancy — a stop
        // inherits its trip's tenant, and a walk-in's has none.
        'trips.dropoff-arrival.store' => ['POST', '/api/v1/trips/{trip}/dropoff-arrival'],
        'trips.extensions.store' => ['POST', '/api/v1/trips/{trip}/extensions'],
        'trips.extensions.acceptance.store' => ['POST', '/api/v1/trips/{trip}/extensions/{extension}/acceptance'],
        'trips.extensions.decline.store' => ['POST', '/api/v1/trips/{trip}/extensions/{declinableExtension}/decline'],
        'trips.transitions.store' => ['POST', '/api/v1/trips/{trip}/transitions'],
    ];
}

/**
 * The same set, found by reading the router rather than by hand: every
 * `auth:sanctum` route with a parameter whose controller-method type is a
 * model that uses `BelongsToTenant`.
 *
 * @return array<int, string>
 */
function tenantBoundRoutesByReflection(): array
{
    $names = [];

    foreach (Route::getRoutes() as $route) {
        if (! str_starts_with($route->uri(), 'api/v1/')) {
            continue;
        }

        if (! in_array('auth:sanctum', $route->gatherMiddleware(), true)) {
            continue;
        }

        $controller = $route->getController();
        $method = $route->getActionMethod();

        if (! is_object($controller) || ! method_exists($controller, $method)) {
            continue;
        }

        foreach ((new ReflectionMethod($controller, $method))->getParameters() as $parameter) {
            $type = $parameter->getType();

            if (! $type instanceof ReflectionNamedType || $type->isBuiltin()) {
                continue;
            }

            $class = $type->getName();

            // A tenant-owned model, bound from the URL: implicit binding
            // matches the parameter name as written or in snake_case
            // (`{rate_card}` binds `RateCard $rateCard`).
            $bound = in_array($parameter->getName(), $route->parameterNames(), true)
                || in_array(Str::snake($parameter->getName()), $route->parameterNames(), true);

            if ($bound
                && is_subclass_of($class, Model::class)
                && in_array(BelongsToTenant::class, class_uses_recursive($class), true)) {
                $names[] = (string) $route->getName();
                break;
            }
        }
    }

    sort($names);

    return array_values(array_unique($names));
}

/**
 * Two clients. B owns one of everything a tenant-bound route can name; A
 * owns nothing but a Super Admin who will try to read B's.
 *
 * @return array{a: User, b: User, ids: array<string, int|string>}
 */
function twoClientsOneOfEverything(): array
{
    $b = BillingFixtures::tenantWithRateCard();

    $trip = BillingFixtures::completedTrip($b['tenant'], $b['dispatcher'], $b['vehicle'], $b['driver']);

    test()->withHeader('Idempotency-Key', 'idem-w1c-404')
        ->actingAs($b['finance'], 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/invoice")
        ->assertStatus(201);

    // Two GPS points, so `trips.locations.index` on the owning side has a
    // distance to report. With none it answers `meta.gps_distance_km: null`,
    // which `openapi.yaml` declares non-nullable and the contract validator
    // then fails the request before this test's assertion is reached — a
    // Trips/contract drift recorded as W1-c-F14, not this test's subject.
    GpsFixtures::straightLine($b['tenant']->id, $trip->id, 2, 100.0);

    // An unanswered extension per answer route, and the reason there are
    // two: the owning pass walks this table in order against one fixture,
    // and *both* answers consume the row they name — accepting first would
    // leave the decline naming a row that is no longer proposed, which
    // 404s for a reason that has nothing to do with tenancy. The same trap
    // this file already documents for `update` before `destroy`.
    //
    // Written straight to the table: the service would refuse an extension
    // on a completed trip, and what this census proves is the binding.
    $proposeExtension = fn (int $sequence) => TripStop::query()->create([
        'tenant_id' => $b['tenant']->id,
        'trip_id' => $trip->id,
        'sequence' => $sequence,
        'label' => 'On to Kampala Road',
        'kind' => TripStopKind::EXTENSION,
        'source' => TripStopSource::ADDED_BY_CLIENT,
        'status' => TripStopStatus::PROPOSED,
    ]);

    $extension = $proposeExtension(1);
    $declinableExtension = $proposeExtension(2);

    $invoice = Invoice::allTenants()->where('trip_id', $trip->id)->firstOrFail();
    $booking = Booking::factory()->forTenant($b['tenant'])->create();
    $company = Company::factory()->forTenant($b['tenant'])->create();
    $allocation = VehicleAllocation::factory()->forTenant($b['tenant'])->create();
    $place = ClientPlace::factory()->forTenant($b['tenant'])->create();
    $clientRoute = ClientRoute::factory()->forTenant($b['tenant'])->create();

    $bAdmin = User::factory()->create(['tenant_id' => $b['tenant']->id, 'role' => UserRole::SUPER_ADMIN]);

    $notification = Notification::create([
        'tenant_id' => $b['tenant']->id,
        'user_id' => $bAdmin->id,
        'type' => NotificationType::cases()[0],
        'subject' => 'W1-c',
        'body' => 'W1-c',
        'url' => null,
        'context' => [],
    ]);

    $export = ReportExport::create([
        'tenant_id' => $b['tenant']->id,
        'requested_by_user_id' => $bAdmin->id,
        'report' => ReportType::cases()[0],
        'format' => ExportFormat::cases()[0],
        'status' => ExportStatus::cases()[0],
        'filters' => [],
    ]);

    $tenantA = Tenant::factory()->create();
    $aAdmin = User::factory()->create(['tenant_id' => $tenantA->id, 'role' => UserRole::SUPER_ADMIN]);

    // The fixtures bound B by hand. Every request below binds its own actor's
    // tenant through IdentifyTenant, so start from nothing bound.
    app(TenantContext::class)->set(null);

    return [
        'a' => $aAdmin,
        'b' => $bAdmin,
        'ids' => [
            'allocation' => $allocation->id,
            'booking' => $booking->id,
            'company' => $company->id,
            'place' => $place->id,
            'route' => $clientRoute->id,
            'invoice' => $invoice->uuid,
            'notification' => $notification->id,
            'rateCard' => $b['card']->id,
            'export' => $export->id,
            'trip' => $trip->id,
            'extension' => $extension->id,
            'declinableExtension' => $declinableExtension->id,
        ],
    ];
}

/**
 * @param  array<string, int|string>  $ids
 */
function fillTenantBoundUri(string $uri, array $ids): string
{
    return preg_replace_callback('/\{(\w+)\}/', fn (array $m) => (string) $ids[$m[1]], $uri);
}

it('binds a tenant-owned model on exactly the routes this file lists', function () {
    $expected = array_keys(tenantBoundRoutes());
    sort($expected);

    // `notifications.read` takes `int $notification` and looks the row up by
    // hand, so reflection cannot see it; it is on the list above because the
    // record it names is tenant-owned all the same.
    $visibleToReflection = array_values(array_diff($expected, ['notifications.read']));

    expect(tenantBoundRoutesByReflection())->toBe($visibleToReflection);
    // 41: `trips.place-suggestions.index`, the §10 geocoder follow-up
    // (2026-08-22). 45: `companies.accounts.index`, from 129bc6f — head
    // office acting as somebody at a corporate client (2026-08-26).
    // 49: the extension's four routes (2026-08-28). The accept/decline
    // pair binds a TripStop as well, which is tenant-owned like its trip.
    expect(count($expected))->toBe(49);
});

it('answers 404, never 403, when another client names a tenant-owned record', function () {
    ['a' => $aAdmin, 'ids' => $ids] = twoClientsOneOfEverything();

    $checked = 0;

    foreach (tenantBoundRoutes() as $name => [$method, $uri]) {
        $response = $this->actingAs($aAdmin, 'sanctum')
            ->withHeader('Idempotency-Key', "idem-w1c-cross-{$name}")
            ->json($method, fillTenantBoundUri($uri, $ids));

        expect($response->getStatusCode())
            ->toBe(404, "{$name}: another client's Super Admin got {$response->getStatusCode()}, expected 404 — a 403 would confirm the record exists");

        if ($name === 'trips.odometer-photo.show') {
            // See the owning-client pass: this route 404s for its owner too,
            // so here the message must be the framework's, proving the trip
            // never resolved rather than "resolved, no photo".
            expect($response->json('message'))->toBe('The requested resource could not be found.', "{$name}: the trip resolved for another client");
        }

        if (in_array($name, ROUTES_WITH_A_404_THAT_CARRIES_NO_ERROR_CODE, true)) {
            // Pinned, not tolerated: the day the owner fixes it this line
            // fails and the exemption comes out.
            expect($response->json('code'))->toBeNull("{$name}: now sends an error code — remove it from the exemption list");
        } else {
            expect($response->json('code'))->toBe('NOT_FOUND', "{$name}: wrong error code");
        }

        $checked++;
    }

    // 41: place-suggestions (2026-08-22).
    // 49: the extension's four routes (2026-08-28).
    expect($checked)->toBe(49);
});

it('answers something other than 404 to the owning client on every one of those routes, so the 404s above are not vacuous', function () {
    ['b' => $bAdmin, 'ids' => $ids] = twoClientsOneOfEverything();

    $checked = 0;

    foreach (tenantBoundRoutes() as $name => [$method, $uri]) {
        $response = $this->actingAs($bAdmin, 'sanctum')
            ->withHeader('Idempotency-Key', "idem-w1c-own-{$name}")
            ->json($method, fillTenantBoundUri($uri, $ids));

        // 200/201 on reads and valid writes, 422 on writes given no body,
        // 409 where the record is in the wrong state, 403 where the Super
        // Admin is the wrong actor for a driver-only transition. Any of
        // those proves the record was found; only 404 would mean it was not.
        if ($name === 'trips.odometer-photo.show') {
            // The one route that answers 404 to its owner as well, when no
            // photo is held — which the fixture trip has none of. The
            // discriminator is the message: the controller's own "no photo"
            // sentence proves the trip resolved and the policy passed, where
            // the cross-tenant case above got the framework's generic
            // not-found before the controller ran.
            expect($response->getStatusCode())->toBe(404);
            expect($response->json('message'))->toBe('No dashboard photo was captured for this odometer reading.', "{$name}: the owning client's 404 was not the controller's — the trip did not resolve");
            $checked++;

            continue;
        }

        expect($response->getStatusCode())
            ->not->toBe(404, "{$name}: the owning client's Super Admin got 404 — the fixture is missing and the cross-tenant 404 proves nothing");

        $checked++;
    }

    // 41: place-suggestions (2026-08-22).
    // 49: the extension's four routes (2026-08-28).
    expect($checked)->toBe(49);
});
