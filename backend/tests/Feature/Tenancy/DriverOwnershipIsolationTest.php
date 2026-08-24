<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Auth\ClientScope;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Storage;
use Modules\Dispatch\Models\DispatchOffer;
use Modules\Drivers\Enums\DriverDocumentStatus;
use Modules\Drivers\Enums\DriverDocumentType;
use Modules\Drivers\Enums\SettlementRequestKind;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Models\DriverDocument;
use Modules\Drivers\Models\DriverSettlementRequest;
use Modules\Fleet\Models\AvailabilityBlock;
use Modules\Support\Enums\SupportRequestTopic;
use Modules\Support\Models\SupportRequest;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Vehicles\Models\Vehicle;

/**
 * W1-c · Security gate — the driver's own surface.
 *
 * Drivers are platform-owned (ADR-0005), so tenancy says nothing about who
 * may read a driver's offers, ledger, papers or bank details. What protects
 * them is **ownership by the token**: every `/me/*` route resolves the
 * driver from `$request->user()` and nothing else. This file proves the two
 * things that rule has to mean:
 *
 *  1. **A console token that is not a driver gets no driver data** — the half
 *     W1-f left open ("I did not check whether a non-driver token can reach
 *     `me/promotions`"). ADR-0022 scopes what a *driver* token may reach; it
 *     says nothing about a Finance officer's unscoped `*` token walking into
 *     `/me/earnings`, so that has to be the controller's refusal, and it is
 *     — `403 NOT_A_DRIVER`, one copy per controller. Swept over every `/me`
 *     route with a pinned count and a pinned list of the routes that are
 *     *meant* to answer such a token, so a new `/me` route without the gate
 *     fails here.
 *  2. **Driver A cannot name driver B's records** — by id (404, never a
 *     200), and by listing (exact counts).
 *
 * `ClientScope::routesFor('driver')` is also checked for phantom names: a
 * route renamed without the list following it would silently close the app.
 */

/**
 * Every `/me/*` route, with a body that clears its FormRequest, so the
 * request reaches the controller's gate rather than dying at 422.
 *
 * Placeholders name fixture keys. Pinned count at the bottom of the file.
 *
 * @return array<string, array{0: string, 1: string, 2: array<string, mixed>}>
 */
