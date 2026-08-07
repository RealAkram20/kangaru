<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use Carbon\CarbonImmutable;
use Modules\Bookings\Models\Booking;
use Modules\Drivers\Models\Driver;
use Modules\Fleet\Enums\AvailabilityKind;
use Modules\Fleet\Enums\AvailabilityResource;
use Modules\Fleet\Enums\AvailabilityStatus;
use Modules\Fleet\Models\AvailabilityBlock;
use Modules\Fleet\Models\DriverShiftWindow;
use Modules\Fleet\Services\Availability;
use Modules\Fleet\Services\AvailabilityService;
use Modules\Vehicles\Models\Vehicle;

/**
 * ADR-0017 — who and what is free, and when.
 *
 * The interesting cases are all boundaries: a block that ends exactly when a
 * trip starts, a night shift that wraps past midnight, a request nobody has
 * answered yet. Those are where an availability feature is either correct or
 * quietly refuses every back-to-back booking in the fleet.
 */
function availability(): AvailabilityService
{
    return app(AvailabilityService::class);
}

function fleetAdmin(): User
{
    return User::factory()->create(['tenant_id' => null, 'role' => UserRole::SUPER_ADMIN]);
}

// ── The overlap predicate ────────────────────────────────────────────────

it('does not treat a block ending exactly when the trip starts as a clash', function () {
    $driver = Driver::factory()->create();

    AvailabilityBlock::factory()->forDriver($driver)
        ->between('2026-09-01 08:00:00', '2026-09-01 14:00:00')->create();

    // A driver back from an appointment at two is available at two. Closed
    // intervals here would refuse every back-to-back job in the fleet, which
    // is how the feature gets switched off a week after launch.
    $verdict = availability()->forDriver(
        $driver->id,
        CarbonImmutable::parse('2026-09-01 14:00:00'),
        CarbonImmutable::parse('2026-09-01 16:00:00'),
    );

    expect($verdict->free)->toBeTrue();
});

it('treats a block starting one minute inside the window as a clash', function () {
    $driver = Driver::factory()->create();

    AvailabilityBlock::factory()->forDriver($driver)
        ->between('2026-09-01 15:59:00', '2026-09-01 18:00:00')->create();

    $verdict = availability()->forDriver(
        $driver->id,
        CarbonImmutable::parse('2026-09-01 14:00:00'),
        CarbonImmutable::parse('2026-09-01 16:00:00'),
    );

    expect($verdict->free)->toBeFalse();
    expect($verdict->code)->toBe(Availability::BLOCKED);
});

it('treats an open-ended block as covering everything after it starts', function () {
    $vehicle = Vehicle::factory()->create();

    // "Off the road until further notice" — the honest record when a vehicle
    // fails an inspection and nobody yet knows what the part costs.
    AvailabilityBlock::factory()->forVehicle($vehicle)
        ->create(['starts_at' => '2026-09-01 08:00:00', 'ends_at' => null]);

    expect(availability()->forVehicle(
        $vehicle->id,
        CarbonImmutable::parse('2027-05-01 09:00:00'),
        CarbonImmutable::parse('2027-05-01 11:00:00'),
    )->free)->toBeFalse();
});

// ── Requested vs approved ────────────────────────────────────────────────

it('does not withhold a driver for leave nobody has approved', function () {
    $driver = Driver::factory()->create();

    AvailabilityBlock::factory()->forDriver($driver)->requested()
        ->between('2026-09-01 08:00:00', '2026-09-02 08:00:00')->create();

    // Otherwise anybody could take themselves off the roster by asking, and
    // the fleet would find out at 6am when the van did not move.
    expect(availability()->forDriver(
        $driver->id,
        CarbonImmutable::parse('2026-09-01 09:00:00'),
        CarbonImmutable::parse('2026-09-01 11:00:00'),
    )->free)->toBeTrue();
});

// ── Shift windows ────────────────────────────────────────────────────────

