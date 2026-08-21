<?php

use App\Enums\UserRole;
use App\Models\User;
use Illuminate\Support\Facades\Hash;
use Modules\Drivers\Enums\DriverApplicationStatus;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Models\DriverApplication;
use Modules\Trips\Models\Trip;

/**
 * ADR-0027 — self-service driver registration.
 *
 * The claims worth defending, in rough order of what a mistake would cost:
 * an application is not an account (nothing can sign in before approval);
 * the public endpoint is not an oracle (identical answers for known and
 * unknown emails); approval is one atomic act producing a login that can
 * actually drive; and the escalation rule holds at this door exactly as it
 * does at ADR-0016's.
 */
function applicationPayload(array $overrides = []): array
{
    return array_merge([
        'name' => 'Musa Kirya',
        'phone' => '+256 772 123 456',
        'email' => 'musa.applies@kangaruride.test',
        'password' => 'a-password-i-chose',
        'password_confirmation' => 'a-password-i-chose',
        'terms_accepted' => true,
    ], $overrides);
}

function reviewerWhoMayDecide(): User
{
    return User::factory()->create(['tenant_id' => null, 'role' => UserRole::SUPER_ADMIN]);
}

it('accepts an application from a stranger with no token at all', function () {
    $response = $this->postJson('/api/v1/driver-applications', applicationPayload())
        ->assertStatus(202);

    $application = DriverApplication::sole();
    expect($application->status)->toBe(DriverApplicationStatus::PENDING);
    expect($application->terms_accepted_at)->not->toBeNull();

    /**
     * ADR-0048 §4 changed this response, and the change is narrow.
     *
     * **The id is still not returned** — it would be a handle for guessing at
     * other people's applications. What comes back is the claim ticket: an
     * opaque secret that resolves to this row and nothing else on the
     * platform.
     */
    expect($response->json('data.id'))->toBeNull();
    expect($response->json('data.upload_token'))->toBeString()->toHaveLength(64);
    expect($response->json('data.upload_expires_at'))->toBeString();

    // Stored hashed, never in the clear — a database dump must not hand out
    // the ability to overwrite anybody's documents.
    expect($application->upload_token_hash)
        ->toBe(hash('sha256', $response->json('data.upload_token')));
});

/**
 * ADR-0027 §1: an application is not an account. Mutation check — make the
 * service create a `users` row at submission and this fails.
 */
it('creates no account, no driver, and nothing that can sign in', function () {
    $this->postJson('/api/v1/driver-applications', applicationPayload())->assertStatus(202);

    expect(User::query()->where('email', 'musa.applies@kangaruride.test')->exists())->toBeFalse();
    expect(Driver::query()->where('email', 'musa.applies@kangaruride.test')->exists())->toBeFalse();

    $this->postJson('/api/v1/auth/login', [
        'email' => 'musa.applies@kangaruride.test',
        'password' => 'a-password-i-chose',
    ])->assertStatus(401);
});

it('stores the password as a hash, never as what was typed', function () {
    $this->postJson('/api/v1/driver-applications', applicationPayload())->assertStatus(202);

    $stored = DriverApplication::sole()->getAttributes()['password'];

    expect($stored)->not->toBe('a-password-i-chose');
    expect(Hash::check('a-password-i-chose', $stored))->toBeTrue();
});

/**
 * ADR-0027 §5: the endpoint must not be usable to ask "does this person
 * drive for KangaruRide". Mutation check — add a `unique` rule on email in
 * the form request, or a duplicate check in the service, and this fails.
 */
it('answers identically whether or not the email is already known', function () {
    $existing = User::factory()->create(['email' => 'taken@kangaruride.test']);

    $fresh = $this->postJson('/api/v1/driver-applications', applicationPayload());
    $duplicate = $this->postJson(
        '/api/v1/driver-applications',
        applicationPayload(['email' => $existing->email]),
    );

    $fresh->assertStatus(202);
    $duplicate->assertStatus(202);
    expect($duplicate->json('message'))->toBe($fresh->json('message'));

    /**
     * ADR-0048 §4 added a body to this response and must not have added an
     * oracle with it.
     *
     * The **shape** is what has to match, not the values: a claim ticket is
     * random by construction, so two identical tickets would be the bug. What
     * would leak is a known email getting no ticket, or a different set of
     * keys — either of which answers "does this person already drive for
     * KangaruRide" to anybody who cares to ask twice.
     */
    expect(array_keys($duplicate->json('data')))->toBe(array_keys($fresh->json('data')));
    expect($duplicate->json('data.upload_token'))->toBeString()->toHaveLength(64);
    expect($duplicate->json('data.upload_token'))->not->toBe($fresh->json('data.upload_token'));
});