function meRoutes(): array
{
    return [
        'me.availability-requests.index' => ['GET', '/api/v1/me/availability-requests', []],
        'me.availability-requests.store' => ['POST', '/api/v1/me/availability-requests', ['kind' => 'leave', 'starts_at' => now()->addDay()->toDateTimeString(), 'reason' => 'Family matter']],
        'me.availability-requests.destroy' => ['DELETE', '/api/v1/me/availability-requests/{availabilityBlock}', []],
        'me.closure-request.show' => ['GET', '/api/v1/me/closure-request', []],
        'me.closure-request.store' => ['POST', '/api/v1/me/closure-request', []],
        'me.closure-request.destroy' => ['DELETE', '/api/v1/me/closure-request', []],
        'me.devices.store' => ['POST', '/api/v1/me/devices', ['token' => 'ExponentPushToken[w1c]', 'provider' => 'expo']],
        'me.devices.destroy' => ['DELETE', '/api/v1/me/devices/ExponentPushToken[w1c]', []],
        // ADR-0057 §5: the applicant's own application, before they are a
        // driver. Both resolve from the token, so like the rest of `/me`
        // there is no id here to attempt somebody else's with.
        'me.application.documents.index' => ['GET', '/api/v1/me/application/documents', []],
        'me.application.documents.store' => ['POST', '/api/v1/me/application/documents', ['type' => 'driving_licence', 'file' => '{image}', 'expires_at' => now()->addYear()->toDateString()]],
        'me.documents.index' => ['GET', '/api/v1/me/documents', []],
        'me.documents.store' => ['POST', '/api/v1/me/documents', ['type' => 'driving_licence', 'file' => '{image}', 'expires_at' => now()->addYear()->toDateString()]],
        'me.documents.file' => ['GET', '/api/v1/me/documents/{document}/file', []],
        'me.duty.show' => ['GET', '/api/v1/me/duty', []],
        'me.duty.update' => ['PUT', '/api/v1/me/duty', ['on_duty' => true]],
        'me.earnings.show' => ['GET', '/api/v1/me/earnings', []],
        'me.ledger-entries.index' => ['GET', '/api/v1/me/ledger-entries', []],
        // Mail plan M6. On the driver's list because a third of the emails
        // this platform sends are addressed to drivers, and every one carries
        // a footer link here.
        'me.mail-preferences.index' => ['GET', '/api/v1/me/mail-preferences', []],
        'me.mail-preferences.update' => ['PUT', '/api/v1/me/mail-preferences', ['type' => 'driver.document.expiring', 'enabled' => true]],
        'me.offers.index' => ['GET', '/api/v1/me/offers', []],
        'me.offers.acceptance.store' => ['POST', '/api/v1/me/offers/{offer}/acceptance', []],
        'me.offers.decline.store' => ['POST', '/api/v1/me/offers/{offer}/decline', []],
        'me.payout-account.show' => ['GET', '/api/v1/me/payout-account', []],
        'me.payout-account.update' => ['PUT', '/api/v1/me/payout-account', ['kind' => 'bank', 'institution' => 'Bank', 'account_holder' => 'A Person', 'account_number' => '12345678']],
        'me.payout-account.destroy' => ['DELETE', '/api/v1/me/payout-account', []],
        'me.performance.show' => ['GET', '/api/v1/me/performance', []],
        'me.photo.show' => ['GET', '/api/v1/me/photo', []],
        'me.photo.store' => ['POST', '/api/v1/me/photo', ['file' => '{image}']],
        'me.photo.destroy' => ['DELETE', '/api/v1/me/photo', []],
        'me.presence.store' => ['POST', '/api/v1/me/presence', ['latitude' => 0.3152, 'longitude' => 32.5816, 'recorded_at' => now()->toDateTimeString()]],
        'me.profile.show' => ['GET', '/api/v1/me/profile', []],
        'me.profile.update' => ['PATCH', '/api/v1/me/profile', ['name' => 'Renamed']],
        'me.promotions.index' => ['GET', '/api/v1/me/promotions', []],
        'me.settlement-requests.index' => ['GET', '/api/v1/me/settlement-requests', []],
        'me.settlement-requests.store' => ['POST', '/api/v1/me/settlement-requests', ['kind' => 'payout', 'amount_minor' => 1000]],
        'me.stats.show' => ['GET', '/api/v1/me/stats', []],
        'me.support-requests.index' => ['GET', '/api/v1/me/support-requests', []],
        'me.support-requests.store' => ['POST', '/api/v1/me/support-requests', ['topic' => 'report', 'body' => 'Something happened on the road today.']],
        'me.trips.index' => ['GET', '/api/v1/me/trips', []],
    ];
}

/**
 * The `/me` routes that are supposed to answer a console user who is not a
 * driver, and with what. Everything else must be `403 NOT_A_DRIVER`.
 *
 * - `me.devices.*` are keyed to the *user*, not the driver: a device is a
 *   handset that any account may register (ADR-0025 §4).
 * - `me.documents.file` is the one `/me` route gated by a policy rather than
 *   the driver gate: `DriverDocumentPolicy::view` grants the owner **or**
 *   `drivers.manage`. A Super Admin holds `drivers.manage`, so they read the
 *   file here exactly as they would through `drivers.documents.file`. Same
 *   permission, same file, no new exposure — pinned so it stays the only one.
 *
 * @return array<string, int>
 */
function meRoutesOpenToNonDrivers(): array
{
    return [
        'me.devices.store' => 204,
        'me.devices.destroy' => 204,
        'me.documents.file' => 200,

        /*
            Mail plan M6. Not driver routes either: they are **any signed-in
            account's own email preferences**, and a dispatcher who wants to
            stop getting the settlement queue has as much business here as a
            driver does.

            200 for a non-driver, therefore, and the guard that keeps them
            honest is not `NOT_A_DRIVER` but the absence of an id: the routes
            take no parameter and scope to the token, so there is nothing to
            supply that would reach somebody else's row.
        */
        'me.mail-preferences.index' => 200,
        'me.mail-preferences.update' => 200,

        /*
            **These two are not driver routes at all** (ADR-0057 §5). They
            serve an *applicant* — somebody with an account and deliberately
            no driver profile — so `NOT_A_DRIVER` would be the wrong refusal
            in both directions: it is not what they are being refused for,
            and the driver this suite signs in as gets the same 404 because a
            driver has no open application either.

            404 is the honest answer for both: the subject is the token, and
            neither of them has an application waiting. A decided or absent
            one reads the same, which is ADR-0048 §4's rule about not
            reporting a rejection through an HTTP status.
        */
        'me.application.documents.index' => 404,
        'me.application.documents.store' => 404,
    ];
}

