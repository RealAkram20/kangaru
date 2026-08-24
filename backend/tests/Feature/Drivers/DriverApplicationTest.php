<?php

use App\Enums\AccessLevel;
use App\Enums\UserRole;
use App\Models\User;
use App\Support\Auth\ClientScope;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Route;
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
 * **This test used to assert the opposite, and the reversal is ADR-0057 §5.**
 *
 * ADR-0027 §1 refused an account at submission so that no authorisation path
 * would have to learn a third state: *"the cost of missing one is a login
 * that works before anybody approved it."* An applicant now gets one, because
 * a refused document is unanswerable without a way back in.
 *
 * **The objection is answered rather than dropped, and this is where.** There
 * is no third `UserStatus` — the account is `active` and inert, because
 * authority comes from `drivers.user_id` and approval is what creates it.
 * `AccessLevel::APPLICANT` keeps every scoped read at `1 = 0`.
 *
 * So the guarantee worth testing is no longer "nothing can sign in". It is
 * **"it signs in and reaches nothing of anybody else's"** — their own
 * application is theirs, and everything else must refuse or come back empty.
 * A stronger claim than the old one, and a weaker position to be wrong about — hence the walk over every route a
 * driver token is scoped to, read from `ClientScope` rather than copied, so
 * a route added later is covered by a test written today.
 */
