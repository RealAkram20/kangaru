<?php

use App\Enums\UserRole;
use App\Models\Customer;
use App\Models\User;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Modules\Administration\Services\SettingsService;
use Modules\Bookings\Models\OrderRequest;
use Modules\Drivers\Models\Driver;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Vehicles\Models\Vehicle;

/**
 * `GET /trips/{trip}/route` — the road ahead (ADR-0031).
 *
 * **Every failure here has to be a 200 with a null route.** That is the rule
 * this whole file exists to hold: no key, switch off, no network, a quota
 * rejection, two points with no road between them. A driver reading this
 * screen has a passenger in the car, and a 4xx would turn a missing polyline
 * into a screen they cannot use — the map already knows how to draw a dashed
 * direct line, and has since before routing existed.
 *
 * Google is faked throughout. There is no key in this repo and there must
 * never be one in a test: a real request from CI is a real charge.
 *
 * @return array{0: User, 1: Trip}
 */
function routableTrip(): array
{
    $customer = Customer::factory()->create();
    $driverUser = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);
    $driver = Driver::factory()->create(['user_id' => $driverUser->id]);

    $trip = Trip::factory()
        ->forCustomer($customer)
        ->forVehicle(Vehicle::factory()->create(['category' => 'sedan', 'status' => 'active']))
        ->forDriver($driver)
        ->create([
            'origin' => 'Acacia Mall',
            'destination' => 'Kololo Airstrip',
            'status' => TripStatus::TRIP_STARTED,
        ]);

    OrderRequest::factory()->create([
        'customer_id' => $customer->id,
        'trip_id' => $trip->id,
        'scheduled_for' => null,
        'pickup_latitude' => 0.3346,
        'pickup_longitude' => 32.5906,
        'dropoff_latitude' => 0.3268,
        'dropoff_longitude' => 32.6011,
    ]);

    return [$driverUser, $trip];
}

function enableRouting(): void
{
    app(SettingsService::class)->setGroup('maps', [
        'routing_enabled' => true,
        'routing_provider' => 'google',
        'osrm_base_url' => 'https://osrm.test',
        'api_key' => 'test-key',
    ]);
}

function enableOsrm(): void
{
    app(SettingsService::class)->setGroup('maps', [
        'routing_enabled' => true,
        'routing_provider' => 'osrm',
        'osrm_base_url' => 'https://osrm.test',
    ]);
}

/**
 * One Google answer, shaped the way Directions really shapes it.
 *
 * @return array<string, mixed>
 */
function directionsBody(int $metres = 4200, ?int $seconds = 780): array
{
    $leg = ['distance' => ['value' => $metres]];

    if ($seconds !== null) {
        $leg['duration_in_traffic'] = ['value' => $seconds];
    }

    return [
        'status' => 'OK',
        'routes' => [[
            'overview_polyline' => ['points' => 'a~l~Fjk~uOwHJy@P'],
            'legs' => [$leg],
        ]],
    ];
}

it('draws the road between the driver and the drop-off', function () {
    [$driverUser, $trip] = routableTrip();
    enableRouting();

    Http::fake(['maps.googleapis.com/*' => Http::response(directionsBody())]);

    $this->actingAs($driverUser, 'sanctum')
        ->getJson("/api/v1/trips/{$trip->id}/route?from_latitude=0.35&from_longitude=32.59")
        ->assertOk()
        ->assertJsonPath('data.route.polyline', 'a~l~Fjk~uOwHJy@P')
        ->assertJsonPath('data.route.distance_km', 4.2)
        ->assertJsonPath('data.route.duration_seconds', 780)
        ->assertJsonPath('data.route.provider', 'google')
        // The flag travels with the number, so a client cannot forget the
        // rule that it is a forecast (ADR-0031 §6).
        ->assertJsonPath('data.route.is_estimate', true);
});

