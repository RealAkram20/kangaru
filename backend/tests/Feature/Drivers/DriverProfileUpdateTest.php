<?php

use App\Enums\UserRole;
use App\Models\User;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Services\DriverProfileService;
use Modules\Vehicles\Models\Vehicle;

/**
 * `PATCH /me/profile` — a driver correcting their own details.
 *
 * The whole risk in this endpoint is what it *refuses*. A driver may fix their
 * own name and phone number; the five other columns the office can write are
 * compliance and dispatch facts, and each has a way of looking harmless:
 *
 * - `license_expiry` lets a driver self-certify their own compliance and makes
 *   the ADR-0033 review queue meaningless.
 * - `status` lets a suspended driver lift their own suspension.
 * - `vehicle_id` is a Fleet allocation, not a preference.
 * - `email` is the login credential (ADR-0016).
 *
 * `Driver::$fillable` contains every one of them — it must, because the
 * office's own update path fills them — so mass assignment protects nothing
 * here. The tests below pin both locks: the form request's rules, and the
 * explicit allow-list at the write site.
 */
function updatableDriver(array $attributes = []): array
{
    $user = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);
    $driver = Driver::factory()->create(['user_id' => $user->id] + $attributes);

    return [$user, $driver];
}

it('lets a driver correct their own name and phone number', function (): void {
    [$user, $driver] = updatableDriver(['name' => 'Jon Kamau', 'phone' => '+256700000000']);

    $this->actingAs($user)
        ->patchJson('/api/v1/me/profile', [
            'name' => 'John Kamau',
            'phone' => '+256700123456',
        ])
        ->assertOk()
        ->assertJsonPath('data.name', 'John Kamau')
        ->assertJsonPath('data.phone', '+256700123456');

    expect($driver->refresh()->name)->toBe('John Kamau')
        ->and($driver->phone)->toBe('+256700123456');
});

it('accepts either field alone, so a phone correction cannot blank a name', function (): void {
    [$user, $driver] = updatableDriver(['name' => 'John Kamau', 'phone' => '+256700000000']);

    $this->actingAs($user)
        ->patchJson('/api/v1/me/profile', ['phone' => '+256700123456'])
        ->assertOk();

    // The half that was not sent is the half this asserts. A `fill()` over the
    // whole request body would have written a null here and nobody would have
    // noticed until a driver lost their name correcting their number.
    expect($driver->refresh()->name)->toBe('John Kamau')
        ->and($driver->phone)->toBe('+256700123456');
});

/**
 * Each withheld field, **sent on its own**.
 *
 * The first version of this test sent all five at once and asserted one 422.
 * A mutation proved it a liar: dropping `prohibited` from `status` alone left
 * it green, because the other four still rejected the request. An assertion
 * that the *request* failed says nothing about *which* rule failed it.
 *
 * One case per field, each naming the field in the error bag, is the only
 * shape that fails when exactly one lock is picked.
 */
it('refuses each column the office keeps, one at a time', function (string $field, mixed $value): void {
    [$user] = updatableDriver();

    $this->actingAs($user)
        ->patchJson('/api/v1/me/profile', ['name' => 'John Kamau', $field => $value])
        ->assertStatus(422)
        ->assertJsonValidationErrors([$field]);
})->with([
    'status' => ['status', 'active'],
    'license number' => ['license_number', 'DL-9999'],
    'license expiry' => ['license_expiry', '2099-12-31'],
    'vehicle' => ['vehicle_id', 1],
    'email' => ['email', 'attacker@example.test'],
]);

it('leaves every withheld column untouched when one is attempted', function (): void {
    $mine = Vehicle::factory()->create();

    [$user, $driver] = updatableDriver([
        'status' => 'suspended',
        'license_number' => 'DL-0001',
        'vehicle_id' => $mine->getKey(),
        'email' => 'john@kangaruride.test',
    ]);

    $this->actingAs($user)->patchJson('/api/v1/me/profile', [
        'name' => 'John Kamau',
        'status' => 'active',
    ])->assertStatus(422);

    // A rejected request writes nothing at all — not even the valid half. A
    // partial write here would let a driver rename themselves by attaching a
    // suspension lift to it and reading the error as a failure.
    $driver->refresh();

    expect($driver->status)->toBe('suspended')
        ->and($driver->name)->not->toBe('John Kamau')
        ->and($driver->license_number)->toBe('DL-0001')
        ->and($driver->vehicle_id)->toBe($mine->getKey())
        ->and($driver->email)->toBe('john@kangaruride.test');
});

