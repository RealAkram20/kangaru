<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use Modules\Administration\Services\SettingsService;
use Modules\Bookings\Enums\BookingStatus;
use Modules\Bookings\Models\OrderRequest;

/**
 * ADR-0014 phase 2: the ordering and booking levers actually steer the
 * behavior they claim to. Each test writes the setting through the
 * service (the same path the API uses) and asserts the module obeys.
 */
function orderPayload(): array
{
    return [
        'service_type' => 'ride',
        'contact_name' => 'Nakato Grace',
        'contact_phone' => '0700123456',
        'pickup_location' => 'Seeta',
        'dropoff_location' => 'Acacia Mall',
    ];
}

it('pauses public intake when the owner switches it off', function () {
    app(SettingsService::class)->setGroup('ordering', ['walk_in_enabled' => false]);

    $this->postJson('/api/v1/public/order-requests', orderPayload())
        ->assertStatus(503)
        ->assertJsonPath('code', 'ORDERING_PAUSED');

    expect(OrderRequest::query()->count())->toBe(0);

    // Switching it back on restores intake with no other ceremony.
    app(SettingsService::class)->setGroup('ordering', ['walk_in_enabled' => true]);

    $this->postJson('/api/v1/public/order-requests', orderPayload())->assertStatus(201);
});

it('throttles public intake at the configured rate, not the old literal', function () {
    app(SettingsService::class)->setGroup('ordering', ['rate_limit_per_minute' => 1]);

    $this->postJson('/api/v1/public/order-requests', orderPayload())->assertStatus(201);
    $this->postJson('/api/v1/public/order-requests', orderPayload())->assertStatus(429);
});

it('auto-approves a booking when the owner has waived approval', function () {
    app(SettingsService::class)->setGroup('booking', ['approval_required' => false]);

    $tenant = Tenant::factory()->create();
    $employee = User::factory()->create([
        'tenant_id' => $tenant->id,
        'role' => UserRole::CORPORATE_EMPLOYEE,
    ]);

    $this->actingAs($employee, 'sanctum')
        ->postJson('/api/v1/bookings', [
            'passenger_user_id' => $employee->id,
            'passenger_name' => 'Nakato Grace',
            'passenger_phone' => '0700123456',
            'origin' => 'Kampala',
            'destination' => 'Entebbe',
        ])
        ->assertStatus(201)
        ->assertJsonPath('data.status', BookingStatus::APPROVED->value)
        // The waiver is visible, not hidden: approved_by is the requester,
        // which under the default setting the seeded roles forbid.
        ->assertJsonPath('data.approved_by_user_id', $employee->id);
});

it('keeps the approval step by default', function () {
    $tenant = Tenant::factory()->create();
    $employee = User::factory()->create([
        'tenant_id' => $tenant->id,
        'role' => UserRole::CORPORATE_EMPLOYEE,
    ]);

    $this->actingAs($employee, 'sanctum')
        ->postJson('/api/v1/bookings', [
            'passenger_user_id' => $employee->id,
            'passenger_name' => 'Nakato Grace',
            'passenger_phone' => '0700123456',
            'origin' => 'Kampala',
            'destination' => 'Entebbe',
        ])
        ->assertStatus(201)
        ->assertJsonPath('data.status', BookingStatus::PENDING->value);
});

it('caps how far ahead a booking may be scheduled, per settings', function () {
    app(SettingsService::class)->setGroup('booking', ['max_advance_days' => 5]);

    $tenant = Tenant::factory()->create();
    $employee = User::factory()->create([
        'tenant_id' => $tenant->id,
        'role' => UserRole::CORPORATE_EMPLOYEE,
    ]);

    $base = [
        'passenger_user_id' => $employee->id,
        'passenger_name' => 'Nakato Grace',
        'passenger_phone' => '0700123456',
        'origin' => 'Kampala',
        'destination' => 'Entebbe',
    ];

    $this->actingAs($employee, 'sanctum')
        ->postJson('/api/v1/bookings', [
            ...$base,
            'scheduled_for' => now()->addDays(10)->toIso8601String(),
        ])
        ->assertStatus(422)
        ->assertJsonValidationErrors(['scheduled_for']);

    $this->actingAs($employee, 'sanctum')
        ->postJson('/api/v1/bookings', [
            ...$base,
            'scheduled_for' => now()->addDays(2)->toIso8601String(),
        ])
        ->assertStatus(201);
});

it('applies the same advance cap to the public order form', function () {
    app(SettingsService::class)->setGroup('booking', ['max_advance_days' => 5]);

    $this->postJson('/api/v1/public/order-requests', [
        ...orderPayload(),
        'scheduled_for' => now()->addDays(10)->toIso8601String(),
    ])
        ->assertStatus(422)
        ->assertJsonValidationErrors(['scheduled_for']);
});
