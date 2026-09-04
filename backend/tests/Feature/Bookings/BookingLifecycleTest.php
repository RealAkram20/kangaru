<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use Modules\Bookings\Enums\BookingStatus;
use Modules\Bookings\Models\Booking;

function seedBookingFixture(): array
{
    $tenant = Tenant::factory()->create();

    $employee = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::CORPORATE_EMPLOYEE]);
    $otherEmployee = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::CORPORATE_EMPLOYEE]);
    $admin = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::CORPORATE_ADMIN]);
    $dispatcher = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::DISPATCHER]);

    $booking = Booking::factory()->requestedBy($employee)->create();

    return compact('tenant', 'employee', 'otherEmployee', 'admin', 'dispatcher', 'booking');
}

it('creates an immediate booking in Pending, attributed to the requester', function () {
    ['employee' => $employee] = seedBookingFixture();

    $response = $this->actingAs($employee, 'sanctum')->postJson('/api/v1/bookings', [
        // A client's booking is for one of the client's own people now:
        // the employee books a car for themselves, and the name on the
        // record comes off the account rather than out of this payload.
        'passenger_user_id' => $employee->id,
        'passenger_name' => 'Grace Nakato',
        'passenger_phone' => '+256700111222',
        'origin' => 'Kampala',
        'destination' => 'Entebbe Airport',
    ]);

    $response->assertStatus(201)
        ->assertJsonPath('data.status', BookingStatus::PENDING->value)
        ->assertJsonPath('data.is_immediate', true)
        ->assertJsonPath('data.requested_by_user_id', $employee->id);
});

it('creates a scheduled booking when a future pickup time is given', function () {
    ['employee' => $employee] = seedBookingFixture();

    $this->actingAs($employee, 'sanctum')->postJson('/api/v1/bookings', [
        // A client's booking is for one of the client's own people now:
        // the employee books a car for themselves, and the name on the
        // record comes off the account rather than out of this payload.
        'passenger_user_id' => $employee->id,
        'passenger_name' => 'Grace Nakato',
        'passenger_phone' => '+256700111222',
        'origin' => 'Kampala',
        'destination' => 'Jinja',
        'scheduled_for' => now()->addDays(2)->toIso8601String(),
    ])->assertStatus(201)->assertJsonPath('data.is_immediate', false);
});

it('rejects a pickup time in the past', function () {
    ['employee' => $employee] = seedBookingFixture();

    $this->actingAs($employee, 'sanctum')->postJson('/api/v1/bookings', [
        // A client's booking is for one of the client's own people now:
        // the employee books a car for themselves, and the name on the
        // record comes off the account rather than out of this payload.
        'passenger_user_id' => $employee->id,
        'passenger_name' => 'Grace Nakato',
        'passenger_phone' => '+256700111222',
        'origin' => 'Kampala',
        'destination' => 'Jinja',
        'scheduled_for' => now()->subHour()->toIso8601String(),
    ])->assertStatus(422)->assertJsonPath('code', 'VALIDATION_FAILED');
});

it('lets an approver approve a pending booking and records who and when', function () {
    ['admin' => $admin, 'booking' => $booking] = seedBookingFixture();

    $this->actingAs($admin, 'sanctum')
        ->postJson("/api/v1/bookings/{$booking->id}/approval")
        ->assertOk()
        ->assertJsonPath('data.status', BookingStatus::APPROVED->value)
        ->assertJsonPath('data.approved_by_user_id', $admin->id);

    expect($booking->fresh()->approved_at)->not->toBeNull();
});

it('requires a reason to reject a booking', function () {
    ['admin' => $admin, 'booking' => $booking] = seedBookingFixture();

    $this->actingAs($admin, 'sanctum')
        ->postJson("/api/v1/bookings/{$booking->id}/rejection", [])
        ->assertStatus(422)
        ->assertJsonPath('code', 'VALIDATION_FAILED');

    $this->actingAs($admin, 'sanctum')
        ->postJson("/api/v1/bookings/{$booking->id}/rejection", ['reason' => 'Outside contracted hours.'])
        ->assertOk()
        ->assertJsonPath('data.status', BookingStatus::REJECTED->value)
        ->assertJsonPath('data.decision_reason', 'Outside contracted hours.');
});

it('refuses a second decision on an already-decided booking with 409', function () {
    ['admin' => $admin, 'booking' => $booking] = seedBookingFixture();

    $this->actingAs($admin, 'sanctum')
        ->postJson("/api/v1/bookings/{$booking->id}/rejection", ['reason' => 'Outside contracted hours.'])
        ->assertOk();

    $this->actingAs($admin, 'sanctum')
        ->postJson("/api/v1/bookings/{$booking->id}/approval")
        ->assertStatus(409)
        ->assertJsonPath('code', 'INVALID_BOOKING_TRANSITION');
});

it('forbids a dispatcher from approving — assigning work is not approving it', function () {
    ['dispatcher' => $dispatcher, 'booking' => $booking] = seedBookingFixture();

    $this->actingAs($dispatcher, 'sanctum')
        ->postJson("/api/v1/bookings/{$booking->id}/approval")
        ->assertStatus(403)
        ->assertJsonPath('code', 'FORBIDDEN');
});

it('lets a requester cancel their own booking but not someone else\'s', function () {
    ['employee' => $employee, 'otherEmployee' => $otherEmployee, 'booking' => $booking] = seedBookingFixture();

    $this->actingAs($otherEmployee, 'sanctum')
        ->postJson("/api/v1/bookings/{$booking->id}/cancellation", ['reason' => 'Not needed.'])
        ->assertStatus(403);

    $this->actingAs($employee, 'sanctum')
        ->postJson("/api/v1/bookings/{$booking->id}/cancellation", ['reason' => 'Meeting moved online.'])
        ->assertOk()
        ->assertJsonPath('data.status', BookingStatus::CANCELLED->value);
});

it('shows a corporate employee only their own bookings', function () {
    ['employee' => $employee, 'otherEmployee' => $otherEmployee, 'booking' => $booking] = seedBookingFixture();

    $othersBooking = Booking::factory()->requestedBy($otherEmployee)->create();

    $ids = collect(
        $this->actingAs($employee, 'sanctum')->getJson('/api/v1/bookings')->json('data')
    )->pluck('id');

    expect($ids)->toContain($booking->id);
    expect($ids)->not->toContain($othersBooking->id);
});

it('puts immediate bookings ahead of scheduled ones in the dispatch queue', function () {
    ['tenant' => $tenant, 'dispatcher' => $dispatcher, 'booking' => $immediate] = seedBookingFixture();

    Booking::factory()->forTenant($tenant)->scheduled(now()->addDays(3)->toDateTimeString())->create();
    Booking::factory()->forTenant($tenant)->scheduled(now()->addDay()->toDateTimeString())->create();

    $queue = collect(
        $this->actingAs($dispatcher, 'sanctum')->getJson('/api/v1/bookings?dispatchable=1')->json('data')
    );

    expect($queue->first()['id'])->toBe($immediate->id);
    expect($queue->pluck('scheduled_for')->slice(1)->filter()->count())->toBe(2);
});

it('rejects an unknown booking filter with a 422', function () {
    ['dispatcher' => $dispatcher] = seedBookingFixture();

    $this->actingAs($dispatcher, 'sanctum')
        ->getJson('/api/v1/bookings?bogus=1')
        ->assertStatus(422)
        ->assertJsonPath('code', 'VALIDATION_FAILED');
});