it('creates an account that signs in and reaches nothing', function () {
    $this->postJson('/api/v1/driver-applications', applicationPayload())->assertStatus(202);

    $applicant = User::query()->where('email', 'musa.applies@kangaruride.test')->sole();

    // Declared, never inferred (ADR-0055 §4). The two nulls it shares with
    // head office are why the column has to say which.
    expect($applicant->access_level)->toBe(AccessLevel::APPLICANT);
    expect($applicant->operator_id)->toBeNull();

    // No driver profile, which is the thing that grants.
    expect(Driver::query()->where('user_id', $applicant->getKey())->exists())->toBeFalse();

    $token = $this->postJson('/api/v1/auth/login', [
        'email' => 'musa.applies@kangaruride.test',
        'password' => 'a-password-i-chose',
    ])->assertOk()->json('data.token');

    expect($token)->toBeString();

    $scoped = ClientScope::routesFor(ClientScope::DRIVER);
    $checked = 0;

    foreach (Route::getRoutes() as $route) {
        $name = $route->getName();

        // The session verbs stay usable, or the account is not a login at
        // all. Everything else must refuse.
        if ($name === null || ! in_array($name, $scoped, true) || str_starts_with($name, 'auth.')) {
            continue;
        }

        // Only the routes needing no path parameter — one with an id would be
        // asserting about a missing record rather than a missing driver.
        if (str_contains($route->uri(), '{')) {
            continue;
        }

        $method = collect($route->methods())->first(fn ($verb) => $verb !== 'HEAD');

        $response = $this->actingAs($applicant, 'sanctum')->json($method, '/'.$route->uri());
        $status = $response->status();

        /*
            **A 200 carrying nothing is not a leak, and demanding a 4xx here
            was the wrong claim.** The guarantee is "reaches nothing", and a
            list scoped to empty by `InheritsKangaruDefaults` — which answers
            `1 = 0` for an applicant — satisfies it exactly. `GET /zones` is
            the real case: reference data, correctly scoped, returning `[]`.
            Refusing it outright would be a different and worse design, since
            the same endpoint has to work for everybody else.
        */
        if ($status < 400) {
            $data = $response->json('data');

            /*
                A 200 is allowed only where it can carry nothing of anybody's.

                Two routes answer an applicant successfully and both are
                correct, so they are named with their reason rather than
                letting an empty-check quietly cover them:

                - `zones.index` is reference data, scoped by
                  `InheritsKangaruDefaults` to `1 = 0` for an applicant. It
                  returns `[]`. Refusing it outright would be worse design —
                  the same endpoint serves everybody.
                - `notifications.read-all` marks the applicant's own
                  notifications read, of which they have none. It acts on
                  nothing and reports that.

                **A third one appearing here is the finding.** Adding a name
                to this list is a decision somebody has to write a reason
                beside, which is the point.
            */
            $harmless = [
                'zones.index',
                'notifications.read-all',

                // **Their own application, and the point of having an
                // account at all** (ADR-0057 §5). Resolved from
                // `$request->user()` with no id in the path or the body, so
                // there is no parameter to change to reach somebody else's —
                // the question "may I?" cannot be asked.
                'me.application.documents.index',
                'me.application.documents.store',

                /*
                 | **Reference data plus the reader's own switches, and
                 | nothing else** (mail plan M6).
                 |
                 | The rows are the `NotificationType` catalogue, which is the
                 | same list for everybody and is no more secret than
                 | `zones.index` above. The only per-account part is this
                 | reader's own on/off flags, which for an applicant are all
                 | default because they have never set one.
                 |
                 | Like the two above it: resolved from `$request->user()`
                 | with no id in the path or the body, so there is no
                 | parameter to change to reach somebody else's. The question
                 | "may I?" cannot be asked.
                 |
                 | Listed rather than made to return `[]`, because an empty
                 | list here would be a lie: an applicant *does* receive email
                 | from this platform — the document rejection of ADR-0057 §5
                 | is addressed to exactly them — and a preferences screen
                 | showing nothing would tell them they have no say in it.
                 */
                'me.mail-preferences.index',
            ];

            $this->assertTrue(
                $data === [] || $data === null || in_array($name, $harmless, true),
                "An applicant reached [{$method} /{$route->uri()}] ({$name}) and it returned data. "
                .'Authority on this platform is the `drivers.user_id` link, not the role '
                .'(ADR-0057 §5): a route a driver can read must be empty for an applicant, or '
                .'be listed here with a reason it cannot carry anybody\'s data.'
            );

            $checked++;

            continue;
        }

        // Never a success. *Which* refusal differs by controller — 403 from a
        // policy, 404 from "not a driver", 422 from a form request that ran
        // first — and pinning one would make this a test about error codes
        // rather than about authority.
        //
        expect($status)->toBeGreaterThanOrEqual(400);

        $checked++;
    }

    // The walk has to have walked something: a filter that quietly excluded
    // every route would leave this green and worthless.
    expect($checked)->toBeGreaterThan(3);
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

/**
 * The floor this request actually enforces, stated as a number.
 *
 * **It read `PasswordPolicy::MINIMUM_LENGTH`, and that class is not committed.**
 * A test importing a class the repository does not contain does not fail on
 * its assertion — it fatals on `use`, and CI has no way to tell that from a
 * broken feature. Whoever lands the shared policy should point this back at
 * the constant in the same commit that adds it.
 *
 * Eight, because `StoreDriverApplicationRequest` says `Password::min(8)` and
 * so do `ChangePasswordRequest` and `PasswordResetController` — the two doors
 * this password walks through next. A number restated here is a liability the
 * moment the floor moves, which is exactly why the pending policy class
 * exists; until it is on the branch, a literal that matches the committed rule
 * is the only assertion that can run.
 *
 * Mutation check — drop the `Password::min(8)` off this request and an
 * applicant can mint an account with a password the change-password screen
 * would then refuse to let them keep.
 */
it('refuses one character below the platform floor, and accepts it exactly', function () {
    $below = str_repeat('k', 7);

    $this->postJson('/api/v1/driver-applications', applicationPayload([
        'password' => $below,
        'password_confirmation' => $below,
    ]))->assertStatus(422)->assertJsonValidationErrors('password');

    $atFloor = str_repeat('k', 8);

    $this->postJson('/api/v1/driver-applications', applicationPayload([
        'email' => 'at-the-floor@kangaruride.test',
        'password' => $atFloor,
        'password_confirmation' => $atFloor,
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