/**
 * Two drivers with one of everything, and a client Super Admin who is not a
 * driver at all.
 *
 * @return array<string, mixed>
 */
function twoDriversAndAConsoleUser(): array
{
    Storage::fake('local');

    $make = function (string $key): array {
        $user = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);
        $driver = Driver::factory()->forUser($user)->create();

        Storage::disk('local')->put("driver-documents/{$key}.png", 'png-bytes');
        $document = DriverDocument::create([
            'driver_id' => $driver->id,
            'type' => DriverDocumentType::DRIVING_LICENCE,
            'status' => DriverDocumentStatus::PENDING,
            'file_path' => "driver-documents/{$key}.png",
            'original_name' => 'licence.png',
            'mime_type' => 'image/png',
            'size_bytes' => 9,
            'uploaded_at' => now(),
        ]);

        $offer = DispatchOffer::factory()->create(['driver_id' => $driver->id]);
        $block = AvailabilityBlock::factory()->forDriver($driver)->create();

        DriverSettlementRequest::query()->create([
            'driver_id' => $driver->id,
            'kind' => SettlementRequestKind::PAYOUT,
            'status' => 'pending',
            'amount_minor' => 1000,
            'currency' => 'UGX',
        ]);
        SupportRequest::query()->create([
            'driver_id' => $driver->id,
            'topic' => SupportRequestTopic::REPORT,
            'status' => 'open',
            'body' => "Report from {$key}, long enough to pass validation.",
        ]);

        return compact('user', 'driver', 'document', 'offer', 'block');
    };

    $a = $make('a');
    $b = $make('b');

    // Driver B has three completed trips; A has one. Counted below.
    $trip = fn (Driver $driver) => Trip::factory()
        ->forDriver($driver)
        ->forVehicle(Vehicle::factory()->create())
        ->create(['tenant_id' => null, 'status' => TripStatus::TRIP_COMPLETED]);
    $trip($a['driver']);
    $trip($b['driver']);
    $trip($b['driver']);
    $trip($b['driver']);

    $tenant = Tenant::factory()->create();
    $console = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::SUPER_ADMIN]);

    return ['a' => $a, 'b' => $b, 'console' => $console];
}

/**
 * @param  array<string, mixed>  $body
 * @return array<string, mixed>
 */
function withMeFixtures(string $uri, array $body, array $of): array
{
    $uri = str_replace(
        ['{availabilityBlock}', '{document}', '{offer}'],
        [$of['block']->id, $of['document']->id, $of['offer']->id],
        $uri,
    );

    foreach ($body as $key => $value) {
        if ($value === '{image}') {
            $body[$key] = UploadedFile::fake()->image('x.png', 200, 200);
        }
    }

    return [$uri, $body];
}

it('lists every /me route exactly once, so a new one cannot skip this file', function () {
    $inRouter = collect(Route::getRoutes()->getRoutes())
        ->filter(fn ($route) => str_starts_with($route->uri(), 'api/v1/me/'))
        ->map(fn ($route) => (string) $route->getName())
        ->sort()->values()->all();

    $inTable = array_keys(meRoutes());
    sort($inTable);

    expect($inTable)->toBe($inRouter);
    // 37: ADR-0057 §5 added the applicant's own two.
    // 37 -> 39: mail plan M6's two `me/mail-preferences` routes.
    expect(count($inTable))->toBe(39);
    // 5: the applicant's own two joined the three that are not driver gates
    // (ADR-0057 §5). Pinned so a fourth kind of exception is a decision.
    // 5 -> 7: mail plan M6's two preference routes, which belong to the
    // account rather than to the driver profile.
    expect(count(meRoutesOpenToNonDrivers()))->toBe(7);
});

