<?php

use App\Enums\Permission;
use App\Enums\RoleAudience;
use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Modules\Administration\Models\Role;
use Modules\Reports\Enums\ExportFormat;
use Modules\Reports\Enums\ExportStatus;
use Modules\Reports\Enums\ReportType;
use Modules\Reports\Models\ReportExport;

/**
 * Who may see which report.
 *
 * `reports.view` gated all four reports on the assumption that running a
 * report is a single ability. It is not — a report is a view of some data,
 * and the reader has to be entitled to that data too. The assumption held
 * while every report aggregated trips and broke when the financial report
 * started aggregating invoices: `reports.view` and `invoices.view` diverge
 * across four seeded roles, so a Dispatcher refused `/invoices` could read
 * *and export* a client's invoiced, credited and outstanding totals.
 *
 * The export path mattered more than the screen: it produced a downloadable
 * file, addressable by id, of data the caller could not see anywhere else.
 */

/**
 * @return array{tenant: Tenant, user: callable}
 */
function reportAuthFixture(): array
{
    $tenant = Tenant::factory()->create();
    app(TenantContext::class)->set($tenant->id);

    $user = fn (string $role) => User::factory()->create(['tenant_id' => $tenant->id, 'role' => $role]);

    return compact('tenant', 'user');
}

it('refuses the financial report to a role that may run reports but not see invoices', function () {
    ['user' => $user] = reportAuthFixture();

    /*
     * All three hold `reports.view` and not `invoices.view`.
     *
     * `FLEET_OWNER` was here and is deliberately not any more. It now holds
     * the union of the fleet roles, `invoices.view` included, because ADR-0004
     * will not let an administrator hand out a permission they lack — an owner
     * who could not see an invoice could not hire the Finance officer who
     * issues them, and `staff.manage` would have produced an Add colleague
     * button whose every choice was refused.
     *
     * That is a widening of the role and it is the right one: a fleet company
     * bills its own corporate clients (ADR-0055 §5), so its owner reading its
     * own money is the ordinary case rather than an exception. What bounds
     * them is the fleet, not the catalogue (ADR-0065) — the test below is that
     * half.
     */
    foreach ([UserRole::DISPATCHER, UserRole::BRANCH_MANAGER, UserRole::DEPOT_MANAGER] as $role) {
        $actor = $user($role->value);

        $this->actingAs($actor, 'sanctum')
            ->getJson('/api/v1/reports/financial')
            ->assertForbidden();

        // The wider hole: a queued export is a file on disk that outlives
        // the request and is fetched by id.
        $this->actingAs($actor, 'sanctum')
            ->postJson('/api/v1/reports/exports', ['format' => 'xlsx', 'report' => 'financial'])
            ->assertForbidden();
    }
});

it('lets a fleet owner read their own company s financial report', function () {
    ['user' => $user] = reportAuthFixture();

    // The other half of the change above, and the reason it is not simply a
    // relaxation: the owner of a fleet company reads that company's money.
    // Three refusals with nothing granted would pass just as well against a
    // role that had lost `reports.view` altogether.
    $owner = $user(UserRole::FLEET_OWNER->value);

    $this->actingAs($owner, 'sanctum')->getJson('/api/v1/reports/financial')->assertOk();

    $this->actingAs($owner, 'sanctum')
        ->postJson('/api/v1/reports/exports', ['format' => 'xlsx', 'report' => 'financial'])
        ->assertStatus(202);
});

it('still lets those roles run and export the reports they are entitled to', function () {
    ['user' => $user] = reportAuthFixture();
    $dispatcher = $user(UserRole::DISPATCHER->value);

    // The fix must not cost a dispatcher the operational reports — that
    // would trade one wrong answer for another.
    $this->actingAs($dispatcher, 'sanctum')->getJson('/api/v1/reports/trips')->assertOk();
    $this->actingAs($dispatcher, 'sanctum')->getJson('/api/v1/reports/drivers')->assertOk();
    $this->actingAs($dispatcher, 'sanctum')->getJson('/api/v1/reports/vehicles')->assertOk();

    $this->actingAs($dispatcher, 'sanctum')
        ->postJson('/api/v1/reports/exports', ['format' => 'csv', 'report' => 'trips'])
        ->assertStatus(202);
});