it('leaves a driver with no roster available at any hour', function () {
    $driver = Driver::factory()->create();

    // What keeps ADR-0017 additive: every driver predates the table, and
    // dispatch must behave for them exactly as it did before it existed.
    expect(availability()->forDriver(
        $driver->id,
        CarbonImmutable::parse('2026-09-01 03:00:00'),
        CarbonImmutable::parse('2026-09-01 05:00:00'),
    )->free)->toBeTrue();
});

it('refuses a rostered driver outside their hours', function () {
    $driver = Driver::factory()->create();
    // 2026-09-01 is a Tuesday (dayOfWeek 2).
    DriverShiftWindow::create([
        'driver_id' => $driver->id, 'weekday' => 2,
        'starts_at' => '06:00:00', 'ends_at' => '18:00:00',
    ]);

    $verdict = availability()->forDriver(
        $driver->id,
        CarbonImmutable::parse('2026-09-01 19:00:00', 'Africa/Kampala'),
        CarbonImmutable::parse('2026-09-01 21:00:00', 'Africa/Kampala'),
    );

    expect($verdict->free)->toBeFalse();
    expect($verdict->code)->toBe(Availability::OFF_SHIFT);
});

it('refuses a job that starts on shift and finishes after it', function () {
    $driver = Driver::factory()->create();
    DriverShiftWindow::create([
        'driver_id' => $driver->id, 'weekday' => 2,
        'starts_at' => '06:00:00', 'ends_at' => '18:00:00',
    ]);

    // Checking only the start would roster a driver onto a job beginning ten
    // minutes before they clock off.
    expect(availability()->forDriver(
        $driver->id,
        CarbonImmutable::parse('2026-09-01 17:50:00', 'Africa/Kampala'),
        CarbonImmutable::parse('2026-09-01 19:50:00', 'Africa/Kampala'),
    )->free)->toBeFalse();
});

it('lets a job end exactly when the shift does', function () {
    $driver = Driver::factory()->create();
    DriverShiftWindow::create([
        'driver_id' => $driver->id, 'weekday' => 2,
        'starts_at' => '06:00:00', 'ends_at' => '18:00:00',
    ]);

    expect(availability()->forDriver(
        $driver->id,
        CarbonImmutable::parse('2026-09-01 16:00:00', 'Africa/Kampala'),
        CarbonImmutable::parse('2026-09-01 18:00:00', 'Africa/Kampala'),
    )->free)->toBeTrue();
});

it('handles a night shift that runs past midnight into the next day', function () {
    $driver = Driver::factory()->create();
    // Tuesday 18:00 → 06:00 Wednesday. A night shift is normal in this
    // business; forbidding the wrap would force two rows that no longer read
    // as one shift.
    DriverShiftWindow::create([
        'driver_id' => $driver->id, 'weekday' => 2,
        'starts_at' => '18:00:00', 'ends_at' => '06:00:00',
    ]);

    // Tuesday night, inside the head of the window.
    expect(availability()->forDriver(
        $driver->id,
        CarbonImmutable::parse('2026-09-01 20:00:00', 'Africa/Kampala'),
        CarbonImmutable::parse('2026-09-01 22:00:00', 'Africa/Kampala'),
    )->free)->toBeTrue();

    // Wednesday's small hours, still the same shift.
    expect(availability()->forDriver(
        $driver->id,
        CarbonImmutable::parse('2026-09-02 01:00:00', 'Africa/Kampala'),
        CarbonImmutable::parse('2026-09-02 03:00:00', 'Africa/Kampala'),
    )->free)->toBeTrue();

    // Wednesday lunchtime is nobody's night shift.
    expect(availability()->forDriver(
        $driver->id,
        CarbonImmutable::parse('2026-09-02 12:00:00', 'Africa/Kampala'),
        CarbonImmutable::parse('2026-09-02 14:00:00', 'Africa/Kampala'),
    )->free)->toBeFalse();
});