it('answers null and 200 when no key is configured', function () {
    // The state this repo actually ships in, and the common case in the field.
    [$driverUser, $trip] = routableTrip();

    Http::fake();

    $this->actingAs($driverUser, 'sanctum')
        ->getJson("/api/v1/trips/{$trip->id}/route")
        ->assertOk()
        ->assertJsonPath('data.route', null);

    // And it never asked, so it never billed.
    Http::assertNothingSent();
});

it('answers null and never calls out when the switch is off', function () {
    [$driverUser, $trip] = routableTrip();

    app(SettingsService::class)->setGroup('maps', [
        'routing_enabled' => false,
        'routing_provider' => 'google',
        'api_key' => 'test-key',
    ]);

    Http::fake();

    $this->actingAs($driverUser, 'sanctum')
        ->getJson("/api/v1/trips/{$trip->id}/route")
        ->assertOk()
        ->assertJsonPath('data.route', null);

    // The switch is a spend control, so "off" has to mean no request rather
    // than a request whose answer is thrown away.
    Http::assertNothingSent();
});

it('treats a quota rejection as no route, not as an error', function () {
    // Google answers 200 with the refusal in the body. Reading the HTTP code
    // as the answer is how an exhausted bill becomes a blank map nobody can
    // explain.
    [$driverUser, $trip] = routableTrip();
    enableRouting();

    Http::fake([
        'maps.googleapis.com/*' => Http::response(['status' => 'OVER_QUERY_LIMIT', 'routes' => []]),
    ]);

    $this->actingAs($driverUser, 'sanctum')
        ->getJson("/api/v1/trips/{$trip->id}/route")
        ->assertOk()
        ->assertJsonPath('data.route', null);
});

it('says out loud when Google declines, because the bill is what declines it', function () {
    // Written after a mutation survived. Deleting the body-status check still
    // passed every assertion, because an OVER_QUERY_LIMIT body carries no
    // routes and the later guard caught it anyway — so the check's real value
    // is not the null, it is the *log line*. An operator paying per request
    // deserves to find out that none of them are succeeding, rather than
    // hearing from a driver that the map has gone blank.
    [$driverUser, $trip] = routableTrip();
    enableRouting();

    Log::shouldReceive('warning')
        ->once()
        ->withArgs(fn (string $message, array $context) => $message === 'Directions declined'
            && ($context['status'] ?? null) === 'OVER_QUERY_LIMIT');

    Http::fake([
        'maps.googleapis.com/*' => Http::response(['status' => 'OVER_QUERY_LIMIT', 'routes' => []]),
    ]);

    $this->actingAs($driverUser, 'sanctum')
        ->getJson("/api/v1/trips/{$trip->id}/route")
        ->assertOk()
        ->assertJsonPath('data.route', null);
});

it('shows no minutes rather than inventing them when the provider sent none', function () {
    // ADR-0031 §6, and the half of ADR-0020 §3 that is not lifted: nothing
    // derives a duration locally, whatever distance it is holding.
    [$driverUser, $trip] = routableTrip();
    enableRouting();

    Http::fake([
        'maps.googleapis.com/*' => Http::response(directionsBody(seconds: null)),
    ]);

    $this->actingAs($driverUser, 'sanctum')
        ->getJson("/api/v1/trips/{$trip->id}/route")
        ->assertOk()
        ->assertJsonPath('data.route.distance_km', 4.2)
        ->assertJsonPath('data.route.duration_seconds', null);
});

it('answers null for a trip taken over the phone, which has no pins', function () {
    $driverUser = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);
    $driver = Driver::factory()->create(['user_id' => $driverUser->id]);
    $trip = Trip::factory()
        ->forVehicle(Vehicle::factory()->create(['category' => 'sedan', 'status' => 'active']))
        ->forDriver($driver)
        ->create(['status' => TripStatus::TRIP_STARTED]);

    enableRouting();
    Http::fake();

    $this->actingAs($driverUser, 'sanctum')
        ->getJson("/api/v1/trips/{$trip->id}/route")
        ->assertOk()
        ->assertJsonPath('data.route', null);

    Http::assertNothingSent();
});