it('refuses a console user who is not a driver on every /me route but the three that are the user\'s own', function () {
    ['b' => $b, 'console' => $console] = twoDriversAndAConsoleUser();

    $refused = 0;
    $open = 0;

    foreach (meRoutes() as $name => [$method, $uri, $body]) {
        [$uri, $body] = withMeFixtures($uri, $body, $b);

        $response = $this->actingAs($console, 'sanctum')->json($method, $uri, $body);

        if (array_key_exists($name, meRoutesOpenToNonDrivers())) {
            expect($response->getStatusCode())->toBe(meRoutesOpenToNonDrivers()[$name], "{$name}: expected the pinned status for a non-driver");
            $open++;

            continue;
        }

        expect($response->getStatusCode())->toBe(403, "{$name}: a non-driver console token got {$response->getStatusCode()} — expected 403 NOT_A_DRIVER");
        expect($response->json('code'))->toBe('NOT_A_DRIVER', "{$name}: refused for the wrong reason ({$response->json('code')})");
        $refused++;
    }

    expect($refused)->toBe(32);
    // 5: ADR-0057 §5 added the applicant's own two, which refuse everybody
    // here with a 404 rather than NOT_A_DRIVER.
    // 5 -> 7: the two preference routes are the account's own, not the
    // driver profile's, so a non-driver reaches them.
    expect($open)->toBe(7);
});

it('lets the driver through the same 32 gates, so the refusals above are the gate and not the fixture', function () {
    ['a' => $a] = twoDriversAndAConsoleUser();

    $reached = 0;

    foreach (meRoutes() as $name => [$method, $uri, $body]) {
        [$uri, $body] = withMeFixtures($uri, $body, $a);

        $response = $this->actingAs($a['user'], 'sanctum')->json($method, $uri, $body);

        // Anything but the gate: 2xx, 404 for a record in the wrong state,
        // 409 for a duty conflict, 422 for a rule the fixture body trips, or
        // a streamed file. `NOT_A_DRIVER` is the one answer a real driver may
        // never get.
        $code = str_contains((string) $response->headers->get('Content-Type'), 'application/json')
            ? $response->json('code')
            : null;
        expect($code)->not->toBe('NOT_A_DRIVER', "{$name}: the driver was refused as not a driver");
        $reached++;
    }

    // 37: the two ADR-0057 §5 routes are walked here too. A driver gets a
    // plain 404 from them — they have no open application — which is exactly
    // what this test permits: anything but `NOT_A_DRIVER`.
    // 37 -> 39: mail plan M6's two `me/mail-preferences` routes.
    expect($reached)->toBe(39);
});

it('answers 404 when driver A names driver B\'s offer, availability request, or trip', function () {
    ['a' => $a, 'b' => $b] = twoDriversAndAConsoleUser();

    $this->actingAs($a['user'], 'sanctum')
        ->postJson("/api/v1/me/offers/{$b['offer']->id}/acceptance")
        ->assertStatus(404)->assertJsonPath('code', 'NOT_FOUND');

    $this->actingAs($a['user'], 'sanctum')
        ->postJson("/api/v1/me/offers/{$b['offer']->id}/decline")
        ->assertStatus(404)->assertJsonPath('code', 'NOT_FOUND');

    $this->actingAs($a['user'], 'sanctum')
        ->deleteJson("/api/v1/me/availability-requests/{$b['block']->id}")
        ->assertStatus(404)->assertJsonPath('code', 'NOT_FOUND');
    expect(AvailabilityBlock::query()->whereKey($b['block']->id)->count())->toBe(1);

    // A tip settlement names a trip in the body; B's trip is "not one of yours".
    $bTrip = Trip::allTenants()->where('driver_id', $b['driver']->id)->firstOrFail();
    $this->actingAs($a['user'], 'sanctum')
        ->postJson('/api/v1/me/settlement-requests', ['kind' => 'tip', 'amount_minor' => 500, 'trip_id' => $bTrip->id])
        ->assertStatus(404)->assertJsonPath('code', 'NOT_FOUND');

    // A support request naming B's trip, likewise.
    $this->actingAs($a['user'], 'sanctum')
        ->postJson('/api/v1/me/support-requests', ['topic' => 'report', 'body' => 'About a trip that is not mine at all.', 'trip_id' => $bTrip->id])
        ->assertStatus(404)->assertJsonPath('code', 'NOT_FOUND');

    // And B's own trip through the office-shaped route: `trips.show` is on
    // the driver's list, `TripPolicy::view` grants the assigned driver only.
    // Same tenant (none), so a 403 here would be a policy refusal that names
    // the trip; a 404 would be the scope. Either keeps the trip private —
    // the assertion is that it is not 200.
    $status = $this->actingAs($a['user'], 'sanctum')
        ->getJson("/api/v1/trips/{$bTrip->id}")
        ->getStatusCode();
    expect($status)->toBeIn([403, 404], "trips.show: driver A read driver B's trip ({$status})");
});