// ── Dispatch actually honours it ─────────────────────────────────────────

it('refuses to dispatch a driver on approved leave', function () {
    $tenant = Tenant::factory()->create();
    $booking = Booking::factory()->forTenant($tenant)->create(['scheduled_for' => null]);
    $driver = Driver::factory()->create();
    $vehicle = Vehicle::factory()->create();

    AvailabilityBlock::factory()->forDriver($driver)->create([
        'starts_at' => now()->subHour(),
        'ends_at' => now()->addDay(),
    ]);

    $dispatcher = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DISPATCHER]);

    // The board is a convenience; this is the rule. A dispatcher may post any
    // pair of ids, so the endpoint has to refuse rather than rely on a row
    // having been greyed out on a screen somebody may not have been reading.
    $this->actingAs($dispatcher, 'sanctum')
        ->postJson("/api/v1/bookings/{$booking->id}/assignment", [
            'vehicle_id' => $vehicle->id,
            'driver_id' => $driver->id,
        ])
        ->assertStatus(409)
        ->assertJsonPath('code', 'DRIVER_UNAVAILABLE');
});

it('refuses to dispatch a vehicle that is in the workshop', function () {
    $tenant = Tenant::factory()->create();
    $booking = Booking::factory()->forTenant($tenant)->create(['scheduled_for' => null]);
    $driver = Driver::factory()->create();
    $vehicle = Vehicle::factory()->create();

    AvailabilityBlock::factory()->forVehicle($vehicle)->create([
        'kind' => AvailabilityKind::MAINTENANCE,
        'starts_at' => now()->subHour(),
        'ends_at' => now()->addDay(),
    ]);

    $dispatcher = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DISPATCHER]);

    $this->actingAs($dispatcher, 'sanctum')
        ->postJson("/api/v1/bookings/{$booking->id}/assignment", [
            'vehicle_id' => $vehicle->id,
            'driver_id' => $driver->id,
        ])
        ->assertStatus(409)
        ->assertJsonPath('code', 'VEHICLE_UNAVAILABLE');
});

it('marks a blocked vehicle undispatchable in the candidate list, and agrees with the endpoint', function () {
    $tenant = Tenant::factory()->create();
    $booking = Booking::factory()->forTenant($tenant)->create(['scheduled_for' => null]);
    $free = Vehicle::factory()->create();
    $inWorkshop = Vehicle::factory()->create();

    AvailabilityBlock::factory()->forVehicle($inWorkshop)->create([
        'starts_at' => now()->subHour(),
        'ends_at' => now()->addDay(),
    ]);

    $dispatcher = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DISPATCHER]);

    $rows = collect($this->actingAs($dispatcher, 'sanctum')
        ->getJson("/api/v1/bookings/{$booking->id}/candidate-vehicles")
        ->assertOk()->json('data'))->keyBy('id');

    // The list and the assignment must not disagree — a list that says free
    // and an endpoint that says no is the drift ADR-0017 exists to prevent.
    expect($rows[$inWorkshop->id]['dispatchable'])->toBeFalse();
    expect($rows[$inWorkshop->id]['note'])->toBe('Not available for this time.');
    expect($rows[$free->id]['dispatchable'])->toBeTrue();
});

// ── The request-and-answer flow the Driver's Application will use ────────

it('lets the fleet office approve a request, which then withholds the driver', function () {
    $driver = Driver::factory()->create();
    $block = AvailabilityBlock::factory()->forDriver($driver)->requested()->create([
        'starts_at' => now()->subHour(),
        'ends_at' => now()->addDay(),
    ]);

    expect(availability()->forDriver($driver->id, now(), now()->addHour())->free)->toBeTrue();

    $this->actingAs(fleetAdmin(), 'sanctum')
        ->postJson("/api/v1/availability-blocks/{$block->id}/answer", ['status' => 'approved'])
        ->assertOk()
        ->assertJsonPath('data.status', 'approved');

    expect(availability()->forDriver($driver->id, now(), now()->addHour())->free)->toBeFalse();
});

