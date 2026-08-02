<?php

use App\Enums\UserRole;
use App\Exceptions\AuditLogImmutableException;
use App\Models\AuditLog;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Modules\Clients\Models\Company;

/**
 * Seeds one tenant with a Company and both a corporate_admin and a
 * corporate_employee user — enough for the diff-content tests and the
 * policy-denial test without needing a second tenant. Safe to call twice
 * in one test: the factories generate independent unique values.
 */
function seedAuditTenant(): array
{
    $tenant = Tenant::factory()->create(['name' => 'Audit Tenant']);

    $company = Company::factory()->forTenant($tenant)->create([
        'legal_name' => 'Audit Tenant Ltd',
        'credit_limit_minor' => 100_000,
    ]);

    $admin = User::factory()->create([
        'tenant_id' => $tenant->id,
        'role' => UserRole::CORPORATE_ADMIN,
    ]);

    $employee = User::factory()->create([
        'tenant_id' => $tenant->id,
        'role' => UserRole::CORPORATE_EMPLOYEE,
    ]);

    return compact('tenant', 'company', 'admin', 'employee');
}

it('logs company creation with a full snapshot and no before value', function () {
    ['company' => $company, 'tenant' => $tenant] = seedAuditTenant();

    $log = AuditLog::allTenants()
        ->where('auditable_type', 'company')
        ->where('auditable_id', $company->id)
        ->where('action', 'created')
        ->first();

    expect($log)->not->toBeNull();
    expect($log->tenant_id)->toBe($tenant->id);
    expect($log->changes['before'])->toBeNull();
    expect($log->changes['after']['legal_name'])->toBe('Audit Tenant Ltd');
});

it('diffs a company update to only the changed field, excluding updated_at', function () {
    ['company' => $company] = seedAuditTenant();

    $company->update(['credit_limit_minor' => 250_000]);

    $log = AuditLog::allTenants()
        ->where('auditable_type', 'company')
        ->where('auditable_id', $company->id)
        ->where('action', 'updated')
        ->latest('id')
        ->first();

    expect($log)->not->toBeNull();
    expect($log->changes['before'])->toBe(['credit_limit_minor' => 100_000]);
    expect($log->changes['after'])->toBe(['credit_limit_minor' => 250_000]);
    expect($log->changes['before'])->not->toHaveKey('updated_at');
    expect($log->changes['after'])->not->toHaveKey('updated_at');
});

it('never records a hidden field on a user audit diff, even when it changed', function () {
    ['admin' => $admin] = seedAuditTenant();

    // Change both `role` (should appear in the diff) and `password` (must
    // never appear, despite genuinely changing) in the same update.
    $admin->update(['role' => UserRole::FINANCE, 'password' => 'a-brand-new-password']);

    $log = AuditLog::allTenants()
        ->where('auditable_type', 'user')
        ->where('auditable_id', $admin->id)
        ->where('action', 'updated')
        ->latest('id')
        ->first();

    expect($log)->not->toBeNull();
    expect($log->changes['after']['role'])->toBe('finance');
    expect($log->changes['before'])->not->toHaveKey('password');
    expect($log->changes['before'])->not->toHaveKey('remember_token');
    expect($log->changes['after'])->not->toHaveKey('password');
    expect($log->changes['after'])->not->toHaveKey('remember_token');
});

it('prevents updating or deleting an audit log entry', function () {
    ['company' => $company] = seedAuditTenant();

    $log = AuditLog::allTenants()->where('auditable_id', $company->id)->firstOrFail();

    expect(fn () => $log->update(['action' => 'tampered']))->toThrow(AuditLogImmutableException::class);
    expect(fn () => $log->delete())->toThrow(AuditLogImmutableException::class);
});

