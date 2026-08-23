<?php

declare(strict_types=1);

use App\Enums\AccessLevel;
use App\Enums\UserRole;
use App\Enums\UserStatus;
use App\Models\Operator;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Database\QueryException;
use Modules\Clients\Models\Company;

/**
 * One client, one row (ADR-0060, `K5`).
 *
 * Two things are pinned here and the second is the one that matters. The
 * database must refuse a second row carrying a registration number that is
 * already taken — and the endpoint that lets a fleet *check* must answer a
 * boolean and **nothing else**.
 *
 * A lookup that leaked so much as a legal name would turn an onboarding form
 * into a competitor-intelligence tool while looking like a helpful
 * confirmation, which is the failure mode worth writing a test against rather
 * than a comment.
 */
function lookupActor(string $level = 'fleet'): User
{
    return User::factory()->create([
        'role' => UserRole::SUPER_ADMIN,
        'status' => UserStatus::ACTIVE,
        'tenant_id' => null,
        'operator_id' => $level === 'fleet' ? Operator::SHANITAH : null,
        'access_level' => $level === 'fleet' ? AccessLevel::FLEET : AccessLevel::KANGARU,
    ]);
}

function clientWithNumber(string $number, string $name = 'Centenary Bank Ltd'): Company
{
    return Company::factory()->create([
        'tenant_id' => Tenant::factory()->create()->id,
        'legal_name' => $name,
        'registration_number' => $number,
    ]);
}

it('says a number is taken, without saying whose', function () {
    clientWithNumber('UG-REG-88214', 'Centenary Bank Ltd');

    $body = $this->actingAs(lookupActor(), 'sanctum')
        ->getJson('/api/v1/clients/lookup?registration_number=UG-REG-88214')
        ->assertOk()
        ->json('data');

    expect($body)->toBe(['exists' => true]);
});

it('says a number is free when nobody holds it', function () {
    clientWithNumber('UG-REG-88214');

    $this->actingAs(lookupActor(), 'sanctum')
        ->getJson('/api/v1/clients/lookup?registration_number=UG-REG-00000')
        ->assertOk()
        ->assertJsonPath('data.exists', false);
});

/**
 * **The deliverable.** Not that the endpoint works — that it says nothing
 * else. Asserted against the raw response body rather than the parsed data,
 * so a leak anywhere in the envelope is caught: a name in `meta`, a company
 * in a `included` key, a message naming the client.
 */
it('leaks no name, no address and no hint of who serves them', function () {
    $client = clientWithNumber('UG-REG-88214', 'Centenary Bank Ltd');
    $client->update([
        'trading_name' => 'Centenary',
        'city' => 'Kampala',
        'billing_email' => 'finance@centenary.test',
    ]);

    $raw = $this->actingAs(lookupActor(), 'sanctum')
        ->getJson('/api/v1/clients/lookup?registration_number=UG-REG-88214')
        ->assertOk()
        ->getContent();

    foreach (['Centenary', 'Kampala', 'finance@centenary.test', (string) $client->tenant_id] as $secret) {
        expect($raw)->not->toContain($secret);
    }
});

/**
 * ADR-0060 §3: exact match only. A prefix or partial that matched would be a
 * directory somebody could walk, one character at a time.
 */
it('matches exactly, so it cannot be walked a character at a time', function () {
    clientWithNumber('UG-REG-88214');

    foreach (['UG-REG-8821', 'UG-REG', 'UG-REG-882140', '%'] as $partial) {
        $this->actingAs(lookupActor(), 'sanctum')
            ->getJson('/api/v1/clients/lookup?registration_number='.urlencode($partial))
            ->assertOk()
            ->assertJsonPath('data.exists', false);
    }
});

it('refuses a lookup with no number, so it cannot become a directory dump', function () {
    $this->actingAs(lookupActor(), 'sanctum')
        ->getJson('/api/v1/clients/lookup')
        ->assertStatus(422);
});

it('requires a signed-in caller', function () {
    $this->getJson('/api/v1/clients/lookup?registration_number=UG-REG-88214')
        ->assertUnauthorized();
});

/**
 * The database half. Everything above is a convenience so a fleet does not
 * *reach* the duplicate; this is what makes the duplicate impossible when
 * two fleets try at the same moment and both lookups answered "free".
 */
it('refuses a second client carrying a number already taken', function () {
    clientWithNumber('UG-REG-88214', 'Centenary Bank Ltd');

    expect(fn () => clientWithNumber('UG-REG-88214', 'Centenary Bank Limited'))
        ->toThrow(QueryException::class);
});

/**
 * ADR-0060 §1: *require it on next edit; do not invent one.* The column stays
 * nullable so the rows that predate this keep working — a backfill of
 * generated placeholders would fill the identity key with values that are
 * unique and meaningless, which looks like every client has been identified
 * and is worse than null.
 */
it('still allows the rows that predate it to carry no number at all', function () {
    Company::factory()->create([
        'tenant_id' => Tenant::factory()->create()->id,
        'registration_number' => null,
    ]);

    Company::factory()->create([
        'tenant_id' => Tenant::factory()->create()->id,
        'registration_number' => null,
    ]);

    expect(Company::withoutGlobalScopes()->whereNull('registration_number')->count())
        ->toBeGreaterThanOrEqual(2);
});