it('leaves a declined request with no effect on dispatch, and keeps the record', function () {
    $driver = Driver::factory()->create();
    $block = AvailabilityBlock::factory()->forDriver($driver)->requested()->create([
        'starts_at' => now()->subHour(),
        'ends_at' => now()->addDay(),
    ]);

    $this->actingAs(fleetAdmin(), 'sanctum')
        ->postJson("/api/v1/availability-blocks/{$block->id}/answer", [
            'status' => 'declined',
            'note' => 'Short-handed that week.',
        ])->assertOk();

    expect(availability()->forDriver($driver->id, now(), now()->addHour())->free)->toBeTrue();
    // Kept, not deleted: "I asked and was refused" is exactly the fact a
    // driver and a depot manager end up disagreeing about.
    expect($block->fresh()->status)->toBe(AvailabilityStatus::DECLINED);
    expect($block->fresh()->answer_note)->toBe('Short-handed that week.');
});

it('refuses to answer the same request twice', function () {
    $block = AvailabilityBlock::factory()->requested()->create();
    $admin = fleetAdmin();

    $this->actingAs($admin, 'sanctum')
        ->postJson("/api/v1/availability-blocks/{$block->id}/answer", ['status' => 'approved'])
        ->assertOk();

    $this->actingAs($admin, 'sanctum')
        ->postJson("/api/v1/availability-blocks/{$block->id}/answer", ['status' => 'declined'])
        ->assertStatus(409)
        ->assertJsonPath('code', 'AVAILABILITY_ALREADY_ANSWERED');
});

it('will not let somebody answer their own request', function () {
    $admin = fleetAdmin();
    $block = AvailabilityBlock::factory()->requested()->create(['created_by_user_id' => $admin->id]);

    // Some of the people holding drivers.manage also drive. Self-approval
    // turns a request into a formality and leaves an audit trail reading as
    // an approval when nobody approved anything.
    $this->actingAs($admin, 'sanctum')
        ->postJson("/api/v1/availability-blocks/{$block->id}/answer", ['status' => 'approved'])
        ->assertForbidden();
});

it('refuses "requested" as an answer', function () {
    $block = AvailabilityBlock::factory()->requested()->create();

    $this->actingAs(fleetAdmin(), 'sanctum')
        ->postJson("/api/v1/availability-blocks/{$block->id}/answer", ['status' => 'requested'])
        ->assertStatus(422);
});

// ── Authorization and validation ─────────────────────────────────────────

it('needs the permission for the resource, not a permission of its own', function () {
    $vehicle = Vehicle::factory()->create();
    $driver = Driver::factory()->create();

    // Corporate Admin holds neither drivers.manage nor vehicles.manage.
    $outsider = User::factory()->create([
        'tenant_id' => Tenant::factory()->create()->id,
        'role' => UserRole::CORPORATE_ADMIN,
    ]);

    $this->actingAs($outsider, 'sanctum')
        ->postJson('/api/v1/availability-blocks', [
            'resource_type' => 'vehicle',
            'resource_id' => $vehicle->id,
            'kind' => 'maintenance',
            'starts_at' => '2026-09-01 08:00:00',
        ])->assertForbidden();

    $this->actingAs($outsider, 'sanctum')
        ->postJson('/api/v1/availability-blocks', [
            'resource_type' => 'driver',
            'resource_id' => $driver->id,
            'kind' => 'leave',
            'starts_at' => '2026-09-01 08:00:00',
        ])->assertForbidden();
});

it('refuses a kind that does not belong to the resource', function () {
    // A van does not take annual leave. Allowing the cross product would make
    // the utilisation report the kind exists to feed unreadable.
    $this->actingAs(fleetAdmin(), 'sanctum')
        ->postJson('/api/v1/availability-blocks', [
            'resource_type' => 'vehicle',
            'resource_id' => Vehicle::factory()->create()->id,
            'kind' => 'leave',
            'starts_at' => '2026-09-01 08:00:00',
        ])->assertStatus(422)->assertJsonValidationErrors('kind');
});