it('excludes another tenant\'s audit log entries from the index', function () {
    ['company' => $companyA, 'admin' => $adminA] = seedAuditTenant();
    ['company' => $companyB] = seedAuditTenant();

    $companyA->update(['credit_limit_minor' => 300_000]);
    $companyB->update(['credit_limit_minor' => 400_000]);

    $response = $this->actingAs($adminA, 'sanctum')->getJson('/api/v1/audit-logs');

    $response->assertOk();

    $auditableIds = collect($response->json('data'))->pluck('auditable_id');
    expect($auditableIds)->toContain($companyA->id);
    expect($auditableIds)->not->toContain($companyB->id);
});

it('forbids a non-admin role from viewing the audit log', function () {
    ['employee' => $employee] = seedAuditTenant();

    $response = $this->actingAs($employee, 'sanctum')->getJson('/api/v1/audit-logs');

    $response->assertStatus(403)->assertJsonPath('code', 'FORBIDDEN');
});

it('rejects an unknown audit log filter with a 422', function () {
    ['admin' => $admin] = seedAuditTenant();

    $response = $this->actingAs($admin, 'sanctum')->getJson('/api/v1/audit-logs?bogus=1');

    $response->assertStatus(422)->assertJsonPath('code', 'VALIDATION_FAILED');
});

it('accepts every audited type as a filter, not just company and user', function () {
    ['admin' => $admin] = seedAuditTenant();

    // The whitelist used to be a hardcoded `company|user` and had not moved
    // since it was written, so filtering for a role change — the mutation
    // AGENTS.md names first under "roles/permissions" — answered 422 for a
    // type the table was full of. It is derived from the morph map now.
    foreach (['role', 'invoice', 'rate_card', 'vehicle_allocation', 'trip'] as $type) {
        $this->actingAs($admin, 'sanctum')
            ->getJson("/api/v1/audit-logs?auditable_type={$type}")
            ->assertOk();
    }

    // Still a whitelist, not a free-for-all.
    $this->actingAs($admin, 'sanctum')
        ->getJson('/api/v1/audit-logs?auditable_type=not_a_model')
        ->assertStatus(422)
        ->assertJsonPath('code', 'VALIDATION_FAILED');
});

it('tells the reader what it may filter on, and whose log this is', function () {
    ['admin' => $admin] = seedAuditTenant();
    $owner = User::factory()->create(['tenant_id' => null, 'role' => UserRole::SUPER_ADMIN]);

    $meta = $this->actingAs($admin, 'sanctum')->getJson('/api/v1/audit-logs')->json('meta');

    // Served so the reader's filter controls hold no copy of the list —
    // a client-side copy is exactly how the whitelist above went stale.
    expect($meta['filters']['auditable_types'])->toContain('role', 'company', 'vehicle_allocation');
    expect($meta['filters']['actions'])->toBe(['created', 'updated', 'deleted']);
    expect($meta['scope'])->toBe('tenant');

    // A platform reader sees every tenant's trail, plus the role changes
    // that carry a null tenant_id and are invisible to a scoped read.
    $ownerMeta = $this->actingAs($owner, 'sanctum')->getJson('/api/v1/audit-logs')->json('meta');
    expect($ownerMeta['scope'])->toBe('platform');
});

