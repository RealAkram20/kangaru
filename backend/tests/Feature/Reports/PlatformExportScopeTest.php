<?php

use App\Enums\UserRole;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Illuminate\Support\Facades\Storage;
use Modules\Notifications\Models\Notification;
use Modules\Reports\Enums\ReportType;
use Modules\Reports\Exports\ReportSourceFactory;
use Modules\Reports\Models\ReportExport;
use Modules\Reports\Support\ReportScope;
use Tests\Support\BillingFixtures;

/**
 * ADR-0007 rule 4: an export carries the tenant it was run **for**.
 *
 * The read path is `PlatformReportScopeTest`. This is the write, and it
 * failed differently and worse: `ReportExport` is `BelongsToTenant` and
 * took its tenant from the requester, so a platform actor — who has none —
 * produced `Column 'tenant_id' cannot be null` out of the insert. Measured
 * on 3 August 2026, before this change, `POST /reports/exports` was a
 * **500** for platform staff. Not an information leak (with `APP_DEBUG`
 * off the handler returns the ordinary `SERVER_ERROR` envelope) but an
 * unhandled integrity violation sitting behind a button on the Super Admin
 * demo.
 *
 * `BindSubjectTenant` cannot help here and that is the whole difficulty:
 * every other platform write in ADR-0006 acts on a record whose tenant can
 * be read, and an export request names a report and a date range.
 */

/**
 * @return array<string, mixed>
 */
