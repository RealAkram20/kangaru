<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Database\SearchTerm;
use App\Support\Tenancy\TenantContext;
use Modules\Bookings\Models\Booking;
use Modules\Drivers\Models\Driver;
use Modules\Trips\Models\Trip;
use Modules\Vehicles\Models\Vehicle;

/**
 * The search box, server-side.
 *
 * It used to sift the page already fetched, which meant a dispatcher
 * searching a queue of 200 was searching 25 of them and being told,
 * silently, that the rest did not match. Paging and the client picker moved
 * to the server first; this closes the gap where two controls sat side by
 * side behaving differently with nothing on screen to explain it.
 *
 * Two of the cases below are about `LIKE` rather than about search: a term
 * carrying `%` or `_` must mean those characters, and an OR group must not
 * escape the AND around it. Both produce *more* rows than they should,
 * which is the failure mode nobody notices.
 */
function seedSearchableWork(): array
{
    $bank = Tenant::factory()->create(['name' => 'Centenary Bank']);
    $ngo = Tenant::factory()->create(['name' => 'Acme NGO Ltd']);

    app(TenantContext::class)->set($bank->id);

    $admin = User::factory()->create(['tenant_id' => $bank->id, 'role' => UserRole::CORPORATE_ADMIN]);

    $airport = Booking::factory()->forTenant($bank)->create([
        'origin' => 'Head Office',
        'destination' => 'Entebbe Airport',
        'passenger_name' => 'Sarah O_Brien',
    ]);

    $jinja = Booking::factory()->forTenant($bank)->create([
        'origin' => 'Nakawa Branch',
        'destination' => 'Jinja',
        'passenger_name' => 'Moses Kato',
    ]);

    $vehicle = Vehicle::factory()->create(['registration_number' => 'UBK 442Z']);
    $driver = Driver::factory()->create(['name' => 'Ada Nakato']);

    $trip = Trip::factory()->forTenant($bank)->forVehicle($vehicle)->forDriver($driver)
        ->create(['origin' => 'Head Office', 'destination' => 'Entebbe Airport']);

    app(TenantContext::class)->set($ngo->id);

    $ngoBooking = Booking::factory()->forTenant($ngo)->create([
        'origin' => 'Ntinda',
        'destination' => 'Mukono',
        'passenger_name' => 'Grace Amongin',
    ]);

    $dispatcher = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DISPATCHER]);

    app(TenantContext::class)->set(null);

    return compact('bank', 'ngo', 'admin', 'dispatcher', 'airport', 'jinja', 'trip', 'ngoBooking', 'vehicle', 'driver');
}

/** @return array<int, int> */
function bookingIds(string $url, User $actor): array
{
    return collect(test()->actingAs($actor, 'sanctum')->getJson($url)->assertOk()->json('data'))
        ->pluck('id')->all();
}

it('searches bookings by route and passenger across the whole queue', function () {
    ['admin' => $admin, 'airport' => $airport, 'jinja' => $jinja] = seedSearchableWork();

    expect(bookingIds('/api/v1/bookings?q=Entebbe', $admin))->toBe([$airport->id]);
    expect(bookingIds('/api/v1/bookings?q=Moses', $admin))->toBe([$jinja->id]);
});

it('searches a status the way it is displayed, not the way it is stored', function () {
    ['admin' => $admin, 'airport' => $airport, 'jinja' => $jinja] = seedSearchableWork();

    // Statuses are `pending` here; the interesting case is the multi-word
    // ones. Somebody reading "Trip completed" off the screen types the
    // space, and the column holds an underscore — the one search term a
    // user is certain about must not be the one that fails.
    expect(SearchTerm::containsStatus('trip completed'))->toBe('%trip\_completed%');

    $found = bookingIds('/api/v1/bookings?q=pending', $admin);

    expect($found)->toContain($airport->id);
    expect($found)->toContain($jinja->id);
});

it('treats wildcards in the term as characters, not as wildcards', function () {
    ['admin' => $admin, 'airport' => $airport] = seedSearchableWork();

    // `_` is "any single character" to LIKE. Unescaped, `O_Brien` would
    // also match `O'Brien`, `OxBrien` and anything else of that shape — a
    // wrong answer that looks exactly like a right one.
    expect(bookingIds('/api/v1/bookings?q=O_Brien', $admin))->toBe([$airport->id]);

    // And a term that is nothing but wildcards matches nothing rather than
    // everything, which is the version of this bug that hides.
    expect(bookingIds('/api/v1/bookings?q=%25', $admin))->toBe([]);
});

it('keeps the search ANDed with the other filters rather than ORing past them', function () {
    ['admin' => $admin, 'airport' => $airport] = seedSearchableWork();

    // The trap: `where(a)->orWhere(b)` chained onto an outer query escapes
    // the AND and returns everything matching b regardless of a. Here the
    // status filter excludes both bookings, so a leaking OR group would
    // hand back the one the term matches anyway.
    expect(bookingIds('/api/v1/bookings?q=Entebbe&status=cancelled', $admin))->toBe([]);

    expect(bookingIds('/api/v1/bookings?q=Entebbe&status=pending', $admin))->toBe([$airport->id]);
});

it('searches trips by vehicle registration and driver name', function () {
    ['admin' => $admin, 'trip' => $trip] = seedSearchableWork();

    $ids = fn (string $url) => collect(
        test()->actingAs($admin, 'sanctum')->getJson($url)->assertOk()->json('data')
    )->pluck('id')->all();

    // A dispatcher reaches for a number plate far more often than a route.
    expect($ids('/api/v1/trips?q=UBK 442Z'))->toBe([$trip->id]);
    expect($ids('/api/v1/trips?q=Ada'))->toBe([$trip->id]);
    expect($ids('/api/v1/trips?q=nothing-matches-this'))->toBe([]);
});

it('lets a platform dispatcher search by client name, and a client not', function () {
    ['dispatcher' => $dispatcher, 'admin' => $admin, 'ngoBooking' => $ngoBooking] = seedSearchableWork();

    // The cross-client queue's most useful search term.
    expect(bookingIds('/api/v1/bookings?q=Acme', $dispatcher))->toBe([$ngoBooking->id]);

    // For a client's own user the client name is not a searchable column —
    // there is one client and it is theirs. Searching their own name finds
    // nothing rather than everything, which is the safe direction: the
    // alternative would be a term that silently matches every row.
    expect(bookingIds('/api/v1/bookings?q=Centenary', $admin))->toBe([]);
});

it('still refuses an unknown filter alongside a search', function () {
    ['admin' => $admin] = seedSearchableWork();

    test()->actingAs($admin, 'sanctum')
        ->getJson('/api/v1/bookings?q=Entebbe&nonsense=1')
        ->assertStatus(422)
        ->assertJsonValidationErrors('nonsense');
});

it('caps how long a search term may be', function () {
    ['admin' => $admin] = seedSearchableWork();

    test()->actingAs($admin, 'sanctum')
        ->getJson('/api/v1/bookings?q='.str_repeat('a', 121))
        ->assertStatus(422)
        ->assertJsonValidationErrors('q');
});
