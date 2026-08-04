<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use Modules\Clients\Models\Company;
use Modules\Vehicles\Models\Vehicle;

/**
 * Free-text search and record-level history on the audit trail.
 *
 * The search exists for one question the structured filters cannot ask:
 * *which field* changed. That is recorded inside `changes`, not in a
 * column, so "who touched the credit limit" was unanswerable — a bank's
 * first question about a trail it has just been shown.
 */
function seedSearchableTrail(): array
{
    $tenant = Tenant::factory()->create(['name' => 'Search Tenant']);

    $admin = User::factory()->create([
        'tenant_id' => $tenant->id,
        'name' => 'Miriam Nabbosa',
        'role' => UserRole::CORPORATE_ADMIN,
    ]);

    // Acting as the admin so the rows carry an actor to search by.
    $company = null;
    test()->actingAs($admin, 'sanctum');

    $company = Company::factory()->forTenant($tenant)->create([
        'legal_name' => 'Search Tenant Ltd',
        'credit_limit_minor' => 100_000,
    ]);

    $company->update(['credit_limit_minor' => 250_000]);

    return compact('tenant', 'admin', 'company');
}

it('finds the row by the name of the field that changed', function () {
    ['admin' => $admin] = seedSearchableTrail();

    $rows = $this->actingAs($admin, 'sanctum')
        ->getJson('/api/v1/audit-logs?q=credit_limit_minor')
        ->assertOk()
        ->json('data');

    // The update row carries credit_limit_minor in its diff; the creation
    // snapshot does too, so both are legitimate matches. What matters is
    // that the field name finds anything at all — it is in no column.
    expect($rows)->not->toBeEmpty();

    foreach ($rows as $row) {
        expect(json_encode($row['changes']))->toContain('credit_limit_minor');
    }
});

it('finds rows by the actor name a reader would recognise', function () {
    ['admin' => $admin, 'company' => $company] = seedSearchableTrail();

    $rows = $this->actingAs($admin, 'sanctum')
        ->getJson('/api/v1/audit-logs?q=Nabbosa')
        ->assertOk()
        ->json('data');

    // The rows this reader acted on are found by their own name.
    $actedOn = collect($rows)->firstWhere('auditable_id', $company->id);
    expect($actedOn)->not->toBeNull();
    expect($actedOn['user']['name'])->toBe('Miriam Nabbosa');

    // Every row matched on the name *somewhere* — either as the actor, or
    // inside the diff. The admin's own user record was created before they
    // could act, so it carries their name in `changes` with a null actor:
    // a legitimate match, and the honest reading of "search the trail for
    // Nabbosa". Asserting an actor on every row would have been asserting
    // the narrower search this deliberately is not.
    foreach ($rows as $row) {
        $haystack = json_encode($row['changes']).($row['user']['name'] ?? '');
        expect($haystack)->toContain('Nabbosa');
    }
});

it('finds rows by an action typed the way it is displayed', function () {
    ['admin' => $admin] = seedSearchableTrail();

    $rows = $this->actingAs($admin, 'sanctum')
        ->getJson('/api/v1/audit-logs?q=updated')
        ->assertOk()
        ->json('data');

    // The update rows are there, which is what somebody typing what they
    // read on screen is after.
    expect(collect($rows)->pluck('action'))->toContain('updated');

    // Creation rows come too, and that is the documented bluntness rather
    // than a bug: a creation snapshot is the whole record, `updated_at`
    // included, so the *text* "updated" genuinely appears in its diff.
    // Anyone wanting only the action has `?action=updated`, which is exact.
    $exact = $this->actingAs($admin, 'sanctum')
        ->getJson('/api/v1/audit-logs?action=updated')
        ->assertOk()
        ->json('data');

    expect(collect($exact)->pluck('action')->unique()->all())->toBe(['updated']);
});

