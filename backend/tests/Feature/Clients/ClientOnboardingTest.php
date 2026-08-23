<?php

declare(strict_types=1);

use App\Enums\AccessLevel;
use App\Enums\UserRole;
use App\Enums\UserStatus;
use App\Models\Operator;
use App\Models\OperatorClient;
use App\Models\Tenant;
use App\Models\User;
use Modules\Clients\Models\Company;

/**
 * Onboarding a corporate client (`K6`, ADR-0060, ADR-0062).
 *
 * The forms are the easy half. What these pin is the rule the whole decision
 * rests on:
 *
 * > **A `requested` contract grants no read whatsoever.**
 *
 * And they pin it **honestly**, which took some care — see the block above
 * `it('grants a requested fleet nothing that an active one is given')`.
 */
function onboarder(string $level, ?int $operatorId = null): User
{
    return User::factory()->create([
        'role' => UserRole::SUPER_ADMIN,
        'status' => UserStatus::ACTIVE,
        'tenant_id' => null,
        'operator_id' => $level === 'fleet' ? ($operatorId ?? Operator::SHANITAH) : null,
        'access_level' => $level === 'fleet' ? AccessLevel::FLEET : AccessLevel::KANGARU,
    ]);
}

function clientAdmin(int $tenantId): User
{
    return User::factory()->create([
        'role' => UserRole::CORPORATE_ADMIN,
        'status' => UserStatus::ACTIVE,
        'tenant_id' => $tenantId,
        'operator_id' => null,
        'access_level' => AccessLevel::CLIENT,
    ]);
}

/** @return array<string, mixed> */
function onboardPayload(array $overrides = []): array
{
    return [
        'registration_number' => 'UG-REG-'.fake()->unique()->numerify('#####'),
        'legal_name' => 'Centenary Bank Ltd',
        'trading_name' => 'Centenary',
        'city' => 'Kampala',
        'country' => 'UG',
        'billing_email' => fake()->unique()->safeEmail(),
        'admin_name' => 'Ada Nakato',
        'admin_email' => fake()->unique()->safeEmail(),
        ...$overrides,
    ];
}

/*
|--------------------------------------------------------------------------
| Path A — nobody holds the number, so the client is new
|--------------------------------------------------------------------------
*/

it('creates the client, the contract and a login in one go', function () {
    $payload = onboardPayload();

    $this->actingAs(onboarder('fleet'), 'sanctum')
        ->postJson('/api/v1/companies', $payload)
        ->assertCreated();

    $company = Company::withoutGlobalScopes()
        ->where('registration_number', $payload['registration_number'])->sole();

    // All four rows, or the client is broken in one of four ways — see the
    // service's docblock. A company with no contract is served by nobody; a
    // client with no administrator is an account nobody can sign into.
    expect(Tenant::query()->whereKey($company->tenant_id)->exists())->toBeTrue()
        ->and(OperatorClient::query()->servedBy(Operator::SHANITAH)->where('tenant_id', $company->tenant_id)->exists())->toBeTrue()
        ->and(User::query()->where('email', $payload['admin_email'])->where('tenant_id', $company->tenant_id)->exists())->toBeTrue();
});

it('gives the client admin a login they must claim, never a password somebody chose', function () {
    $payload = onboardPayload();

    $this->actingAs(onboarder('fleet'), 'sanctum')
        ->postJson('/api/v1/companies', $payload)->assertCreated();

    $admin = User::query()->where('email', $payload['admin_email'])->sole();

    expect($admin->access_level)->toBe(AccessLevel::CLIENT)
        // `users.role` is a slug on the row, not a cast enum — ADR-0004 made a
        // role data, so the column holds the external reference.
        ->and($admin->role)->toBe(UserRole::CORPORATE_ADMIN->value)
        ->and($admin->operator_id)->toBeNull();

    // Nobody at the fleet knows this password, which is the point: the same
    // line Modules/Administration draws for staff and ADR-0018 for a walk-in.
    expect($this->postJson('/api/v1/auth/login', [
        'email' => $payload['admin_email'],
        'password' => 'password',
    ])->status())->not->toBe(200);
});