function clientAndPlatformExporters(): array
{
    $fixture = BillingFixtures::tenantWithRateCard();

    $trip = BillingFixtures::completedTrip(
        $fixture['tenant'], $fixture['dispatcher'], $fixture['vehicle'], $fixture['driver'],
    );

    test()->withHeader('Idempotency-Key', 'idem-export-scope')
        ->actingAs($fixture['finance'], 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/invoice")
        ->assertStatus(201);

    $superadmin = User::factory()->create(['tenant_id' => null, 'role' => UserRole::SUPER_ADMIN]);
    $platformFinance = User::factory()->create(['tenant_id' => null, 'role' => UserRole::FINANCE]);

    app(TenantContext::class)->set(null);

    return [...$fixture, 'trip' => $trip, 'superadmin' => $superadmin, 'platformFinance' => $platformFinance];
}

it('no longer answers 500 when platform staff request an export', function () {
    ['platformFinance' => $finance, 'tenant' => $tenant] = clientAndPlatformExporters();

    Storage::fake('local');

    // The exact request that was a 500. It is now a 202, and the reason it
    // is a 202 rather than a 422 is that the actor named the client.
    $this->actingAs($finance, 'sanctum')
        ->postJson('/api/v1/reports/exports', [
            'report' => 'financial',
            'format' => 'csv',
            'tenant_id' => $tenant->id,
        ])
        ->assertStatus(202);
});

it('files a platform export of one client\'s report in that client\'s tenant', function () {
    ['platformFinance' => $finance, 'tenant' => $tenant] = clientAndPlatformExporters();

    Storage::fake('local');

    $this->actingAs($finance, 'sanctum')
        ->postJson('/api/v1/reports/exports', [
            'report' => 'financial',
            'format' => 'csv',
            'tenant_id' => $tenant->id,
        ])
        ->assertStatus(202);

    $export = ReportExport::allTenants()->latest('id')->firstOrFail();

    // The requester has no tenant; the export has the client's. That is
    // rule 4 — "a platform export of a client's financial report is that
    // client's export and belongs in their tenant".
    expect($finance->tenant_id)->toBeNull();
    expect($export->tenant_id)->toBe($tenant->id);
    expect($export->requested_by_user_id)->toBe($finance->id);
    expect($export->spansAllClients())->toBeFalse();
});

it('records a platform-wide fleet export as belonging to no client', function () {
    ['superadmin' => $superadmin] = clientAndPlatformExporters();

    Storage::fake('local');

    $this->actingAs($superadmin, 'sanctum')
        ->postJson('/api/v1/reports/exports', ['report' => 'drivers', 'format' => 'csv'])
        ->assertStatus(202);

    $export = ReportExport::allTenants()->latest('id')->firstOrFail();

    // Null here is a statement, not an omission: the driver report spans
    // every client for platform staff (rule 3), so there is no one client
    // this file is about.
    expect($export->tenant_id)->toBeNull();
    expect($export->spansAllClients())->toBeTrue();
});

it('keeps a platform-wide export out of the tenant storage tree', function () {
    ['superadmin' => $superadmin] = clientAndPlatformExporters();

    Storage::fake('local');

    $this->actingAs($superadmin, 'sanctum')
        ->postJson('/api/v1/reports/exports', ['report' => 'drivers', 'format' => 'csv'])
        ->assertStatus(202);

    $export = ReportExport::allTenants()->latest('id')->firstOrFail();

    // Interpolating a null tenant would have produced `tenants//reports/…`
    // — a path belonging to nobody that every platform export would then
    // share a prefix with.
    expect($export->path)->toStartWith('platform/reports/');
    expect($export->path)->not->toContain('tenants//');
});

it('still files a client\'s own export in their tenant, unchanged', function () {
    ['finance' => $clientFinance, 'tenant' => $tenant] = clientAndPlatformExporters();

    Storage::fake('local');

    $this->actingAs($clientFinance, 'sanctum')
        ->postJson('/api/v1/reports/exports', ['report' => 'financial', 'format' => 'csv'])
        ->assertStatus(202);

    $export = ReportExport::allTenants()->latest('id')->firstOrFail();

    expect($export->tenant_id)->toBe($tenant->id);
    expect($export->path)->toStartWith("tenants/{$tenant->id}/reports/");
});

// ── Rule 5: the file says whose figures it holds ─────────────────────────

/**
 * "An exported PDF that does not name whose figures it contains is the
 * document that ends up in the wrong meeting" — ADR-0007 rule 5, and the
 * same reasoning that makes rule 2 refuse a cross-client total outright.
 *
 * Asserted through the source's own header cells rather than by parsing a
 * rendered PDF: `summaryCells()` is the single definition both the XLSX and
 * the PDF writer render, so a scope present here is present in both.
 */
it('names the client in the header of an export scoped to one', function () {
    ['tenant' => $tenant] = clientAndPlatformExporters();

    $cells = app(ReportSourceFactory::class)
        ->for(ReportType::FINANCIAL, ReportScope::tenant($tenant->id))
        ->summaryCells(['invoices' => 0, 'invoiced_minor' => 0, 'credit_notes' => 0,
            'credited_minor' => 0, 'outstanding_minor' => 0, 'payments_recorded' => false]);

    $scope = collect($cells)->firstWhere('label', 'Scope');

    // The client's name, not "Client #3" — an id is not something a reader
    // in that meeting can check.
    expect($scope)->not->toBeNull();
    expect($scope['value'])->toBe($tenant->name);
});

it('says so on the header of an export that spans every client', function () {
    clientAndPlatformExporters();

    foreach ([ReportType::DRIVERS, ReportType::TRIPS] as $type) {
        $source = app(ReportSourceFactory::class)
            ->for($type, ReportScope::allClients());

        $cells = $source->summaryCells($source->summary([]));

        expect(collect($cells)->firstWhere('label', 'Scope')['value'])->toBe('All clients');
    }
});

// ── The notification that follows ────────────────────────────────────────

/**
 * ADR-0006 recorded a platform user's empty inbox as fail-closed rather
 * than as having no mail, and deferred it to this decision because "the
 * notification that matters is 'your export is ready'". This is that.
 */
it('delivers the export-ready notification to a platform requester', function () {
    ['superadmin' => $superadmin] = clientAndPlatformExporters();

    Storage::fake('local');

    // QUEUE_CONNECTION is sync in tests, so the job and its event run
    // inline and the notification exists by the time this returns.
    $this->actingAs($superadmin, 'sanctum')
        ->postJson('/api/v1/reports/exports', ['report' => 'drivers', 'format' => 'csv'])
        ->assertStatus(202);

    $notifications = Notification::allTenants()->where('user_id', $superadmin->id)->get();

    // Before this change the channel dropped the row on the floor for any
    // recipient with no tenant, so this was zero and the user polled a page
    // for a file that had finished.
    expect($notifications)->toHaveCount(1);
    expect($notifications->first()->tenant_id)->toBeNull();
});

it('shows a platform user their own inbox through the API', function () {
    ['superadmin' => $superadmin] = clientAndPlatformExporters();

    Storage::fake('local');

    $this->actingAs($superadmin, 'sanctum')
        ->postJson('/api/v1/reports/exports', ['report' => 'drivers', 'format' => 'csv'])
        ->assertStatus(202);

    $response = $this->actingAs($superadmin, 'sanctum')
        ->getJson('/api/v1/notifications')
        ->assertOk();

    // The read side of the same problem: the row existing is not enough if
    // TenantScope still fails closed on the way out.
    expect($response->json('data'))->toHaveCount(1);
    expect($response->json('meta.unread'))->toBe(1);
});

/**
 * The mirror, and the reason `scopeFor` narrowing on `user_id` first is
 * load-bearing. Dropping the tenant scope for platform staff must not turn
 * their inbox into everybody's.
 */
it('does not show a platform user another person\'s notifications', function () {
    ['superadmin' => $superadmin, 'finance' => $clientFinance, 'tenant' => $tenant] = clientAndPlatformExporters();

    Storage::fake('local');

    // A client's own export, and therefore a client's own notification.
    $this->actingAs($clientFinance, 'sanctum')
        ->postJson('/api/v1/reports/exports', ['report' => 'financial', 'format' => 'csv'])
        ->assertStatus(202);

    expect(Notification::allTenants()->where('user_id', $clientFinance->id)->count())->toBe(1);

    app(TenantContext::class)->set(null);

    $response = $this->actingAs($superadmin, 'sanctum')
        ->getJson('/api/v1/notifications')
        ->assertOk();

    // The Super Admin reads across every tenant everywhere else in the
    // platform. Not here: an inbox is one person's, and no role reads
    // another's.
    expect($response->json('data'))->toBeEmpty();
    expect($response->json('meta.unread'))->toBe(0);
});