it('refuses a block against a resource that does not exist', function () {
    $this->actingAs(fleetAdmin(), 'sanctum')
        ->postJson('/api/v1/availability-blocks', [
            'resource_type' => 'driver',
            'resource_id' => 999999,
            'kind' => 'leave',
            'starts_at' => '2026-09-01 08:00:00',
        ])->assertStatus(422)->assertJsonValidationErrors('resource_id');
});

it('refuses a block that ends before it starts', function () {
    $this->actingAs(fleetAdmin(), 'sanctum')
        ->postJson('/api/v1/availability-blocks', [
            'resource_type' => 'driver',
            'resource_id' => Driver::factory()->create()->id,
            'kind' => 'leave',
            'starts_at' => '2026-09-02 08:00:00',
            'ends_at' => '2026-09-01 08:00:00',
        ])->assertStatus(422)->assertJsonValidationErrors('ends_at');
});

it('puts a vehicle back on the road when the block is removed', function () {
    $vehicle = Vehicle::factory()->create();
    $block = AvailabilityBlock::factory()->forVehicle($vehicle)->create([
        'starts_at' => now()->subHour(),
        'ends_at' => now()->addDay(),
    ]);

    expect(availability()->forVehicle($vehicle->id, now(), now()->addHour())->free)->toBeFalse();

    $this->actingAs(fleetAdmin(), 'sanctum')
        ->deleteJson("/api/v1/availability-blocks/{$block->id}")
        ->assertNoContent();

    // A fleet that cannot correct its own record without a database console
    // will simply stop keeping the record.
    expect(availability()->forVehicle($vehicle->id, now(), now()->addHour())->free)->toBeTrue();
});

it('lists blocks filtered by resource and window', function () {
    $driver = Driver::factory()->create();
    AvailabilityBlock::factory()->forDriver($driver)
        ->between('2026-09-01 08:00:00', '2026-09-01 12:00:00')->create();
    AvailabilityBlock::factory()->forDriver($driver)
        ->between('2026-12-01 08:00:00', '2026-12-01 12:00:00')->create();

    $rows = $this->actingAs(fleetAdmin(), 'sanctum')
        ->getJson('/api/v1/availability-blocks?'.http_build_query([
            'resource_type' => 'driver',
            'resource_id' => $driver->id,
            'from' => '2026-09-01 00:00:00',
            'to' => '2026-09-02 00:00:00',
        ]))->assertOk()->json('data');

    expect($rows)->toHaveCount(1);
});

it('refuses a half-specified window rather than guessing the other end', function () {
    $this->actingAs(fleetAdmin(), 'sanctum')
        ->getJson('/api/v1/availability-blocks?from=2026-09-01+00:00:00')
        ->assertStatus(422);
});

// ── The shared roster, as ADR-0005 intends ───────────────────────────────

it('shows every tenant the same availability, because the fleet is the platform\'s', function () {
    $driver = Driver::factory()->create();
    AvailabilityBlock::factory()->forDriver($driver)->create();

    $fleetOwnerA = User::factory()->create([
        'tenant_id' => Tenant::factory()->create()->id,
        'role' => UserRole::FLEET_OWNER,
    ]);

    // Deliberately shared (ADR-0005). Scoping availability to a tenant would
    // make a vehicle look free to every client but the one that booked it in
    // for a service — the mirror of the driver-roster assertion in
    // DriverCrossTenantIsolationTest.
    $rows = $this->actingAs($fleetOwnerA, 'sanctum')
        ->getJson('/api/v1/availability-blocks?resource_type=driver&resource_id='.$driver->id)
        ->assertOk()->json('data');

    expect($rows)->toHaveCount(1);
    expect($rows[0]['resource_type'])->toBe(AvailabilityResource::DRIVER->value);
});
