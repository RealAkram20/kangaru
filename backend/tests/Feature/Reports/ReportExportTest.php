<?php

use App\Enums\UserRole;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Modules\Reports\Enums\ExportFormat;
use Modules\Reports\Enums\ExportStatus;
use Modules\Reports\Exports\CsvReportWriter;
use Modules\Reports\Exports\PdfReportWriter;
use Modules\Reports\Exports\ReportSourceFactory;
use Modules\Reports\Exports\XlsxReportWriter;
use Modules\Reports\Jobs\GenerateReportExport;
use Modules\Reports\Models\ReportExport;

/**
 * The queued exporter. QUEUE_CONNECTION is `sync` under phpunit.xml, so a
 * dispatched job runs inline and the file exists by the time the request
 * returns — which is what lets these assert on real output rather than on
 * a mocked writer.
 */
beforeEach(function () {
    Storage::fake('local');
});

it('accepts an export request with 202 and queues the work', function () {
    ['tenant' => $tenant, 'manager' => $manager] = seedReportFixture();
    Queue::fake();

    $response = $this->actingAs($manager, 'sanctum')
        ->postJson('/api/v1/reports/exports', ['format' => 'csv']);

    // 202, not 201: the row exists, the file it describes does not yet.
    $response->assertStatus(202)
        ->assertJsonPath('data.status', ExportStatus::QUEUED->value)
        ->assertJsonPath('data.format', 'csv')
        ->assertJsonPath('data.is_downloadable', false);

    Queue::assertPushed(GenerateReportExport::class);
});

it('produces a CSV carrying the six data points', function () {
    ['tenant' => $tenant, 'manager' => $manager] = seedReportFixture();

    $trip = completedTrip($tenant, $manager, [
        'minutes' => 95, 'odometer_start' => 42_180, 'odometer_end' => 42_222,
        'origin' => 'Kampala', 'destination' => 'Entebbe Airport',
    ]);

    $this->actingAs($manager, 'sanctum')
        ->postJson('/api/v1/reports/exports', ['format' => 'csv'])
        ->assertStatus(202);

    $export = ReportExport::allTenants()->latest('id')->firstOrFail();

    expect($export->status)->toBe(ExportStatus::COMPLETED);
    expect($export->row_count)->toBe(1);

    $csv = Storage::get($export->path);

    expect($csv)->toStartWith("\xEF\xBB\xBF");  // Excel-on-Windows BOM
    expect($csv)->toContain('Opening odometer (km)');
    expect($csv)->toContain($trip->vehicle->registration_number);
    expect($csv)->toContain('Entebbe Airport');
    expect($csv)->toContain('42180');
    expect($csv)->toContain('1:35');  // 95 minutes as h:mm
});

it('produces a real xlsx workbook, not a renamed CSV', function () {
    ['tenant' => $tenant, 'manager' => $manager] = seedReportFixture();
    completedTrip($tenant, $manager);

    $this->actingAs($manager, 'sanctum')
        ->postJson('/api/v1/reports/exports', ['format' => 'xlsx'])
        ->assertStatus(202);

    $export = ReportExport::allTenants()->latest('id')->firstOrFail();

    expect($export->status)->toBe(ExportStatus::COMPLETED);
    expect($export->path)->toEndWith('.xlsx');

    // An xlsx is a zip; "PK" is the zip local-file-header magic. A CSV with
    // the wrong extension would not start with it.
    expect(substr(Storage::get($export->path), 0, 2))->toBe('PK');
});

it('produces a PDF', function () {
    ['tenant' => $tenant, 'manager' => $manager] = seedReportFixture();
    completedTrip($tenant, $manager);

    $this->actingAs($manager, 'sanctum')
        ->postJson('/api/v1/reports/exports', ['format' => 'pdf'])
        ->assertStatus(202);

    $export = ReportExport::allTenants()->latest('id')->firstOrFail();

    expect($export->status)->toBe(ExportStatus::COMPLETED);
    expect(Storage::get($export->path))->toStartWith('%PDF-');
});

it('honours the report filters when generating the file', function () {
    ['tenant' => $tenant, 'manager' => $manager] = seedReportFixture();

    $old = completedTrip($tenant, $manager, [
        'started_at' => now()->subDays(20), 'destination' => 'Faraway Town',
    ]);
    $recent = completedTrip($tenant, $manager, [
        'started_at' => now()->subDay(), 'destination' => 'Nearby Town',
    ]);

    $this->actingAs($manager, 'sanctum')->postJson('/api/v1/reports/exports', [
        'format' => 'csv',
        'from' => now()->subDays(3)->toDateString(),
        'to' => now()->toDateString(),
    ])->assertStatus(202);

    $csv = Storage::get(ReportExport::allTenants()->latest('id')->firstOrFail()->path);

    expect($csv)->toContain('Nearby Town');
    expect($csv)->not->toContain('Faraway Town');
    expect($recent->id)->not->toBe($old->id);
});