it('bills once for a driver who has barely moved', function () {
    // The cache is the cost control (ADR-0031 §4). Three asks from within a
    // hundred metres are one question, and a driver in traffic asks it over
    // and over.
    [$driverUser, $trip] = routableTrip();
    enableRouting();

    Http::fake(['maps.googleapis.com/*' => Http::response(directionsBody())]);

    foreach ([[0.3500, 32.5900], [0.35002, 32.59004], [0.35001, 32.59002]] as [$lat, $lng]) {
        $this->actingAs($driverUser, 'sanctum')
            ->getJson("/api/v1/trips/{$trip->id}/route?from_latitude={$lat}&from_longitude={$lng}")
            ->assertOk()
            ->assertJsonPath('data.route.distance_km', 4.2);
    }

    Http::assertSentCount(1);
});

it('asks again once the driver has genuinely moved', function () {
    [$driverUser, $trip] = routableTrip();
    enableRouting();

    Http::fake(['maps.googleapis.com/*' => Http::response(directionsBody())]);

    foreach ([[0.3500, 32.5900], [0.3600, 32.6000]] as [$lat, $lng]) {
        $this->actingAs($driverUser, 'sanctum')
            ->getJson("/api/v1/trips/{$trip->id}/route?from_latitude={$lat}&from_longitude={$lng}")
            ->assertOk();
    }

    Http::assertSentCount(2);
});

it('does not re-ask Google every heartbeat for a refusal', function () {
    // A miss is cached too. Without it, a pair of coordinates with no road
    // between them is billed on every poll for as long as the trip runs.
    [$driverUser, $trip] = routableTrip();
    enableRouting();

    Http::fake(['maps.googleapis.com/*' => Http::response(['status' => 'ZERO_RESULTS', 'routes' => []])]);

    foreach ([1, 2, 3] as $ignored) {
        $this->actingAs($driverUser, 'sanctum')
            ->getJson("/api/v1/trips/{$trip->id}/route?from_latitude=0.35&from_longitude=32.59")
            ->assertOk()
            ->assertJsonPath('data.route', null);
    }

    Http::assertSentCount(1);
});

it('is refused to a driver the trip does not belong to', function () {
    [, $trip] = routableTrip();
    $stranger = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);
    Driver::factory()->create(['user_id' => $stranger->id]);

    enableRouting();
    Http::fake();

    $this->actingAs($stranger, 'sanctum')
        ->getJson("/api/v1/trips/{$trip->id}/route")
        ->assertForbidden();

    Http::assertNothingSent();
});

// ── OSRM: the keyless engine, and the default ────────────────────────────

it('routes with no key at all on the free engine', function () {
    // The point of having it. A straight dashed line is honest and, in a
    // driver's words, not helping — and waiting for a billing account before
    // any route can be drawn is not a good answer to that.
    [$driverUser, $trip] = routableTrip();
    enableOsrm();

    Http::fake(['osrm.test/*' => Http::response([
        'code' => 'Ok',
        'routes' => [['geometry' => 'uclAcerfERE`@KD', 'distance' => 19832.7, 'duration' => 1071.7]],
    ])]);

    $this->actingAs($driverUser, 'sanctum')
        ->getJson("/api/v1/trips/{$trip->id}/route?from_latitude=0.3949&from_longitude=32.7022")
        ->assertOk()
        ->assertJsonPath('data.route.polyline', 'uclAcerfERE`@KD')
        ->assertJsonPath('data.route.distance_km', 19.83)
        ->assertJsonPath('data.route.duration_seconds', 1072)
        ->assertJsonPath('data.route.provider', 'osrm');
});