it('ignores withheld columns handed straight to the service', function (): void {
    // **This is the only test that proves the second lock.** Every other
    // refusal above is enforced by the form request's `prohibited` rules, so
    // deleting the allow-list in `update()` leaves them all green — a guard no
    // test can fail is a guard that is not there. This one goes around the
    // request entirely, which is what a future caller would do.
    $vehicle = Vehicle::factory()->create();
    [, $driver] = updatableDriver([
        'status' => 'suspended',
        'license_expiry' => '2026-01-01',
    ]);

    app(DriverProfileService::class)->update($driver, [
        'name' => 'John Kamau',
        'status' => 'active',
        'license_expiry' => '2099-12-31',
        'vehicle_id' => $vehicle->getKey(),
    ]);

    $driver->refresh();

    expect($driver->name)->toBe('John Kamau')
        ->and($driver->status)->toBe('suspended')
        ->and($driver->license_expiry->toDateString())->toBe('2026-01-01')
        ->and($driver->vehicle_id)->toBeNull();
});

it('keeps the allow-list at two fields', function (): void {
    // Asserted as a count, not as a "contains name". An existence check passes
    // just as happily when somebody has added `status` beside them, which is
    // the exact mistake this constant exists to make visible in a diff.
    expect(DriverProfileService::SELF_EDITABLE)->toBe(['name', 'phone'])
        ->and(DriverProfileService::SELF_EDITABLE)->toHaveCount(2);
});

it('refuses a blank name and a blank phone number', function (): void {
    [$user, $driver] = updatableDriver(['name' => 'John Kamau']);

    $this->actingAs($user)
        ->patchJson('/api/v1/me/profile', ['name' => ''])
        ->assertStatus(422);

    $this->actingAs($user)
        ->patchJson('/api/v1/me/profile', ['phone' => ''])
        ->assertStatus(422);

    expect($driver->refresh()->name)->toBe('John Kamau');
});

it('accepts the international numbers PRODUCT.md is built for', function (): void {
    [$user, $driver] = updatableDriver();

    // A regex tuned to +256 would refuse every one of these, and the platform
    // would be accepting numbers through the office's form that it then would
    // not let their owner correct.
    foreach (['+254712345678', '0700123456', '+256 700 123 456', '+44 7700 900123'] as $number) {
        $this->actingAs($user)
            ->patchJson('/api/v1/me/profile', ['phone' => $number])
            ->assertOk();

        expect($driver->refresh()->phone)->toBe($number);
    }
});

it('answers 403 for an account with no driver profile', function (): void {
    $user = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);

    $this->actingAs($user)
        ->patchJson('/api/v1/me/profile', ['name' => 'Nobody'])
        ->assertStatus(403);
});

it('cannot reach another driver, because there is no id to spell', function (): void {
    [$user] = updatableDriver(['name' => 'John Kamau']);
    [, $other] = updatableDriver(['name' => 'Grace Nakato']);

    $this->actingAs($user)
        ->patchJson('/api/v1/me/profile', ['name' => 'Renamed'])
        ->assertOk();

    // The driver is the token. This is the property that makes the missing
    // policy correct rather than an oversight, so it is asserted rather than
    // assumed.
    expect($other->refresh()->name)->toBe('Grace Nakato');
});

it('records the change in the audit log', function (): void {
    [$user, $driver] = updatableDriver(['phone' => '+256700000000']);

    $this->actingAs($user)
        ->patchJson('/api/v1/me/profile', ['phone' => '+256700123456'])
        ->assertOk();

    // `Driver` is `Auditable`. The office needs to be able to see that the
    // driver changed their own number and what it was before — otherwise a
    // dispatcher ringing an old number has no way to find out why it changed.
    $this->assertDatabaseHas('audit_logs', [
        // The morph class, not the FQCN: `AppServiceProvider::enforceMorphMap`
        // aliases these, and asserting the class name passes today and breaks
        // the day somebody maps `Driver`.
        'auditable_type' => $driver->getMorphClass(),
        'auditable_id' => $driver->getKey(),
        'action' => 'updated',
    ]);
});