it('downloads a completed export', function () {
    ['tenant' => $tenant, 'manager' => $manager] = seedReportFixture();
    completedTrip($tenant, $manager);

    $this->actingAs($manager, 'sanctum')
        ->postJson('/api/v1/reports/exports', ['format' => 'csv'])
        ->assertStatus(202);

    $export = ReportExport::allTenants()->latest('id')->firstOrFail();

    $this->actingAs($manager, 'sanctum')
        ->get("/api/v1/reports/exports/{$export->id}/download")
        ->assertOk()
        ->assertHeader('content-type', 'text/csv; charset=utf-8');
});

it('refuses to download an export that is still being prepared', function () {
    ['tenant' => $tenant, 'manager' => $manager] = seedReportFixture();
    Queue::fake();

    $this->actingAs($manager, 'sanctum')
        ->postJson('/api/v1/reports/exports', ['format' => 'csv'])
        ->assertStatus(202);

    $export = ReportExport::allTenants()->latest('id')->firstOrFail();

    $this->actingAs($manager, 'sanctum')
        ->getJson("/api/v1/reports/exports/{$export->id}/download")
        ->assertStatus(409)
        ->assertJsonPath('code', 'EXPORT_NOT_READY');
});

it('refuses to download an expired export with a 410 and says why', function () {
    ['tenant' => $tenant, 'manager' => $manager] = seedReportFixture();
    completedTrip($tenant, $manager);

    $this->actingAs($manager, 'sanctum')
        ->postJson('/api/v1/reports/exports', ['format' => 'csv'])
        ->assertStatus(202);

    $export = ReportExport::allTenants()->latest('id')->firstOrFail();
    $export->update(['expires_at' => now()->subDay()]);

    $this->actingAs($manager, 'sanctum')
        ->getJson("/api/v1/reports/exports/{$export->id}/download")
        ->assertStatus(410)
        ->assertJsonPath('code', 'EXPORT_EXPIRED');
});

it('refuses a PDF beyond its row ceiling instead of failing halfway', function () {
    ['tenant' => $tenant, 'manager' => $manager] = seedReportFixture();
    completedTrip($tenant, $manager);
    completedTrip($tenant, $manager);

    // Rather than build thousands of trips, the ceiling is lowered — which
    // is possible only because it comes from config rather than a constant.
    config(['reports.export.row_limits.pdf' => 1]);

    $response = $this->actingAs($manager, 'sanctum')
        ->postJson('/api/v1/reports/exports', ['format' => 'pdf']);

    $response->assertStatus(422)->assertJsonPath('code', 'REPORT_TOO_LARGE');

    // The message has to tell the user what to do about it, not just that
    // it failed (AGENTS.md Error Handling).
    expect($response->json('message'))->toContain('Narrow the date range');

    // Nothing queued, nothing half-written.
    expect(ReportExport::allTenants()->count())->toBe(0);
});

it('lets CSV and XLSX through with no ceiling by default', function () {
    expect(ExportFormat::CSV->rowLimit())->toBeNull();
    expect(ExportFormat::XLSX->rowLimit())->toBeNull();
    expect(ExportFormat::PDF->rowLimit())->toBe(5_000);
});

it('records a failed export with a readable message rather than leaving it spinning', function () {
    ['tenant' => $tenant, 'manager' => $manager] = seedReportFixture();

    $export = ReportExport::create([
        'tenant_id' => $tenant->id,
        'requested_by_user_id' => $manager->id,
        'report' => 'trips',
        'format' => ExportFormat::CSV,
        'status' => ExportStatus::PROCESSING,
        'filters' => [],
    ]);

    // Simulates a worker killed mid-write: handle() never reached its
    // catch, so failed() is the only thing that can clear the row.
    (new GenerateReportExport($export->id))->failed(new RuntimeException('Worker died.'));

    expect($export->fresh()->status)->toBe(ExportStatus::FAILED);
    expect($export->fresh()->error)->toBe('Worker died.');
});