it('includes the whole of the end day, not just its midnight', function () {
    ['admin' => $admin, 'company' => $company, 'tenant' => $tenant] = seedAuditTenant();

    app(TenantContext::class)->set($tenant->id);

    // Three entries: before the window, late on its final day, and after.
    $before = AuditLog::create([
        'tenant_id' => $tenant->id, 'user_id' => $admin->id,
        'auditable_type' => 'company', 'auditable_id' => $company->id,
        'action' => 'updated', 'changes' => ['before' => [], 'after' => []],
    ]);
    $before->forceFill(['created_at' => '2026-02-28 12:00:00'])->saveQuietly();

    $lateOnLastDay = AuditLog::create([
        'tenant_id' => $tenant->id, 'user_id' => $admin->id,
        'auditable_type' => 'company', 'auditable_id' => $company->id,
        'action' => 'updated', 'changes' => ['before' => [], 'after' => []],
    ]);
    $lateOnLastDay->forceFill(['created_at' => '2026-03-31 23:47:00'])->saveQuietly();

    $after = AuditLog::create([
        'tenant_id' => $tenant->id, 'user_id' => $admin->id,
        'auditable_type' => 'company', 'auditable_id' => $company->id,
        'action' => 'updated', 'changes' => ['before' => [], 'after' => []],
    ]);
    $after->forceFill(['created_at' => '2026-04-01 00:12:00'])->saveQuietly();

    $ids = collect(
        $this->actingAs($admin, 'sanctum')
            ->getJson('/api/v1/audit-logs?from=2026-03-01&to=2026-03-31')
            ->assertOk()
            ->json('data')
    )->pluck('id');

    // "Every change in March" has to mean the 31st too. Comparing against
    // the bare date would drop that day and quietly under-report.
    expect($ids)->toContain($lateOnLastDay->id);
    expect($ids)->not->toContain($before->id);
    expect($ids)->not->toContain($after->id);
});

it('filters the trail to one actor', function () {
    ['admin' => $admin, 'company' => $company, 'tenant' => $tenant] = seedAuditTenant();

    $other = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::CORPORATE_ADMIN]);
    app(TenantContext::class)->set($tenant->id);

    $mine = AuditLog::create([
        'tenant_id' => $tenant->id, 'user_id' => $admin->id,
        'auditable_type' => 'company', 'auditable_id' => $company->id,
        'action' => 'updated', 'changes' => ['before' => [], 'after' => []],
    ]);
    $theirs = AuditLog::create([
        'tenant_id' => $tenant->id, 'user_id' => $other->id,
        'auditable_type' => 'company', 'auditable_id' => $company->id,
        'action' => 'updated', 'changes' => ['before' => [], 'after' => []],
    ]);

    $ids = collect(
        $this->actingAs($admin, 'sanctum')
            ->getJson("/api/v1/audit-logs?user_id={$other->id}")
            ->assertOk()
            ->json('data')
    )->pluck('id');

    expect($ids)->toContain($theirs->id);
    expect($ids)->not->toContain($mine->id);
});

it('offers the actors who appear in this reader\'s slice, and nobody else\'s', function () {
    ['admin' => $adminA, 'company' => $companyA, 'tenant' => $tenantA] = seedAuditTenant();
    ['admin' => $adminB] = seedAuditTenant();

    app(TenantContext::class)->set($tenantA->id);
    AuditLog::create([
        'tenant_id' => $tenantA->id, 'user_id' => $adminA->id,
        'auditable_type' => 'company', 'auditable_id' => $companyA->id,
        'action' => 'updated', 'changes' => ['before' => [], 'after' => []],
    ]);

    $actors = collect(
        $this->actingAs($adminA, 'sanctum')->getJson('/api/v1/audit-logs')->json('meta.filters.actors')
    )->pluck('value');

    // Served instead of pointing the client at /users, which a custom
    // Auditor role holding only `audit.view` would be refused. Scoped the
    // same way the listing is, so one tenant never learns another's staff.
    expect($actors)->toContain($adminA->id);
    expect($actors)->not->toContain($adminB->id);
});

it('refuses a backwards date range rather than returning nothing', function () {
    ['admin' => $admin] = seedAuditTenant();

    // Silently empty results would read as "nothing happened in March".
    $this->actingAs($admin, 'sanctum')
        ->getJson('/api/v1/audit-logs?from=2026-03-31&to=2026-03-01')
        ->assertStatus(422)
        ->assertJsonValidationErrors('to');

    $this->actingAs($admin, 'sanctum')
        ->getJson('/api/v1/audit-logs?from=31-03-2026')
        ->assertStatus(422)
        ->assertJsonValidationErrors('from');
});