it('lets the roles that may see invoices run the financial report', function () {
    ['user' => $user] = reportAuthFixture();

    foreach ([UserRole::FINANCE, UserRole::CORPORATE_ADMIN, UserRole::OPERATIONS_MANAGER] as $role) {
        $actor = $user($role->value);

        $this->actingAs($actor, 'sanctum')->getJson('/api/v1/reports/financial')->assertOk();
        $this->actingAs($actor, 'sanctum')
            ->postJson('/api/v1/reports/exports', ['format' => 'xlsx', 'report' => 'financial'])
            ->assertStatus(202);
    }
});

it('refuses to hand over a finished financial export to someone who may not read one', function () {
    ['tenant' => $tenant, 'user' => $user] = reportAuthFixture();

    $finance = $user(UserRole::FINANCE->value);
    $dispatcher = $user(UserRole::DISPATCHER->value);

    // A completed export, as if Finance had run it earlier.
    $export = ReportExport::create([
        'tenant_id' => $tenant->id,
        'requested_by_user_id' => $finance->id,
        'report' => ReportType::FINANCIAL,
        'format' => ExportFormat::XLSX,
        'status' => ExportStatus::COMPLETED,
        'filters' => [],
        'path' => 'tenants/'.$tenant->id.'/exports/whatever.xlsx',
        'row_count' => 3,
        'expires_at' => now()->addDays(7),
    ]);

    // Gated on what the file holds, not on what was asked for. The id is
    // guessable; the permission is what stops it.
    $this->actingAs($dispatcher, 'sanctum')
        ->getJson("/api/v1/reports/exports/{$export->id}")
        ->assertForbidden();

    $this->actingAs($dispatcher, 'sanctum')
        ->getJson("/api/v1/reports/exports/{$export->id}/download")
        ->assertForbidden();
});

it('leaves an export list showing only the reports its reader may read', function () {
    ['tenant' => $tenant, 'user' => $user] = reportAuthFixture();

    $finance = $user(UserRole::FINANCE->value);
    $dispatcher = $user(UserRole::DISPATCHER->value);

    $make = fn (ReportType $type) => ReportExport::create([
        'tenant_id' => $tenant->id,
        'requested_by_user_id' => $finance->id,
        'report' => $type,
        'format' => ExportFormat::CSV,
        'status' => ExportStatus::COMPLETED,
        'filters' => [],
        'path' => 'tenants/'.$tenant->id.'/exports/'.$type->value.'.csv',
        'row_count' => 1,
        'expires_at' => now()->addDays(7),
    ]);

    $financial = $make(ReportType::FINANCIAL);
    $trips = $make(ReportType::TRIPS);

    $ids = collect(
        $this->actingAs($dispatcher, 'sanctum')->getJson('/api/v1/reports/exports')->assertOk()->json('data')
    )->pluck('id');

    // Filtered, not refused wholesale: the dispatcher keeps their trip
    // exports. An export row also carries the filters it ran with and who
    // ran it, which is itself worth withholding.
    expect($ids)->toContain($trips->id);
    expect($ids)->not->toContain($financial->id);
});

it('holds the line for a custom role, not just the seeded ten', function () {
    ['tenant' => $tenant] = reportAuthFixture();

    // The case ADR-0004 exists for: permissions composed freely. Reports
    // without invoices must behave like a dispatcher, whatever it is called.
    Role::create([
        'slug' => 'regional_analyst',
        'name' => 'Regional Analyst',
        'audience' => RoleAudience::CLIENT,
        'is_system' => false,
        'permissions' => [Permission::REPORTS_VIEW->value, Permission::TRIPS_VIEW_ALL->value],
    ]);

    $analyst = User::factory()->create(['tenant_id' => $tenant->id, 'role' => 'regional_analyst']);

    $this->actingAs($analyst, 'sanctum')->getJson('/api/v1/reports/trips')->assertOk();
    $this->actingAs($analyst, 'sanctum')->getJson('/api/v1/reports/financial')->assertForbidden();

    // And the converse: invoices without reports is the Invoices page, not
    // a financial report. Both permissions are required, not either.
    Role::create([
        'slug' => 'invoice_reader',
        'name' => 'Invoice Reader',
        'audience' => RoleAudience::CLIENT,
        'is_system' => false,
        'permissions' => [Permission::INVOICES_VIEW->value],
    ]);

    $reader = User::factory()->create(['tenant_id' => $tenant->id, 'role' => 'invoice_reader']);

    $this->actingAs($reader, 'sanctum')->getJson('/api/v1/invoices')->assertOk();
    $this->actingAs($reader, 'sanctum')->getJson('/api/v1/reports/financial')->assertForbidden();
});