it('narrows rather than widens when combined with another filter', function () {
    ['admin' => $admin] = seedSearchableTrail();

    // The bug this guards is the un-grouped OR: without its own closure the
    // search's ORs escape the surrounding AND and the action filter stops
    // meaning anything, returning every row on the platform.
    $rows = $this->actingAs($admin, 'sanctum')
        ->getJson('/api/v1/audit-logs?q=credit_limit_minor&action=created')
        ->assertOk()
        ->json('data');

    foreach ($rows as $row) {
        expect($row['action'])->toBe('created');
    }
});

it('treats a wildcard in the search box as text, not as a pattern', function () {
    ['admin' => $admin] = seedSearchableTrail();

    // '%' is a LIKE wildcard and would otherwise match every row — a wrong
    // answer that looks like a right one. SearchTerm escapes it.
    $rows = $this->actingAs($admin, 'sanctum')
        ->getJson('/api/v1/audit-logs?q=%25')
        ->assertOk()
        ->json('data');

    expect($rows)->toBeEmpty();
});

it('keeps the search inside the reader\'s own tenant', function () {
    ['admin' => $admin] = seedSearchableTrail();

    // A second tenant with a company whose name would match the search.
    $otherTenant = Tenant::factory()->create(['name' => 'Other Tenant']);
    Company::factory()->forTenant($otherTenant)->create([
        'legal_name' => 'Search Tenant Ltd',
        'credit_limit_minor' => 999_000,
    ]);

    $rows = $this->actingAs($admin, 'sanctum')
        ->getJson('/api/v1/audit-logs?q=credit_limit_minor')
        ->assertOk()
        ->json('data');

    expect($rows)->not->toBeEmpty();

    // Search is a filter, never a way around the scope. Every row still
    // belongs to the reader's own tenant.
    foreach ($rows as $row) {
        expect($row['tenant_id'] ?? null)->not->toBe($otherTenant->id);
    }
});

it('returns one record\'s history when given a type and an id', function () {
    ['admin' => $admin, 'company' => $company] = seedSearchableTrail();

    $rows = $this->actingAs($admin, 'sanctum')
        ->getJson("/api/v1/audit-logs?auditable_type=company&auditable_id={$company->id}")
        ->assertOk()
        ->json('data');

    expect($rows)->not->toBeEmpty();

    foreach ($rows as $row) {
        expect($row['auditable_type'])->toBe('company');
        expect($row['auditable_id'])->toBe($company->id);
    }
});

it('refuses a record id without a record type', function () {
    ['admin' => $admin] = seedSearchableTrail();

    // Ids are per-table. Answering this would interleave Company 3,
    // Vehicle 3 and User 3 and call it one record's history.
    $this->actingAs($admin, 'sanctum')
        ->getJson('/api/v1/audit-logs?auditable_id=3')
        ->assertStatus(422)
        ->assertJsonPath('code', 'VALIDATION_FAILED');
});

it('does not mix two record types that share an id', function () {
    ['tenant' => $tenant, 'admin' => $admin, 'company' => $company] = seedSearchableTrail();

    // A vehicle deliberately given the company's id, so a filter that
    // ignored the type would return both.
    $vehicle = Vehicle::factory()->create(['id' => $company->id]);

    $rows = $this->actingAs($admin, 'sanctum')
        ->getJson("/api/v1/audit-logs?auditable_type=company&auditable_id={$company->id}")
        ->assertOk()
        ->json('data');

    expect($rows)->not->toBeEmpty();
    expect(collect($rows)->pluck('auditable_type')->unique()->all())->toBe(['company']);
    expect($vehicle->id)->toBe($company->id);
});

it('rejects a search term beyond the length bound', function () {
    ['admin' => $admin] = seedSearchableTrail();

    $this->actingAs($admin, 'sanctum')
        ->getJson('/api/v1/audit-logs?q='.str_repeat('a', 121))
        ->assertStatus(422)
        ->assertJsonPath('code', 'VALIDATION_FAILED');
});