it('refuses an onboarding with no registration number', function () {
    $payload = onboardPayload();
    unset($payload['registration_number']);

    $this->actingAs(onboarder('fleet'), 'sanctum')
        ->postJson('/api/v1/companies', $payload)
        ->assertStatus(422)
        ->assertJsonValidationErrors(['registration_number']);
});

/**
 * `K5` made the column unique; this is the request rule that stops a second
 * client reaching it, with a message instead of a 500.
 */
it('refuses a number another client already holds', function () {
    $first = onboardPayload();
    $this->actingAs(onboarder('fleet'), 'sanctum')
        ->postJson('/api/v1/companies', $first)->assertCreated();

    $this->actingAs(onboarder('fleet'), 'sanctum')
        ->postJson('/api/v1/companies', onboardPayload(['registration_number' => $first['registration_number']]))
        ->assertStatus(422)
        ->assertJsonValidationErrors(['registration_number']);
});

/*
|--------------------------------------------------------------------------
| Who onboards, and which fleet takes the contract (ADR-0062 §3)
|--------------------------------------------------------------------------
*/

it('makes head office name the fleet, rather than choosing one for them', function () {
    $this->actingAs(onboarder('kangaru'), 'sanctum')
        ->postJson('/api/v1/companies', onboardPayload())
        ->assertStatus(422)
        ->assertJsonValidationErrors(['operator_id']);
});

it('lets head office onboard for a fleet it names', function () {
    $payload = onboardPayload(['operator_id' => Operator::SHANITAH]);

    $this->actingAs(onboarder('kangaru'), 'sanctum')
        ->postJson('/api/v1/companies', $payload)->assertCreated();

    $company = Company::withoutGlobalScopes()
        ->where('registration_number', $payload['registration_number'])->sole();

    expect(OperatorClient::query()->servedBy(Operator::SHANITAH)->where('tenant_id', $company->tenant_id)->exists())
        ->toBeTrue();
});

/**
 * Refused rather than quietly rewritten. Silently substituting the actor's own
 * fleet would let a fleet believe it had onboarded a client for somebody else.
 */
it('refuses a fleet naming another fleet', function () {
    $rival = Operator::create(['name' => 'Rival Transport', 'slug' => 'rival-k6', 'status' => 'active']);

    $this->actingAs(onboarder('fleet'), 'sanctum')
        ->postJson('/api/v1/companies', onboardPayload(['operator_id' => $rival->id]))
        ->assertStatus(422)
        ->assertJsonValidationErrors(['operator_id']);
});

/*
|--------------------------------------------------------------------------
| Path B — the number is taken, so the fleet may only ask
|--------------------------------------------------------------------------
*/

function existingClient(): Company
{
    $payload = onboardPayload();
    test()->actingAs(onboarder('fleet'), 'sanctum')
        ->postJson('/api/v1/companies', $payload)->assertCreated();

    return Company::withoutGlobalScopes()
        ->where('registration_number', $payload['registration_number'])->sole();
}

it('writes a request that carries no fact about the client', function () {
    $client = existingClient();
    $rival = Operator::create(['name' => 'Rival Transport', 'slug' => 'rival-k6b', 'status' => 'active']);

    $raw = $this->actingAs(onboarder('fleet', $rival->id), 'sanctum')
        ->postJson('/api/v1/contracts', ['registration_number' => $client->registration_number])
        ->assertCreated()
        ->getContent();

    // The asking fleet learns exactly what it knew before: the number is
    // taken. Asserted on the raw body so a leak anywhere in the envelope —
    // meta, a message naming the client — is caught.
    foreach ([$client->legal_name, $client->trading_name, $client->city, (string) $client->tenant_id] as $secret) {
        expect($raw)->not->toContain($secret);
    }

    expect(OperatorClient::query()->where('operator_id', $rival->id)->where('tenant_id', $client->tenant_id)->value('status'))
        ->toBe(OperatorClient::REQUESTED);
});

