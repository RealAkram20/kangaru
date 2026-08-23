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
 * Which fleets serve a client (owner's decision, 24 August 2026).
 *
 * ADR-0060 §5 gave the contract to the client — *"not Kangaru's"* — and
 * `OperatorClientPolicy::end()` said head office *"is not a party to a
 * contract between two other organisations."* That governed a **fleet asking**
 * to serve somebody else's client, and it is untouched: `ContractController`
 * still asks and the client still answers.
 *
 * What the owner added is the case it did not cover. Head office already names
 * the first fleet when it onboards, so it is already choosing a supplier — and
 * with no way to change that, a client onboarded onto the wrong fleet stayed
 * there for ever.
 *
 * The two properties worth more than the endpoint: **a removed fleet's row
 * survives**, because the invoices it explains are still the client's history
 * (ADR-0060 §7); and **the set is never empty**, because a client with no
 * fleet books and is never dispatched, with nothing anywhere erroring.
 */
function assigningHeadOffice(): User
{
    return User::factory()->create([
        'role' => UserRole::SUPER_ADMIN,
        'status' => UserStatus::ACTIVE,
        'tenant_id' => null,
        'operator_id' => null,
        'access_level' => AccessLevel::KANGARU,
    ]);
}

function clientOnFleets(int ...$operatorIds): Company
{
    $tenant = Tenant::factory()->create();

    $company = Company::withoutGlobalScopes()->create([
        'tenant_id' => $tenant->id,
        'legal_name' => 'Centenary Bank',
        'billing_email' => 'accounts@centenary.test',
        'city' => 'Kampala',
        'country' => 'UG',
        'status' => 'active',
    ]);

    foreach ($operatorIds as $operatorId) {
        OperatorClient::create([
            'operator_id' => $operatorId,
            'tenant_id' => $tenant->id,
            'status' => OperatorClient::ACTIVE,
            'started_on' => now()->subMonth()->toDateString(),
        ]);
    }

    return $company;
}

function anotherFleet(): Operator
{
    return Operator::create(['name' => 'Najjemba Transporters', 'slug' => 'najjemba', 'status' => 'active']);
}

it('adds a second fleet without disturbing the first', function () {
    $rival = anotherFleet();
    $client = clientOnFleets(Operator::SHANITAH);

    $this->actingAs(assigningHeadOffice(), 'sanctum')
        ->putJson("/api/v1/companies/{$client->id}/fleets", [
            'operator_ids' => [Operator::SHANITAH, $rival->id],
        ])
        ->assertOk();

    $active = OperatorClient::query()
        ->where('tenant_id', $client->tenant_id)
        ->where('status', OperatorClient::ACTIVE)
        ->pluck('operator_id');

    expect($active)->toHaveCount(2)
        ->and($active->all())->toEqualCanonicalizing([Operator::SHANITAH, $rival->id]);
});

/**
 * ADR-0060 §7, and the single most important assertion in this file.
 *
 * Deleting the row would strand every invoice raised under that contract
 * against a relationship the database says never existed — and it would do so
 * quietly, because nothing joins back the other way.
 */
it('ends a removed fleet s contract and keeps the row', function () {
    $rival = anotherFleet();
    $client = clientOnFleets(Operator::SHANITAH, $rival->id);

    $this->actingAs(assigningHeadOffice(), 'sanctum')
        ->putJson("/api/v1/companies/{$client->id}/fleets", ['operator_ids' => [$rival->id]])
        ->assertOk();

    $dropped = OperatorClient::query()
        ->where('tenant_id', $client->tenant_id)
        ->where('operator_id', Operator::SHANITAH)
        ->first();

    // Present, and ended — not gone.
    expect($dropped)->not->toBeNull()
        ->and($dropped->status)->toBe(OperatorClient::ENDED)
        ->and($dropped->ended_on)->not->toBeNull();
});

/**
 * The other half of keeping the row: the pair is unique on the table, so a
 * blind insert on re-adding is a duplicate-key 500 the first time anybody
 * changes their mind and changes it back. Which they will.
 */
it('revives an ended contract rather than failing on the unique pair', function () {
    $client = clientOnFleets(Operator::SHANITAH);
    $rival = anotherFleet();
    $actor = assigningHeadOffice();

    // Off…
    $this->actingAs($actor, 'sanctum')
        ->putJson("/api/v1/companies/{$client->id}/fleets", ['operator_ids' => [$rival->id]])
        ->assertOk();

    // …and back on.
    $this->actingAs($actor, 'sanctum')
        ->putJson("/api/v1/companies/{$client->id}/fleets", ['operator_ids' => [Operator::SHANITAH]])
        ->assertOk();

    $rows = OperatorClient::query()
        ->where('tenant_id', $client->tenant_id)
        ->where('operator_id', Operator::SHANITAH)
        ->get();

    expect($rows)->toHaveCount(1)
        ->and($rows->first()->status)->toBe(OperatorClient::ACTIVE)
        // Cleared, or the row claims to have finished before the day it
        // restarted — and every report reading a date range would believe it.
        ->and($rows->first()->ended_on)->toBeNull();
});

it('refuses to leave a client with no fleet at all', function () {
    $client = clientOnFleets(Operator::SHANITAH);

    $this->actingAs(assigningHeadOffice(), 'sanctum')
        ->putJson("/api/v1/companies/{$client->id}/fleets", ['operator_ids' => []])
        ->assertStatus(422)
        ->assertJsonValidationErrors('operator_ids');

    expect(OperatorClient::query()
        ->where('tenant_id', $client->tenant_id)
        ->where('status', OperatorClient::ACTIVE)
        ->count())->toBe(1);
});

/**
 * The line ADR-0060 §4 built the whole ask-and-wait path to defend. If a fleet
 * could reach this endpoint it would add itself to any client on the platform,
 * and the consent flow would be defeated from a different URL without anybody
 * touching it.
 */
it('refuses a fleet the right to put itself on somebody else s client', function () {
    $rival = anotherFleet();
    $client = clientOnFleets(Operator::SHANITAH);

    $fleetOwner = User::factory()->create([
        'role' => UserRole::SUPER_ADMIN,
        'operator_id' => $rival->id,
    ]);

    $this->actingAs($fleetOwner, 'sanctum')
        ->putJson("/api/v1/companies/{$client->id}/fleets", [
            'operator_ids' => [Operator::SHANITAH, $rival->id],
        ])
        ->assertForbidden();

    expect(OperatorClient::query()
        ->where('tenant_id', $client->tenant_id)
        ->where('operator_id', $rival->id)
        ->exists())->toBeFalse();
});

it('refuses a client s own administrator the right to re-source itself', function () {
    $rival = anotherFleet();
    $client = clientOnFleets(Operator::SHANITAH);

    $admin = User::factory()->create([
        'tenant_id' => $client->tenant_id,
        'role' => UserRole::CORPORATE_ADMIN,
    ]);

    // They hold `companies.update` for their own profile, which is exactly why
    // this is worth asserting: re-sourcing yourself onto a fleet that has not
    // agreed is not a profile edit. A client wanting a new fleet answers that
    // fleet's request, which is `ContractController`.
    $this->actingAs($admin, 'sanctum')
        ->putJson("/api/v1/companies/{$client->id}/fleets", ['operator_ids' => [$rival->id]])
        ->assertForbidden();
});

/* ------------------------------------------------- and what it discloses --- */

it('tells head office who serves each client, and tells a fleet nothing of the sort', function () {
    $rival = anotherFleet();
    clientOnFleets(Operator::SHANITAH, $rival->id);

    $forHeadOffice = $this->actingAs(assigningHeadOffice(), 'sanctum')
        ->getJson('/api/v1/companies')->assertOk()->json('data');

    expect($forHeadOffice[0])->toHaveKey('served_by')
        ->and($forHeadOffice[0]['served_by'])->toHaveCount(2);

    /*
     * ADR-0060 §4, the one disclosure the whole design refuses: a fleet must
     * not learn **which of its competitors also serves its client**.
     *
     * The key is absent rather than empty. An empty array would read as
     * "nobody serves them", which is a different and equally wrong answer —
     * and it is the shape a `when()` returning `[]` would have produced.
     */
    $shanitahStaff = User::factory()->create([
        'role' => UserRole::SUPER_ADMIN,
        'operator_id' => Operator::SHANITAH,
    ]);

    $forFleet = $this->actingAs($shanitahStaff, 'sanctum')
        ->getJson('/api/v1/companies')->assertOk()->json('data');

    expect($forFleet)->not->toBeEmpty()
        ->and($forFleet[0])->not->toHaveKey('served_by');
});
