<?php

namespace Modules\Reports\Console;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;
use Modules\Reports\Models\ReportExport;

/**
 * Deletes expired export files.
 *
 * Generated reports contain trip PII (passenger names, routes, times), so
 * they are not kept indefinitely — AGENTS.md Compliance requires a written
 * retention policy, and a retention policy nothing enforces is a document,
 * not a control.
 *
 * The row is kept and marked expired rather than deleted: that a report was
 * taken, by whom and when, is exactly the kind of thing a bank audit asks
 * about, and destroying the record along with the file would answer it with
 * silence.
 */
class PruneReportExports extends Command
{
    protected $signature = 'reports:prune-exports {--dry-run : List what would be deleted without deleting it}';

    protected $description = 'Delete generated report files whose retention period has passed';

    public function handle(): int
    {
        $dryRun = (bool) $this->option('dry-run');

        // allTenants(): a scheduled command never passes through
        // IdentifyTenant, and TenantScope fails closed, so without this the
        // prune would silently do nothing forever (ADR-0001 escape hatch).
        $expired = ReportExport::allTenants()
            ->whereNotNull('path')
            ->whereNotNull('expires_at')
            ->where('expires_at', '<=', now())
            ->get();

        if ($expired->isEmpty()) {
            $this->info('No expired report exports.');

            return self::SUCCESS;
        }

        $deleted = 0;

        foreach ($expired as $export) {
            $this->line(($dryRun ? '[dry run] ' : '').'Removing export #'.$export->id.' — '.$export->path);

            if ($dryRun) {
                continue;
            }

            if (Storage::exists($export->path)) {
                Storage::delete($export->path);
            }

            // The row survives, minus the file: the audit trail of who
            // exported what stays intact.
            $export->update(['path' => null, 'file_size' => null]);
            $deleted++;
        }

        $this->info($dryRun
            ? $expired->count().' export(s) would be removed.'
            : $deleted.' expired export(s) removed.');

        return self::SUCCESS;
    }
}
