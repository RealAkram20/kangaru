<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Modules\Bookings\Models\Booking;
use Modules\Drivers\Models\Driver;
use Modules\Trips\Models\Trip;
use Modules\Vehicles\Models\Vehicle;

/**
 * ADR-0006 delivered one cross-client queue for Shanitah's staff and said,
 * in the same breath, that a queue which does not name its clients is
 * **worse** than no cross-client queue at all. It deferred the labelling to
 * "follow the backend"; this is that follow-up.
 *
 * The failure mode is not a leak, it is a mistake: a dispatcher assigning a
 * vehicle to what they believe is Centenary Bank's airport run when it is
 * another client's. `tenant_id` was always on the resource and is not an
 * answer — nobody reads "3" as a bank.
 */
function twoClientsWithWork(): array
{
    $build = function (string $name) {
        $tenant = Tenant::factory()->create(['name' => $name]);

        app(TenantContext::class)->set($tenant->id);

        $requester = User::factory()->create([
            'tenant_id' => $tenant->id,
            'role' => UserRole::CORPORATE_EMPLOYEE,
        ]);

        $booking = Booking::factory()->forTenant($tenant)->create([
            'requested_by_user_id' => $requester->id,
        ]);

        $trip = Trip::factory()->forTenant($tenant)
            ->forVehicle(Vehicle::factory()->create())
            ->forDriver(Driver::factory()->create())
            ->create();

        return compact('tenant', 'requester', 'booking', 'trip');
    };

    $a = $build('Centenary Bank');
    $b = $build('Acme NGO Ltd');

    $dispatcher = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DISPATCHER]);

    app(TenantContext::class)->set(null);

    return ['a' => $a, 'b' => $b, 'dispatcher' => $dispatcher];
}

it('names the client on every row of a platform dispatcher\'s booking queue', function () {
    ['a' => $a, 'b' => $b, 'dispatcher' => $dispatcher] = twoClientsWithWork();

    $response = $this->actingAs($dispatcher, 'sanctum')->getJson('/api/v1/bookings')->assertOk();

    $byId = collect($response->json('data'))->keyBy('id');

    expect($byId[$a['booking']->id]['client']['name'])->toBe('Centenary Bank');
    expect($byId[$b['booking']->id]['client']['name'])->toBe('Acme NGO Ltd');
});

it('names the client on every row of a platform dispatcher\'s trip list', function () {
    ['a' => $a, 'b' => $b, 'dispatcher' => $dispatcher] = twoClientsWithWork();

    $response = $this->actingAs($dispatcher, 'sanctum')->getJson('/api/v1/trips')->assertOk();

    $byId = collect($response->json('data'))->keyBy('id');

    expect($byId[$a['trip']->id]['client']['name'])->toBe('Centenary Bank');
    expect($byId[$b['trip']->id]['client']['name'])->toBe('Acme NGO Ltd');
});

it('tells the client which kind of queue it is showing', function () {
    ['a' => $a, 'dispatcher' => $dispatcher] = twoClientsWithWork();

    // Served rather than inferred, so the UI holds no copy of ADR-0006's
    // predicate. A frontend deciding for itself whether an account is
    // platform-level would be a fourth place that rule lives.
    $this->actingAs($dispatcher, 'sanctum')->getJson('/api/v1/bookings')
        ->assertJsonPath('meta.scope', 'platform');
    $this->actingAs($dispatcher, 'sanctum')->getJson('/api/v1/trips')
        ->assertJsonPath('meta.scope', 'platform');

    $this->actingAs($a['requester'], 'sanctum')->getJson('/api/v1/bookings')
        ->assertJsonPath('meta.scope', 'tenant');
    $this->actingAs($a['requester'], 'sanctum')->getJson('/api/v1/trips')
        ->assertJsonPath('meta.scope', 'tenant');
});

it('omits the client key entirely for a client\'s own listing', function () {
    ['a' => $a] = twoClientsWithWork();

    $response = $this->actingAs($a['requester'], 'sanctum')->getJson('/api/v1/bookings')->assertOk();

    // Absent, not null. `whenLoaded` drops the key, which lets a client
    // tell "not applicable here" from "this row has no client" — and means
    // a tenant listing pays for no join to be told its own name.
    expect($response->json('data.0'))->not->toHaveKey('client');
});

it('reads the clients without an N+1', function () {
    ['dispatcher' => $dispatcher] = twoClientsWithWork();

    // Five more clients, each with a booking, so a per-row lookup would
    // show up as a query count that grows with the queue.
    for ($i = 0; $i < 5; $i++) {
        $tenant = Tenant::factory()->create();
        app(TenantContext::class)->set($tenant->id);
        Booking::factory()->forTenant($tenant)->create();
    }

    app(TenantContext::class)->set(null);

    DB::enableQueryLog();

    $response = $this->actingAs($dispatcher, 'sanctum')->getJson('/api/v1/bookings')->assertOk();

    $queries = count(DB::getQueryLog());
    DB::disableQueryLog();

    expect(collect($response->json('data')))->toHaveCount(7);

    // The bound has to separate two measured numbers rather than be a
    // round figure, or it stops meaning anything the first time a query is
    // added legitimately — which has already happened once, when
    // `meta.filters.clients` took the baseline from 11 to 12.
    //
    //   12 — eager-loaded: one query for the whole page's clients.
    //   17 — the same page with the resource reading the relation lazily,
    //        i.e. seven rows costing seven extra lookups.
    //
    // 14 sits between them with room for another query or two before it
    // needs revisiting, and still fails on an N+1 at this page size. If a
    // future change pushes the baseline past it, re-measure both numbers
    // rather than nudging this one up.
    expect($queries)->toBeLessThan(14);
});