/**
 * **The test that had to be written carefully.**
 *
 * "A requested fleet reads nothing" would pass today for the wrong reason:
 * `operator_client` gates no read on its own, so an **active** contract grants
 * nothing either, and the assertion would prove only that the feature does not
 * exist yet.
 *
 * So it is written as a **comparison**. It gives one fleet an active contract
 * and another a requested one over the same client, and asserts the active
 * fleet is given something the requested fleet is not. If a future change
 * makes an active contract mean more, this test gets stronger by itself; if
 * somebody makes `requested` mean the same as `active`, it goes red.
 */
it('grants a requested fleet nothing that an active one is given', function () {
    $client = existingClient();
    $rival = Operator::create(['name' => 'Rival Transport', 'slug' => 'rival-k6c', 'status' => 'active']);

    $this->actingAs(onboarder('fleet', $rival->id), 'sanctum')
        ->postJson('/api/v1/contracts', ['registration_number' => $client->registration_number])
        ->assertCreated();

    $serving = OperatorClient::query()->servedBy(Operator::SHANITAH)->pluck('tenant_id');
    $asking = OperatorClient::query()->servedBy($rival->id)->pluck('tenant_id');

    expect($serving)->toContain($client->tenant_id)
        ->and($asking)->not->toContain($client->tenant_id);
});

it('does not queue a second request when a fleet asks twice', function () {
    $client = existingClient();
    $rival = Operator::create(['name' => 'Rival Transport', 'slug' => 'rival-k6d', 'status' => 'active']);

    foreach ([1, 2] as $_) {
        $this->actingAs(onboarder('fleet', $rival->id), 'sanctum')
            ->postJson('/api/v1/contracts', ['registration_number' => $client->registration_number])
            ->assertCreated();
    }

    expect(OperatorClient::query()->where('operator_id', $rival->id)->where('tenant_id', $client->tenant_id)->count())
        ->toBe(1);
});

/*
|--------------------------------------------------------------------------
| Who answers (ADR-0060 §5)
|--------------------------------------------------------------------------
*/

function pendingRequest(Company $client, Operator $rival): OperatorClient
{
    test()->actingAs(onboarder('fleet', $rival->id), 'sanctum')
        ->postJson('/api/v1/contracts', ['registration_number' => $client->registration_number])
        ->assertCreated();

    return OperatorClient::query()->where('operator_id', $rival->id)->where('tenant_id', $client->tenant_id)->sole();
}

it('lets the client accept a fleet that asked', function () {
    $client = existingClient();
    $rival = Operator::create(['name' => 'Rival Transport', 'slug' => 'rival-k6e', 'status' => 'active']);
    $contract = pendingRequest($client, $rival);

    $this->actingAs(clientAdmin((int) $client->tenant_id), 'sanctum')
        ->postJson("/api/v1/contracts/{$contract->id}/approval")
        ->assertOk()
        ->assertJsonPath('data.status', OperatorClient::ACTIVE);

    expect(OperatorClient::query()->servedBy($rival->id)->pluck('tenant_id'))->toContain($client->tenant_id);
});

/**
 * The line that stops the whole flow collapsing: a fleet approving its own
 * request would turn ask-and-wait into a self-service read of somebody else's
 * client.
 */
it('refuses the asking fleet its own approval', function () {
    $client = existingClient();
    $rival = Operator::create(['name' => 'Rival Transport', 'slug' => 'rival-k6f', 'status' => 'active']);
    $contract = pendingRequest($client, $rival);

    $this->actingAs(onboarder('fleet', $rival->id), 'sanctum')
        ->postJson("/api/v1/contracts/{$contract->id}/approval")
        ->assertForbidden();

    expect($contract->refresh()->status)->toBe(OperatorClient::REQUESTED);
});