it('lists this tenant\'s recent exports', function () {
    ['tenant' => $tenant, 'manager' => $manager] = seedReportFixture();
    completedTrip($tenant, $manager);

    $this->actingAs($manager, 'sanctum')
        ->postJson('/api/v1/reports/exports', ['format' => 'csv'])
        ->assertStatus(202);

    $this->actingAs($manager, 'sanctum')
        ->getJson('/api/v1/reports/exports')
        ->assertOk()
        ->assertJsonPath('data.0.format', 'csv')
        ->assertJsonPath('data.0.is_downloadable', true);
});

it('rejects an unknown export format', function () {
    ['manager' => $manager] = seedReportFixture();

    $this->actingAs($manager, 'sanctum')
        ->postJson('/api/v1/reports/exports', ['format' => 'docx'])
        ->assertStatus(422)
        ->assertJsonPath('code', 'VALIDATION_FAILED');
});

it('forbids a driver from requesting an export', function () {
    ['tenant' => $tenant] = seedReportFixture();

    $driverUser = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::DRIVER]);

    $this->actingAs($driverUser, 'sanctum')
        ->postJson('/api/v1/reports/exports', ['format' => 'csv'])
        ->assertStatus(403);
});

it('binds the tenant inside the queue worker, which never sees IdentifyTenant', function () {
    ['tenant' => $tenant, 'manager' => $manager] = seedReportFixture();
    completedTrip($tenant, $manager);

    $export = ReportExport::create([
        'tenant_id' => $tenant->id,
        'requested_by_user_id' => $manager->id,
        'report' => 'trips',
        'format' => ExportFormat::CSV,
        'status' => ExportStatus::QUEUED,
        'filters' => [],
    ]);

    // Clear the context the fixture set, so the job is the only thing that
    // can bind it. Without that binding TenantScope fails closed and the
    // file would come out empty.
    app(TenantContext::class)->set(null);

    app(GenerateReportExport::class, ['exportId' => $export->id])
        ->handle(
            app(ReportSourceFactory::class),
            app(TenantContext::class),
            app(CsvReportWriter::class),
            app(XlsxReportWriter::class),
            app(PdfReportWriter::class),
        );

    expect($export->fresh()->row_count)->toBe(1);
});

it('prunes expired export files but keeps the record of who took them', function () {
    ['tenant' => $tenant, 'manager' => $manager] = seedReportFixture();
    completedTrip($tenant, $manager);

    $this->actingAs($manager, 'sanctum')
        ->postJson('/api/v1/reports/exports', ['format' => 'csv'])
        ->assertStatus(202);

    $export = ReportExport::allTenants()->latest('id')->firstOrFail();
    $path = $export->path;
    expect(Storage::exists($path))->toBeTrue();

    $export->update(['expires_at' => now()->subDay()]);

    $this->artisan('reports:prune-exports')->assertSuccessful();

    // File gone, row intact: that a report was taken, by whom and when, is
    // exactly what a bank audit asks about.
    expect(Storage::exists($path))->toBeFalse();
    expect($export->fresh())->not->toBeNull();
    expect($export->fresh()->path)->toBeNull();
    expect($export->fresh()->requested_by_user_id)->toBe($manager->id);
});

it('leaves unexpired exports alone when pruning', function () {
    ['tenant' => $tenant, 'manager' => $manager] = seedReportFixture();
    completedTrip($tenant, $manager);

    $this->actingAs($manager, 'sanctum')
        ->postJson('/api/v1/reports/exports', ['format' => 'csv'])
        ->assertStatus(202);

    $export = ReportExport::allTenants()->latest('id')->firstOrFail();

    $this->artisan('reports:prune-exports')->assertSuccessful();

    expect(Storage::exists($export->fresh()->path))->toBeTrue();
});

it('does not regenerate an export that is already finished', function () {
    ['tenant' => $tenant, 'manager' => $manager] = seedReportFixture();

    $export = ReportExport::create([
        'tenant_id' => $tenant->id,
        'requested_by_user_id' => $manager->id,
        'report' => 'trips',
        'format' => ExportFormat::CSV,
        'status' => ExportStatus::COMPLETED,
        'filters' => [],
        'path' => 'tenants/'.$tenant->id.'/reports/1/done.csv',
        'row_count' => 7,
    ]);

    app(GenerateReportExport::class, ['exportId' => $export->id])
        ->handle(
            app(ReportSourceFactory::class),
            app(TenantContext::class),
            app(CsvReportWriter::class),
            app(XlsxReportWriter::class),
            app(PdfReportWriter::class),
        );

    // A retried delivery must not overwrite a finished file.
    expect($export->fresh()->row_count)->toBe(7);
});