it('refuses driver A driver B\'s document file with a status that is not 200', function () {
    ['a' => $a, 'b' => $b] = twoDriversAndAConsoleUser();

    // 403 today (DriverDocumentPolicy::view), 404 for a missing id — an
    // existence oracle on document ids that the census records as W1-c-F12.
    // Pinned as 403 so the day it becomes 404 the finding is closed on
    // purpose rather than by accident.
    $this->actingAs($a['user'], 'sanctum')
        ->getJson("/api/v1/me/documents/{$b['document']->id}/file")
        ->assertStatus(403);

    // And their own streams, so the refusal above is not a fixture failure.
    $this->actingAs($a['user'], 'sanctum')
        ->getJson("/api/v1/me/documents/{$a['document']->id}/file")
        ->assertOk();
});

it('lists exactly the driver\'s own rows on every /me listing', function () {
    ['a' => $a, 'b' => $b] = twoDriversAndAConsoleUser();

    $count = fn (User $user, string $uri, string $path) => count($this->actingAs($user, 'sanctum')->getJson($uri)->assertOk()->json($path));

    // One offer, one block, one settlement, one support request each; one
    // trip for A and three for B. Exact, so a leak of even one row fails.
    expect($count($a['user'], '/api/v1/me/offers', 'data'))->toBe(1);
    expect($count($a['user'], '/api/v1/me/availability-requests', 'data'))->toBe(1);
    expect($count($a['user'], '/api/v1/me/settlement-requests', 'data'))->toBe(1);
    expect($count($a['user'], '/api/v1/me/support-requests', 'data'))->toBe(1);
    // `me.documents.index` answers one row per document *type*, with the
    // driver's own document or null in each — so count the non-null ones.
    $documents = collect($this->actingAs($a['user'], 'sanctum')->getJson('/api/v1/me/documents')->assertOk()->json('data'))
        ->pluck('document')->filter();
    expect($documents->count())->toBe(1);
    expect($documents->pluck('driver_id')->unique()->all())->toBe([$a['driver']->id]);
    expect($count($a['user'], '/api/v1/me/trips', 'data'))->toBe(1);
    expect($count($b['user'], '/api/v1/me/trips', 'data'))->toBe(3);
});

it('names no route in the driver allow-list that the router does not have', function () {
    // The other half of TokenScopeTest's "no me route unreachable": a name
    // on the list that no route carries is a route that was renamed and an
    // app screen that went dark without a test noticing.
    $known = collect(Route::getRoutes()->getRoutes())
        ->map(fn ($route) => $route->getName())
        ->filter()
        ->all();

    $phantom = array_values(array_diff(ClientScope::routesFor(ClientScope::DRIVER), $known));

    expect($phantom)->toBe([]);
    // 54: ADR-0045 added `trips.stops.store` and `trips.stop-candidates.index`.
    // 56: ADR-0057 §5 added the applicant's own two.
    // 57: the §10 geocoder follow-up, `trips.place-suggestions.index`
    // (owner decision, 2026-08-22).
    // 57 -> 59: the driver app reaches its own email preferences, because a
    // third of this platform's emails are addressed to drivers and every one
    // carries a footer link there.
    expect(count(ClientScope::routesFor(ClientScope::DRIVER)))->toBe(59);
});
