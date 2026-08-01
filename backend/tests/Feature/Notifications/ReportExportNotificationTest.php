<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Illuminate\Support\Facades\Storage;
use Modules\Notifications\Enums\NotificationType;
use Modules\Notifications\Models\Notification;
use Modules\Reports\Enums\ExportStatus;
use Modules\Reports\Exports\CsvReportWriter;
use Modules\Reports\Exports\PdfReportWriter;
use Modules\Reports\Exports\ReportSourceFactory;
use Modules\Reports\Exports\XlsxReportWriter;
use Modules\Reports\Jobs\GenerateReportExport;
use Modules\Reports\Models\ReportExport;

/**
 * Closes the gap Modules/Reports names in its own deferred list: an export
 * returns 202 and finishes later, so until now the only way to learn it was
 * ready was to leave the page open and let it poll.
 *
 * The notification is asserted off a real queued export — the job runs
 * inline under QUEUE_CONNECTION=sync — rather than by dispatching the event
 * by hand. Dispatching it by hand would pass even if the job never raised
 * it, which is the only thing worth testing here.
 */
it('tells the requester when their export is ready', function () {
    Storage::fake('local');

    $tenant = Tenant::factory()->create();
    app(TenantContext::class)->set($tenant->id);

    $manager = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::OPERATIONS_MANAGER]);

    $this->actingAs($manager, 'sanctum')
        ->postJson('/api/v1/reports/exports', ['report' => 'trips', 'format' => 'csv'])
        ->assertStatus(202);

    $export = ReportExport::latest('id')->firstOrFail();
    expect($export->status)->toBe(ExportStatus::COMPLETED);

    $notification = Notification::query()->for($manager)->firstOrFail();

    expect($notification->type)->toBe(NotificationType::REPORT_EXPORT_READY);
    expect($notification->subject)->toContain('Trip report');
    expect($notification->url)->toBe('/reports');
    expect($notification->context['export_id'])->toBe($export->id);
    // The retention window is in the message because the file is pruned on
    // a schedule while the row outlives it — a recipient reading this in a
    // fortnight would otherwise follow a dead link with no explanation.
    expect($notification->body)->toContain('days');
});

it('does not announce an export that failed', function () {
    Storage::fake('local');

    $tenant = Tenant::factory()->create();
    app(TenantContext::class)->set($tenant->id);

    $manager = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::OPERATIONS_MANAGER]);

    // An unknown report type on the row makes the job throw when it
    // resolves the source. A failed export already surfaces on the export
    // list with its reason; telling somebody a file is ready when it is not
    // is the one thing this must never do.
    $export = ReportExport::create([
        'tenant_id' => $tenant->id,
        'requested_by_user_id' => $manager->id,
        'report' => 'trips',
        'format' => 'csv',
        'status' => ExportStatus::QUEUED,
        'filters' => ['from' => 'not-a-date-at-all'],
    ]);

    // Force the failure path deterministically rather than relying on a
    // malformed filter happening to throw.
    Storage::shouldReceive('put')->andThrow(new RuntimeException('disk full'));
    Storage::shouldReceive('size')->andReturn(0);

    try {
        app(GenerateReportExport::class, ['exportId' => $export->id])
            ->handle(
                app(ReportSourceFactory::class),
                app(TenantContext::class),
                app(CsvReportWriter::class),
                app(XlsxReportWriter::class),
                app(PdfReportWriter::class),
            );
    } catch (Throwable) {
        // The job rethrows so the queue can retry; the assertion is about
        // what was and was not announced.
    }

    expect($export->refresh()->status)->toBe(ExportStatus::FAILED);
    expect(Notification::query()->for($manager)->count())->toBe(0);
});