it('sends OSRM longitude first, which is the opposite of everything else here', function () {
    // Uganda sits near the equator, so a swapped pair passes every range check
    // either number could face and routes into the Indian Ocean. Asserted
    // against the URL because nothing else would catch it.
    [$driverUser, $trip] = routableTrip();
    enableOsrm();

    Http::fake(['osrm.test/*' => Http::response(['code' => 'NoRoute', 'routes' => []])]);

    $this->actingAs($driverUser, 'sanctum')
        ->getJson("/api/v1/trips/{$trip->id}/route?from_latitude=0.3949&from_longitude=32.7022")
        ->assertOk();

    Http::assertSent(fn ($request) => str_contains($request->url(), '32.7022,0.3949;32.6011,0.3268'));
});

it('treats an OSRM refusal as no route, exactly as it treats a Google one', function () {
    [$driverUser, $trip] = routableTrip();
    enableOsrm();

    Http::fake(['osrm.test/*' => Http::response(['code' => 'NoRoute', 'routes' => []])]);

    $this->actingAs($driverUser, 'sanctum')
        ->getJson("/api/v1/trips/{$trip->id}/route")
        ->assertOk()
        ->assertJsonPath('data.route', null);
});

it('asks for no key on the free engine, so routing is never on but dead', function () {
    // `routingConfigured()` is provider-aware for this reason: demanding a
    // credential OSRM does not want would leave the switch on and every route
    // null, which is indistinguishable from the bug it was meant to fix.
    [$driverUser, $trip] = routableTrip();

    app(SettingsService::class)->setGroup('maps', [
        'routing_enabled' => true,
        'routing_provider' => 'osrm',
        'osrm_base_url' => 'https://osrm.test',
    ]);

    Http::fake(['osrm.test/*' => Http::response([
        'code' => 'Ok',
        'routes' => [['geometry' => 'abc', 'distance' => 1000, 'duration' => 120]],
    ])]);

    $this->actingAs($driverUser, 'sanctum')
        ->getJson("/api/v1/trips/{$trip->id}/route")
        ->assertOk()
        ->assertJsonPath('data.route.provider', 'osrm');
});

it('draws the approach to the pickup when asked for that leg', function () {
    // The first of ADR-0031's three surfaces. The endpoint only ever routed
    // to the drop-off, so the pickup screen kept a dashed guess while the
    // trip screen got a road; the owner, from a handset: "we all know that
    // the trip can not be a straight line".
    [$driverUser, $trip] = routableTrip();
    enableRouting();

    Http::fake(['maps.googleapis.com/*' => Http::response(directionsBody())]);

    $this->actingAs($driverUser, 'sanctum')
        ->getJson("/api/v1/trips/{$trip->id}/route?to=pickup&from_latitude=0.35&from_longitude=32.59")
        ->assertOk()
        ->assertJsonPath('data.route.polyline', 'a~l~Fjk~uOwHJy@P');

    // Routed to the *pickup* (0.3346, 32.5906), not the drop-off.
    Http::assertSent(fn ($request) => str_contains($request->url(), 'destination=0.3346%2C32.5906')
        || str_contains($request->url(), 'destination=0.3346,32.5906'));
});

it('answers null for the approach when the handset has no fix, rather than a dot', function () {
    // "From the pickup to the pickup" is a zero-length line. Without an
    // origin there is nothing honest to draw, and nothing is asked of Google.
    [$driverUser, $trip] = routableTrip();
    enableRouting();

    Http::fake(['maps.googleapis.com/*' => Http::response(directionsBody())]);

    $this->actingAs($driverUser, 'sanctum')
        ->getJson("/api/v1/trips/{$trip->id}/route?to=pickup")
        ->assertOk()
        ->assertJsonPath('data.route', null);

    Http::assertNothingSent();
});

it('refuses an end it does not know', function () {
    [$driverUser, $trip] = routableTrip();
    enableRouting();

    $this->actingAs($driverUser, 'sanctum')
        ->getJson("/api/v1/trips/{$trip->id}/route?to=moon")
        ->assertStatus(422);
});