it('refuses an application without affirmative consent', function () {
    $this->postJson('/api/v1/driver-applications', applicationPayload(['terms_accepted' => false]))
        ->assertStatus(422)
        ->assertJsonValidationErrors('terms_accepted');

    $this->postJson(
        '/api/v1/driver-applications',
        collect(applicationPayload())->except('terms_accepted')->all(),
    )->assertStatus(422);
});

it('holds the same eight-character floor the change and reset doors hold', function () {
    // Seven. Mutation check — drop `Password::min(8)` here and an applicant
    // can mint an account with a password the change-password screen would
    // then refuse to let them keep.
    $this->postJson('/api/v1/driver-applications', applicationPayload([
        'password' => '2short!',
        'password_confirmation' => '2short!',
    ]))->assertStatus(422)->assertJsonValidationErrors('password');

    $this->postJson('/api/v1/driver-applications', applicationPayload([
        'email' => 'eight@kangaruride.test',
        'password' => '8chars!!',
        'password_confirmation' => '8chars!!',
    ]))->assertStatus(202);
});

/**
 * ADR-0027 §6: no status checker. The route simply does not exist for the
 * public — GET without a token must be unauthenticated-rejected, not a
 * list.
 */
it('gives an applicant no way to read the queue', function () {
    $this->postJson('/api/v1/driver-applications', applicationPayload())->assertStatus(202);

    $this->getJson('/api/v1/driver-applications')->assertStatus(401);
    $this->getJson('/api/v1/driver-applications/'.DriverApplication::sole()->id)
        ->assertStatus(401);
});

it('approves into a driver who can sign in with the password they chose', function () {
    $this->postJson('/api/v1/driver-applications', applicationPayload())->assertStatus(202);
    $application = DriverApplication::sole();

    $this->actingAs(reviewerWhoMayDecide(), 'sanctum')
        ->postJson("/api/v1/driver-applications/{$application->id}/approve", [
            'license_number' => 'UG-DL-99887',
            'license_expiry' => now()->addYears(3)->toDateString(),
        ])
        ->assertCreated()
        ->assertJsonPath('data.account.email', 'musa.applies@kangaruride.test');

    // The whole point: the credential chosen at the roadside works, and was
    // never re-typed by anybody.
    $this->postJson('/api/v1/auth/login', [
        'email' => 'musa.applies@kangaruride.test',
        'password' => 'a-password-i-chose',
    ])->assertOk();

    $application->refresh();
    expect($application->status)->toBe(DriverApplicationStatus::APPROVED);
    expect($application->driver_id)->not->toBeNull();
    // The live credential moved to `users`; the queue holds nothing.
    expect($application->getAttributes()['password'])->toBeNull();

    // Platform-level, per ADR-0005 via ADR-0016 §6.
    $driver = Driver::find($application->driver_id);
    expect($driver->user->tenant_id)->toBeNull();
    expect($driver->user->roleSlug())->toBe('driver');
});

