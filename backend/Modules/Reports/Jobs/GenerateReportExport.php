<?php

namespace Modules\Reports\Jobs;

use App\Support\Tenancy\TenantContext;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Modules\Reports\Enums\ExportFormat;
use Modules\Reports\Enums\ExportStatus;
use Modules\Reports\Events\ReportExportCompleted;
use Modules\Reports\Exports\CsvReportWriter;
use Modules\Reports\Exports\PdfReportWriter;
use Modules\Reports\Exports\ReportSourceFactory;
use Modules\Reports\Exports\XlsxReportWriter;
use Modules\Reports\Models\ReportExport;
use Throwable;

/**
 * Produces the report file off the request cycle — AGENTS.md: "Reports
 * generate asynchronously via queue; nothing over 3 s blocks a request."
 *
 * Carries the export id rather than the model so the job always reads the
 * current row: a queued job can sit for minutes, and a serialised model
 * would restore whatever the row looked like when it was dispatched.
 */
class GenerateReportExport implements ShouldQueue
{
    use Queueable;

    /**
     * A month at target volume is a long write. Retried once, because a
     * transient database blip is worth a second attempt and a genuine
     * failure is not worth ten.
     */
    public int $tries = 2;

    public int $timeout = 900;

    public function __construct(public readonly int $exportId) {}

    public function handle(
        ReportSourceFactory $sources,
        TenantContext $tenant,
        CsvReportWriter $csv,
        XlsxReportWriter $xlsx,
        PdfReportWriter $pdf,
    ): void {
        // Queue workers never pass through IdentifyTenant, and TenantScope
        // fails closed, so the export is looked up across tenants by id and
        // its own tenant is then bound for everything that follows. Every
        // read after this line is scoped to that tenant.
        $export = ReportExport::allTenants()->find($this->exportId);

        if ($export === null || $export->status !== ExportStatus::QUEUED) {
            // Already handled, or deleted while queued. Not an error.
            return;
        }

        $tenant->set($export->tenant_id);

        $export->update(['status' => ExportStatus::PROCESSING, 'started_at' => now()]);

        $localPath = tempnam(sys_get_temp_dir(), 'kr-report-');

        try {
            $writer = match ($export->format) {
                ExportFormat::CSV => $csv,
                ExportFormat::XLSX => $xlsx,
                ExportFormat::PDF => $pdf,
            };

            // Resolved after the tenant is bound: the source runs
            // tenant-scoped queries the moment it is asked for rows.
            $source = $sources->for($export->report);
            $rows = $writer->write($source, $localPath, $export->filters, $source->summary($export->filters));

            $storedPath = $export->buildPath($this->filename($export));

            // Written to the disk as a stream so the file is never held in
            // memory a second time on its way to R2.
            $handle = fopen($localPath, 'rb');

            // A failed open would otherwise be passed to Storage::put() as
            // `false`, which stores an empty file and reports success — an
            // export the user can download and that contains nothing.
            if ($handle === false) {
                throw new \RuntimeException("Could not reopen {$localPath} to upload the export.");
            }

            Storage::put($storedPath, $handle);
            fclose($handle);

            $export->update([
                'status' => ExportStatus::COMPLETED,
                'path' => $storedPath,
                'row_count' => $rows,
                'file_size' => Storage::size($storedPath),
                'finished_at' => now(),
                'expires_at' => now()->addDays((int) config('reports.export.retention_days')),
            ]);

            Log::info('report.export.generated', [
                'module' => 'Reports',
                'tenant_id' => $export->tenant_id,
                'export_id' => $export->id,
                'format' => $export->format->value,
                'rows' => $rows,
            ]);

            // After the row is `completed` and the file is on the disk, so a
            // notification saying it is ready cannot arrive ahead of it.
            // `requestedBy` is loaded here rather than left to the listener
            // because that runs with whatever tenant this worker last bound.
            ReportExportCompleted::dispatch($export->load('requestedBy'));
        } catch (Throwable $e) {
            // The message is shown to the user, so it must explain rather
            // than leak a stack trace (AGENTS.md Error Handling).
            $export->update([
                'status' => ExportStatus::FAILED,
                'error' => $e->getMessage(),
                'finished_at' => now(),
            ]);

            Log::error('report.export.failed', [
                'module' => 'Reports',
                'tenant_id' => $export->tenant_id,
                'export_id' => $export->id,
                'exception' => $e::class,
                'message' => $e->getMessage(),
            ]);

            throw $e;
        } finally {
            if (file_exists($localPath)) {
                unlink($localPath);
            }
        }
    }

    private function filename(ReportExport $export): string
    {
        $filters = $export->filters;

        return sprintf(
            'kangaruride-%s-report-%s-to-%s.%s',
            $export->report->slug(),
            self::filenameDate($filters['from'] ?? null),
            self::filenameDate($filters['to'] ?? null),
            $export->format->extension(),
        );
    }

    /**
     * "all" when the bound is absent or unparseable. `strtotime` answers
     * false rather than throwing, and passing that to `date()` would name
     * the file after 1 Jan 1970.
     */
    private static function filenameDate(mixed $value): string
    {
        if (! is_string($value)) {
            return 'all';
        }

        $timestamp = strtotime($value);

        return $timestamp === false ? 'all' : date('Y-m-d', $timestamp);
    }

    /**
     * Runs after the final attempt. `handle()` already recorded the failure
     * on the row, but a job that dies without reaching its catch — timeout,
     * worker kill — would otherwise leave the export stuck on "processing"
     * forever, showing a spinner nobody can clear.
     */
    public function failed(?Throwable $e): void
    {
        $export = ReportExport::allTenants()->find($this->exportId);

        if ($export === null || $export->status->isTerminal()) {
            return;
        }

        $export->update([
            'status' => ExportStatus::FAILED,
            'error' => $e?->getMessage() ?? 'The export stopped unexpectedly. Please try again.',
            'finished_at' => now(),
        ]);
    }
}
