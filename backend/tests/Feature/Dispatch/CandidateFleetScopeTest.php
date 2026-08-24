<?php

use App\Enums\AccessLevel;
use App\Enums\UserRole;
use App\Models\Operator;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Modules\Bookings\Models\Booking;
use Modules\Drivers\Models\Driver;
use Modules\Vehicles\Models\Vehicle;

/**
 * The dispatch board offers this fleet's own vehicles and drivers, and no
 * others (ADR-0055 §6).
 *
 * **Asserted through the routes, not against the scope.**
 * `CrossFleetIsolationTest` already proves `forActor` four ways by calling it
 * directly, and its docblock claims to cover *"the opt-in scope every listing
 * goes through"*. Neither candidate service went through it: both built their
 * pool with a bare `Model::query()`, and `BelongsToOperator` carries no global
 * scope, so every active vehicle and driver on the platform was offered.
 *
 * That is the same failure `VehicleService::list` records having already
 * shipped once — *"A correct scope nothing calls is not a defence; it is a
 * defence that has never been deployed."* So these go through the HTTP layer,
 * where a future refactor that drops the scope has somewhere to go red.
 *
 * The visible symptom was a dead button: `/vehicles` is scoped correctly, so
 * the board could not resolve the foreign vehicle it had just offered, and
 * Assign never enabled. A leak that presented as a broken control.
 */

/**
 * @return array{dispatcher: User, mine: array{vehicle: Vehicle, driver: Driver}, theirs: array{vehicle: Vehicle, driver: Driver}, booking: Booking}
 */
function twoFleetsOnOneBoard(): array
{
    $rival = Operator::create([
        'name' => 'Rival Fleet Ltd',
        'slug' => 'rival-fleet',
        'status' => 'active',
    ]);

    $tenant = Tenant::factory()->create();
    app(TenantContext::class)->set($tenant->id);

    $dispatcher = User::factory()->create([
        'tenant_id' => null,
        'operator_id' => Operator::SHANITAH,
        'access_level' => AccessLevel::FLEET,
        'role' => UserRole::DISPATCHER,
    ]);

    $mine = [
        'vehicle' => Vehicle::factory()->create([
            'operator_id' => Operator::SHANITAH,
            'registration_number' => 'UAA 111A',
        ]),
        'driver' => Driver::factory()->create([
            'operator_id' => Operator::SHANITAH,
            'name' => 'Our Own Driver',
        ]),
    ];

    $theirs = [
        'vehicle' => Vehicle::factory()->create([
            'operator_id' => $rival->id,
            'registration_number' => 'ZZZ 999Z',
        ]),
        'driver' => Driver::factory()->create([
            'operator_id' => $rival->id,
            'name' => 'Their Own Driver',
        ]),
    ];

    $booking = Booking::factory()->forTenant($tenant)->create();

    return compact('dispatcher', 'mine', 'theirs', 'booking');
}

it('offers a dispatcher their own fleet\'s vehicles and never a rival\'s', function () {
    ['dispatcher' => $dispatcher, 'mine' => $mine, 'theirs' => $theirs, 'booking' => $booking] = twoFleetsOnOneBoard();

    $registrations = collect(
        $this->actingAs($dispatcher, 'sanctum')
            ->getJson("/api/v1/bookings/{$booking->id}/candidate-vehicles")
            ->assertOk()
            ->json('data'),
    )->pluck('registration_number');

    expect($registrations)->toContain('UAA 111A')->not->toContain('ZZZ 999Z');

    // The registration is the leak that matters: it is the whole register of
    // a competitor's fleet, one booking at a time.
    expect($registrations)->not->toContain($theirs['vehicle']->registration_number);
    expect($mine['vehicle']->operator_id)->toBe(Operator::SHANITAH);
});

it('offers a dispatcher their own fleet\'s drivers and never a rival\'s', function () {
    ['dispatcher' => $dispatcher, 'booking' => $booking] = twoFleetsOnOneBoard();

    $names = collect(
        $this->actingAs($dispatcher, 'sanctum')
            ->getJson("/api/v1/bookings/{$booking->id}/candidate-drivers")
            ->assertOk()
            ->json('data'),
    )->pluck('name');

    expect($names)->toContain('Our Own Driver')->not->toContain('Their Own Driver');
});

it('never recommends a rival fleet\'s vehicle or driver', function () {
    ['dispatcher' => $dispatcher, 'booking' => $booking] = twoFleetsOnOneBoard();

    // The one that assigns rather than displays: `bestFor` hands its winner
    // straight to `assign()`, so an unscoped pool here commits a competitor's
    // van to this fleet's booking.
    $suggestions = collect(
        $this->actingAs($dispatcher, 'sanctum')
            ->getJson("/api/v1/bookings/{$booking->id}/recommendation")
            ->assertOk()
            ->json('data'),
    );

    expect($suggestions->pluck('vehicle.registration_number'))->not->toContain('ZZZ 999Z');
    expect($suggestions->pluck('driver.name'))->not->toContain('Their Own Driver');
});
