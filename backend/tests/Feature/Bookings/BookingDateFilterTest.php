<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use Modules\Bookings\Models\Booking;

/**
 * `from`/`to` on /bookings bound the *pickup* moment: `scheduled_for`, or
 * the moment the booking was raised when there is none. The distinction is
 * the point of half these tests — an immediate booking has no
 * `scheduled_for`, and a filter that read only that column would silently
 * drop the most urgent rows from every range.
 */
function seedDateFilterDispatcher(): array
{
    $tenant = Tenant::factory()->create();
    $dispatcher = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::DISPATCHER]);

    return [$tenant, $dispatcher];
}

it('narrows the queue to pickups inside the range', function () {
    [$tenant, $dispatcher] = seedDateFilterDispatcher();

    $inside = Booking::factory()->forTenant($tenant)->scheduled('2026-08-10 09:00:00')->create();
    $outside = Booking::factory()->forTenant($tenant)->scheduled('2026-09-15 09:00:00')->create();

    $ids = collect(
        $this->actingAs($dispatcher, 'sanctum')
            ->getJson('/api/v1/bookings?from=2026-08-01&to=2026-08-31')
            ->assertOk()
            ->json('data')
    )->pluck('id');

    expect($ids)->toContain($inside->id);
    expect($ids)->not->toContain($outside->id);
});

it('counts an immediate booking as a pickup on the day it was raised', function () {
    [$tenant, $dispatcher] = seedDateFilterDispatcher();

    // No `scheduled_for` at all — its pickup is the moment it was raised.
    $immediate = Booking::factory()->forTenant($tenant)->create(['created_at' => '2026-08-11 07:30:00']);
    $raisedElsewhen = Booking::factory()->forTenant($tenant)->create(['created_at' => '2026-07-02 07:30:00']);

    $ids = collect(
        $this->actingAs($dispatcher, 'sanctum')
            ->getJson('/api/v1/bookings?from=2026-08-01&to=2026-08-31')
            ->assertOk()
            ->json('data')
    )->pluck('id');

    expect($ids)->toContain($immediate->id);
    expect($ids)->not->toContain($raisedElsewhen->id);
});

it('includes the whole of the day `to` names, not just its midnight', function () {
    [$tenant, $dispatcher] = seedDateFilterDispatcher();

    // An evening pickup on the range's last day. Comparing against the bare
    // date would drop it — the audit trail fixed this same bug first.
    $evening = Booking::factory()->forTenant($tenant)->scheduled('2026-08-31 18:00:00')->create();

    $ids = collect(
        $this->actingAs($dispatcher, 'sanctum')
            ->getJson('/api/v1/bookings?from=2026-08-01&to=2026-08-31')
            ->assertOk()
            ->json('data')
    )->pluck('id');

    expect($ids)->toContain($evening->id);
});

it('accepts an open-ended range', function () {
    [$tenant, $dispatcher] = seedDateFilterDispatcher();

    $late = Booking::factory()->forTenant($tenant)->scheduled('2026-09-15 09:00:00')->create();
    $early = Booking::factory()->forTenant($tenant)->scheduled('2026-08-10 09:00:00')->create();

    $fromOnly = collect(
        $this->actingAs($dispatcher, 'sanctum')
            ->getJson('/api/v1/bookings?from=2026-09-01')
            ->assertOk()
            ->json('data')
    )->pluck('id');

    expect($fromOnly)->toContain($late->id);
    expect($fromOnly)->not->toContain($early->id);

    $toOnly = collect(
        $this->actingAs($dispatcher, 'sanctum')
            ->getJson('/api/v1/bookings?to=2026-08-31')
            ->assertOk()
            ->json('data')
    )->pluck('id');

    expect($toOnly)->toContain($early->id);
    expect($toOnly)->not->toContain($late->id);
});

it('rejects a malformed date with a 422', function () {
    [, $dispatcher] = seedDateFilterDispatcher();

    $this->actingAs($dispatcher, 'sanctum')
        ->getJson('/api/v1/bookings?from=last-tuesday')
        ->assertStatus(422)
        ->assertJsonPath('code', 'VALIDATION_FAILED');
});

it('rejects a range that ends before it starts with a 422', function () {
    [, $dispatcher] = seedDateFilterDispatcher();

    $this->actingAs($dispatcher, 'sanctum')
        ->getJson('/api/v1/bookings?from=2026-08-31&to=2026-08-01')
        ->assertStatus(422)
        ->assertJsonPath('code', 'VALIDATION_FAILED');
});
