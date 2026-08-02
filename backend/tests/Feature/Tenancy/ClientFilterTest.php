<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Modules\Bookings\Models\Booking;
use Modules\Drivers\Models\Driver;
use Modules\Trips\Models\Trip;
use Modules\Vehicles\Models\Vehicle;

/**
 * Narrowing a cross-client queue to one client, server-side.
 *
 * The labelling pass gave the queue a client column and a filter box, but
 * that box narrows only the page already fetched — honest at two clients
 * and wrong at fifty, which is PROJECT.md's Phase 1 target. This is the
 * `tenant_id` query parameter that makes it real.
 *
 * **It is also a new escalation surface**, which is why it has its own
 * file. Until now nothing let a caller name a tenant. The tests below are
 * mostly about what happens when the wrong caller names one — a client's
 * own user must not be able to reach another client's rows by asking, and
 * must not be able to learn which clients exist by watching how the
 * refusals differ.
 */
function twoClientsForFiltering(): array
{
    $build = function (string $name) {
        $tenant = Tenant::factory()->create(['name' => $name]);

        app(TenantContext::class)->set($tenant->id);

        $user = User::factory()->create([
            'tenant_id' => $tenant->id,
            'role' => UserRole::CORPORATE_ADMIN,
        ]);

        $booking = Booking::factory()->forTenant($tenant)->create();

        $trip = Trip::factory()->forTenant($tenant)
            ->forVehicle(Vehicle::factory()->create())
            ->forDriver(Driver::factory()->create())
            ->create();

        return compact('tenant', 'user', 'booking', 'trip');
    };

    $a = $build('Centenary Bank');
    $b = $build('Acme NGO Ltd');

    $dispatcher = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DISPATCHER]);

    app(TenantContext::class)->set(null);

    return ['a' => $a, 'b' => $b, 'dispatcher' => $dispatcher];
}

// ── What it does for the reader it exists for ────────────────────────────

it('narrows a platform dispatcher\'s booking queue to one client', function () {
    ['a' => $a, 'b' => $b, 'dispatcher' => $dispatcher] = twoClientsForFiltering();

    $response = $this->actingAs($dispatcher, 'sanctum')
        ->getJson("/api/v1/bookings?tenant_id={$a['tenant']->id}")
        ->assertOk();

    $ids = collect($response->json('data'))->pluck('id')->all();

    expect($ids)->toContain($a['booking']->id);
    expect($ids)->not->toContain($b['booking']->id);
});

it('narrows a platform dispatcher\'s trip list to one client', function () {
    ['a' => $a, 'b' => $b, 'dispatcher' => $dispatcher] = twoClientsForFiltering();

    $response = $this->actingAs($dispatcher, 'sanctum')
        ->getJson("/api/v1/trips?tenant_id={$b['tenant']->id}")
        ->assertOk();

    $ids = collect($response->json('data'))->pluck('id')->all();

    expect($ids)->toContain($b['trip']->id);
    expect($ids)->not->toContain($a['trip']->id);
});

it('serves the clients a platform reader may pick, so the picker holds no list', function () {
    ['dispatcher' => $dispatcher] = twoClientsForFiltering();

    $response = $this->actingAs($dispatcher, 'sanctum')->getJson('/api/v1/bookings')->assertOk();

    $labels = collect($response->json('meta.filters.clients'))->pluck('label')->all();

    // Every client, not merely the ones on this page: a picker that could
    // not offer the client whose row is further down is useless for the
    // reason anybody opens it.
    expect($labels)->toContain('Centenary Bank');
    expect($labels)->toContain('Acme NGO Ltd');
});

// ── What it does for everybody else ──────────────────────────────────────

it('refuses the filter from a client\'s own user, naming another tenant', function () {
    ['a' => $a, 'b' => $b] = twoClientsForFiltering();

    // The attempt this parameter makes possible for the first time.
    $this->actingAs($a['user'], 'sanctum')
        ->getJson("/api/v1/bookings?tenant_id={$b['tenant']->id}")
        ->assertStatus(422)
        ->assertJsonValidationErrors('tenant_id');
});

it('refuses it identically when the tenant named does not exist', function () {
    ['a' => $a] = twoClientsForFiltering();

    $real = $this->actingAs($a['user'], 'sanctum')
        ->getJson('/api/v1/bookings?tenant_id='.($a['tenant']->id + 1));

    $imaginary = $this->actingAs($a['user'], 'sanctum')
        ->getJson('/api/v1/bookings?tenant_id=99999');

    // Byte-identical, on purpose. A refusal that differed between "that
    // client exists but is not yours" and "no such client" would let any
    // corporate employee enumerate the platform's client list one id at a
    // time — a customer list is commercially sensitive even when none of
    // its data leaks.
    expect($real->status())->toBe(422);
    expect($imaginary->status())->toBe(422);
    expect($real->json())->toEqual($imaginary->json());
});

it('refuses it even when a client\'s user names their own tenant', function () {
    ['a' => $a] = twoClientsForFiltering();

    // Consistent rather than convenient: for this account there was never
    // a choice of client to make, so the filter genuinely does not exist.
    // Accepting it here would mean the parameter is sometimes honoured and
    // sometimes refused depending on its *value*, which is the shape that
    // makes an oracle.
    $this->actingAs($a['user'], 'sanctum')
        ->getJson("/api/v1/bookings?tenant_id={$a['tenant']->id}")
        ->assertStatus(422);
});

it('offers a client\'s own user no clients to pick from', function () {
    ['a' => $a] = twoClientsForFiltering();

    $response = $this->actingAs($a['user'], 'sanctum')->getJson('/api/v1/bookings')->assertOk();

    // Not the reader's own name, and certainly not anybody else's.
    expect($response->json('meta.filters.clients'))->toBe([]);
});

it('still refuses an unrecognised filter from platform staff', function () {
    ['dispatcher' => $dispatcher] = twoClientsForFiltering();

    // Widening the whitelist for one reader must not widen it generally.
    $this->actingAs($dispatcher, 'sanctum')
        ->getJson('/api/v1/bookings?nonsense=1')
        ->assertStatus(422)
        ->assertJsonValidationErrors('nonsense');
});