it('lets the approved account accept its own trip, end to end', function () {
    $this->postJson('/api/v1/driver-applications', applicationPayload())->assertStatus(202);
    $application = DriverApplication::sole();

    $this->actingAs(reviewerWhoMayDecide(), 'sanctum')
        ->postJson("/api/v1/driver-applications/{$application->id}/approve", [
            'license_number' => 'UG-DL-11223',
            'license_expiry' => now()->addYears(3)->toDateString(),
        ])->assertCreated();

    $driver = Driver::find($application->refresh()->driver_id);
    $trip = Trip::factory()->forDriver($driver)->create();

    $this->actingAs($driver->user, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/transitions", ['to' => 'accepted'])
        ->assertOk();
});

/**
 * The duplicate §5 deliberately let through surfaces here, as a 409 in
 * front of a human — not as a silent second account.
 */
it('refuses at approval the duplicate it accepted at submission', function () {
    User::factory()->create(['email' => 'taken@kangaruride.test']);

    $this->postJson(
        '/api/v1/driver-applications',
        applicationPayload(['email' => 'taken@kangaruride.test']),
    )->assertStatus(202);

    $application = DriverApplication::sole();

    $this->actingAs(reviewerWhoMayDecide(), 'sanctum')
        ->postJson("/api/v1/driver-applications/{$application->id}/approve", [
            'license_number' => 'UG-DL-55667',
            'license_expiry' => now()->addYears(3)->toDateString(),
        ])
        ->assertStatus(409);

    // And atomically: the failed approval left no half-made driver behind.
    expect(Driver::query()->where('email', 'taken@kangaruride.test')->exists())->toBeFalse();
    expect($application->refresh()->status)->toBe(DriverApplicationStatus::PENDING);
});

it('refuses a second decision on a decided application', function () {
    $this->postJson('/api/v1/driver-applications', applicationPayload())->assertStatus(202);
    $application = DriverApplication::sole();
    $reviewer = reviewerWhoMayDecide();

    $this->actingAs($reviewer, 'sanctum')
        ->postJson("/api/v1/driver-applications/{$application->id}/reject", [
            'reason' => 'Licence lapsed in 2024.',
        ])->assertOk();

    $this->actingAs($reviewer, 'sanctum')
        ->postJson("/api/v1/driver-applications/{$application->id}/approve", [
            'license_number' => 'UG-DL-33445',
            'license_expiry' => now()->addYears(3)->toDateString(),
        ])
        ->assertStatus(409)
        ->assertJsonPath('code', 'DRIVER_APPLICATION_CLOSED');
});

it('clears the stored credential when an application is rejected', function () {
    $this->postJson('/api/v1/driver-applications', applicationPayload())->assertStatus(202);
    $application = DriverApplication::sole();

    $this->actingAs(reviewerWhoMayDecide(), 'sanctum')
        ->postJson("/api/v1/driver-applications/{$application->id}/reject", [
            'reason' => 'Could not produce the licence.',
        ])->assertOk();

    expect($application->refresh()->getAttributes()['password'])->toBeNull();
});

/**
 * ADR-0016 §2 through this door: `drivers.manage` alone must not decide.
 * A Depot Manager holds it and may not mint logins.
 */
it('refuses a reviewer who may manage drivers but not create logins', function () {
    $this->postJson('/api/v1/driver-applications', applicationPayload())->assertStatus(202);
    $application = DriverApplication::sole();

    $depotManager = User::factory()->create([
        'tenant_id' => null,
        'role' => UserRole::DEPOT_MANAGER,
    ]);

    $this->actingAs($depotManager, 'sanctum')
        ->postJson("/api/v1/driver-applications/{$application->id}/approve", [
            'license_number' => 'UG-DL-77889',
            'license_expiry' => now()->addYears(3)->toDateString(),
        ])->assertStatus(403);

    // Rejection is gated as tightly — un-hiring is not a lesser act.
    $this->actingAs($depotManager, 'sanctum')
        ->postJson("/api/v1/driver-applications/{$application->id}/reject", [
            'reason' => 'Trying anyway.',
        ])->assertStatus(403);
});

it('refuses approval on a licence that has already expired', function () {
    $this->postJson('/api/v1/driver-applications', applicationPayload())->assertStatus(202);

    $this->actingAs(reviewerWhoMayDecide(), 'sanctum')
        ->postJson('/api/v1/driver-applications/'.DriverApplication::sole()->id.'/approve', [
            'license_number' => 'UG-DL-00111',
            'license_expiry' => now()->subDay()->toDateString(),
        ])
        ->assertStatus(422)
        ->assertJsonValidationErrors('license_expiry');
});

it('never serialises the password hash to the console', function () {
    $this->postJson('/api/v1/driver-applications', applicationPayload())->assertStatus(202);
    $application = DriverApplication::sole();

    $response = $this->actingAs(reviewerWhoMayDecide(), 'sanctum')
        ->getJson("/api/v1/driver-applications/{$application->id}")
        ->assertOk();

    expect($response->json('data'))->not->toHaveKey('password');
    expect($response->content())->not->toContain('$2y$');
});

it('lists oldest first, because it is a queue', function () {
    $this->travel(-2)->days(fn () => $this->postJson(
        '/api/v1/driver-applications',
        applicationPayload(['email' => 'monday@kangaruride.test']),
    )->assertStatus(202));

    $this->postJson(
        '/api/v1/driver-applications',
        applicationPayload(['email' => 'today@kangaruride.test']),
    )->assertStatus(202);

    $response = $this->actingAs(reviewerWhoMayDecide(), 'sanctum')
        ->getJson('/api/v1/driver-applications?status=pending')
        ->assertOk();

    expect($response->json('data.driver_applications.0.email'))->toBe('monday@kangaruride.test');
});
