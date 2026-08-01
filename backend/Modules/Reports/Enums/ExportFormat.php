<?php

namespace Modules\Reports\Enums;

/**
 * The three formats AGENTS.md requires reports to export to.
 */
enum ExportFormat: string
{
    case CSV = 'csv';
    case XLSX = 'xlsx';
    case PDF = 'pdf';

    public function extension(): string
    {
        return $this->value;
    }

    public function mimeType(): string
    {
        return match ($this) {
            self::CSV => 'text/csv',
            self::XLSX => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            self::PDF => 'application/pdf',
        };
    }

    /**
     * CSV and XLSX are written row by row to a file handle, so their memory
     * stays flat no matter how many trips are involved. PDF is not: dompdf
     * builds the whole document in memory before rendering, so a month at
     * target volume would exhaust it.
     *
     * Rather than let that fail halfway through a job, a format may declare
     * a ceiling and be refused above it with an explanation. Null means no
     * limit.
     *
     * Read from config, not hardcoded (AGENTS.md Configuration Driven): the
     * PDF ceiling is an operational setting that will move once real memory
     * numbers are observed in staging.
     */
    public function rowLimit(): ?int
    {
        $limit = config("reports.export.row_limits.{$this->value}");

        return $limit === null ? null : (int) $limit;
    }

    public function label(): string
    {
        return match ($this) {
            self::CSV => 'CSV',
            self::XLSX => 'Excel workbook',
            self::PDF => 'PDF',
        };
    }
}