it('refuses head office the approval, which is the client s to give', function () {
    $client = existingClient();
    $rival = Operator::create(['name' => 'Rival Transport', 'slug' => 'rival-k6g', 'status' => 'active']);
    $contract = pendingRequest($client, $rival);

    $this->actingAs(onboarder('kangaru'), 'sanctum')
        ->postJson("/api/v1/contracts/{$contract->id}/approval")
        ->assertForbidden();

    expect($contract->refresh()->status)->toBe(OperatorClient::REQUESTED);
});

it("refuses another client's admin the approval", function () {
    $client = existingClient();
    $other = existingClient();
    $rival = Operator::create(['name' => 'Rival Transport', 'slug' => 'rival-k6h', 'status' => 'active']);
    $contract = pendingRequest($client, $rival);

    $this->actingAs(clientAdmin((int) $other->tenant_id), 'sanctum')
        ->postJson("/api/v1/contracts/{$contract->id}/approval")
        ->assertForbidden();

    expect($contract->refresh()->status)->toBe(OperatorClient::REQUESTED);
});

/*
|--------------------------------------------------------------------------
| Ending it (ADR-0060 §7)
|--------------------------------------------------------------------------
*/

it('ends a contract without ending the client', function () {
    $client = existingClient();
    $contract = OperatorClient::query()->where('tenant_id', $client->tenant_id)->sole();

    $this->actingAs(clientAdmin((int) $client->tenant_id), 'sanctum')
        ->deleteJson("/api/v1/contracts/{$contract->id}")
        ->assertOk();

    // The row stays: the trips and invoices it explains are the client's
    // history, and a year of work attributed to nobody is worse than a row
    // that says "this ended".
    expect($contract->refresh()->status)->toBe(OperatorClient::ENDED)
        ->and($contract->ended_on)->not->toBeNull()
        ->and(Tenant::query()->whereKey($client->tenant_id)->exists())->toBeTrue()
        ->and(Company::withoutGlobalScopes()->whereKey($client->id)->exists())->toBeTrue();
});

it('stops an ended contract counting as serving', function () {
    $client = existingClient();
    $contract = OperatorClient::query()->where('tenant_id', $client->tenant_id)->sole();

    $this->actingAs(clientAdmin((int) $client->tenant_id), 'sanctum')
        ->deleteJson("/api/v1/contracts/{$contract->id}")->assertOk();

    expect(OperatorClient::query()->servedBy(Operator::SHANITAH)->pluck('tenant_id'))
        ->not->toContain($client->tenant_id);
});

/*
|--------------------------------------------------------------------------
| Our fleets — the client's own view
|--------------------------------------------------------------------------
*/

it('shows a client who serves them and who has asked', function () {
    $client = existingClient();
    $rival = Operator::create(['name' => 'Rival Transport', 'slug' => 'rival-k6i', 'status' => 'active']);
    pendingRequest($client, $rival);

    $rows = $this->actingAs(clientAdmin((int) $client->tenant_id), 'sanctum')
        ->getJson('/api/v1/contracts')
        ->assertOk()
        ->json('data');

    expect($rows)->toHaveCount(2);

    // The asking fleet is named, because a client cannot answer a request from
    // somebody anonymous. That disclosure is one-directional and is the point.
    $requested = collect($rows)->firstWhere('status', OperatorClient::REQUESTED);
    expect($requested['fleet']['name'])->toBe('Rival Transport');
});

/**
 * The one surface where a `requested` row is visible, and it is visible to the
 * party being asked and to nobody else. A fleet reading this would learn which
 * of its competitors had asked to serve the same client.
 */
it('refuses a fleet the client s own list of who has asked', function () {
    $client = existingClient();

    $this->actingAs(onboarder('fleet'), 'sanctum')
        ->getJson('/api/v1/contracts')
        ->assertForbidden();
});

it('refuses head office the client s own list', function () {
    $this->actingAs(onboarder('kangaru'), 'sanctum')
        ->getJson('/api/v1/contracts')
        ->assertForbidden();
});
