<?php

use App\Enums\UserRole;
use App\Models\AuditLog;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Modules\Bookings\Enums\BookingStatus;
use Modules\Bookings\Models\Booking;
use Modules\Drivers\Models\Driver;
use Modules\Trips\Models\Trip;
use Modules\Trips\Models\TripEvent;
use Modules\Vehicles\Models\Vehicle;

/**
 * ADR-0006 Decision 4 — **a mutation by platform staff binds the tenant of
 * the record being acted on, not the actor's** — and the scoped override
 * that makes it safe.
 *
 * This is the sharp edge of the decision and the reason it is an ADR rather
 * than a patch. Shanitah's dispatcher has no tenant, so
 * `BelongsToTenant::creating` would auto-fill `tenant_id` null on every row
 * they produce: a trip belonging to nobody, invisible to the client whose
 * journey it is, or a hard foreign-key failure. The actor is
 * platform-level; the work is always some client's.
 */
function platformDispatchFixture(): array
{
    $tenant = Tenant::factory()->create();

    app(TenantContext::class)->set($tenant->id);

    $requester = User::factory()->create([
        'tenant_id' => $tenant->id,
        'role' => UserRole::CORPORATE_EMPLOYEE,
    ]);

    $admin = User::factory()->create([
        'tenant_id' => $tenant->id,
        'role' => UserRole::CORPORATE_ADMIN,
    ]);

    $booking = Booking::factory()->forTenant($tenant)->create([
        'requested_by_user_id' => $requester->id,
    ]);

    $vehicle = Vehicle::factory()->create(['category' => 'sedan']);
    $driver = Driver::factory()->create();

    $dispatcher = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DISPATCHER]);

    // As a real platform login arrives: nothing bound.
    app(TenantContext::class)->set(null);

    return compact('tenant', 'requester', 'admin', 'booking', 'vehicle', 'driver', 'dispatcher');
}

// ── TenantContext::for() ─────────────────────────────────────────────────

it('restores the previous tenant after a scoped override returns', function () {
    $context = app(TenantContext::class);
    $context->set(7);

    $seen = $context->for(42, fn () => $context->get());

    expect($seen)->toBe(42);
    expect($context->get())->toBe(7);
});

it('restores the previous tenant even when the scoped override throws', function () {
    $context = app(TenantContext::class);
    $context->set(7);

    // The case the `finally` exists for. TenantContext is a singleton for
    // the whole request, so a dispatch that threw halfway would otherwise
    // leave every later query in that request bound to a client the actor
    // is not acting on — reading, or writing, somebody else's rows.
    expect(fn () => $context->for(42, function () {
        throw new RuntimeException('dispatch failed');
    }))->toThrow(RuntimeException::class);

    expect($context->get())->toBe(7);
});

it('restores a null tenant, not just a set one', function () {
    $context = app(TenantContext::class);
    $context->set(null);

    $context->for(42, fn () => null);

    // A platform actor's own state is null, and "restore" has to mean
    // restore rather than clear-to-something. If this left 42 bound, the
    // next request handled by the same worker would start inside a client.
    expect($context->get())->toBeNull();
    expect($context->check())->toBeFalse();
});

// ── Writes land in the subject's tenant ──────────────────────────────────

it('writes a platform dispatcher\'s trip into the client\'s tenant, not a null one', function () {
    ['booking' => $booking, 'vehicle' => $vehicle, 'driver' => $driver,
        'dispatcher' => $dispatcher, 'tenant' => $tenant] = platformDispatchFixture();

    $response = $this->actingAs($dispatcher, 'sanctum')
        ->postJson("/api/v1/bookings/{$booking->id}/assignment", [
            'vehicle_id' => $vehicle->id,
            'driver_id' => $driver->id,
        ])
        ->assertStatus(201);

    $trip = Trip::allTenants()->findOrFail($response->json('data.id'));

    expect($trip->tenant_id)->toBe($tenant->id);
});

it('writes the trip_events timeline into the client\'s tenant too', function () {
    ['booking' => $booking, 'vehicle' => $vehicle, 'driver' => $driver,
        'dispatcher' => $dispatcher, 'tenant' => $tenant] = platformDispatchFixture();

    $response = $this->actingAs($dispatcher, 'sanctum')
        ->postJson("/api/v1/bookings/{$booking->id}/assignment", [
            'vehicle_id' => $vehicle->id,
            'driver_id' => $driver->id,
        ])
        ->assertStatus(201);

    $events = TripEvent::allTenants()->where('trip_id', $response->json('data.id'))->get();

    // Waiting-time billing is computed from these rows, so a timeline
    // filed under the wrong tenant is a billing bug as well as a
    // visibility one.
    expect($events)->not->toBeEmpty();
    expect($events->pluck('tenant_id')->unique()->all())->toBe([$tenant->id]);
});

it('moves the booking itself without stranding it', function () {
    ['booking' => $booking, 'vehicle' => $vehicle, 'driver' => $driver,
        'dispatcher' => $dispatcher, 'tenant' => $tenant] = platformDispatchFixture();

    $this->actingAs($dispatcher, 'sanctum')
        ->postJson("/api/v1/bookings/{$booking->id}/assignment", [
            'vehicle_id' => $vehicle->id,
            'driver_id' => $driver->id,
        ])
        ->assertStatus(201);

    $reloaded = Booking::allTenants()->findOrFail($booking->id);

    expect($reloaded->status)->toBe(BookingStatus::ASSIGNED);
    expect($reloaded->tenant_id)->toBe($tenant->id);
});

// ── And the client can see that it was us ────────────────────────────────

it('records the platform dispatcher\'s action in the client\'s own audit log', function () {
    ['booking' => $booking, 'vehicle' => $vehicle, 'driver' => $driver,
        'dispatcher' => $dispatcher, 'tenant' => $tenant, 'admin' => $admin] = platformDispatchFixture();

    $response = $this->actingAs($dispatcher, 'sanctum')
        ->postJson("/api/v1/bookings/{$booking->id}/assignment", [
            'vehicle_id' => $vehicle->id,
            'driver_id' => $driver->id,
        ])
        ->assertStatus(201);

    $tripId = $response->json('data.id');

    $row = AuditLog::allTenants()
        ->where('auditable_type', 'trip')
        ->where('auditable_id', $tripId)
        ->where('action', 'created')
        ->firstOrFail();

    expect($row->tenant_id)->toBe($tenant->id);
    expect($row->user_id)->toBe($dispatcher->id);

    // ADR-0006 Decision 5, from the client's side: a client must be able to
    // see who touched their data, **including when it was us**. Read
    // through the tenant-scoped reader the client actually uses, not
    // through allTenants().
    $log = $this->actingAs($admin, 'sanctum')
        ->getJson('/api/v1/audit-logs?auditable_type=trip')
        ->assertOk();

    expect(collect($log->json('data'))->pluck('id')->all())->toContain($row->id);
    expect($log->json('meta.scope'))->toBe('tenant');
});

it('leaves the platform actor unbound once the request is over', function () {
    ['booking' => $booking, 'vehicle' => $vehicle, 'driver' => $driver,
        'dispatcher' => $dispatcher] = platformDispatchFixture();

    $this->actingAs($dispatcher, 'sanctum')
        ->postJson("/api/v1/bookings/{$booking->id}/assignment", [
            'vehicle_id' => $vehicle->id,
            'driver_id' => $driver->id,
        ])
        ->assertStatus(201);

    // The binding is the subject's, for the duration of the work on it —
    // not a promotion the actor keeps.
    expect(app(TenantContext::class)->get())->toBeNull();
});
