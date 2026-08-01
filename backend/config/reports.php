<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Report exports
    |--------------------------------------------------------------------------
    |
    | AGENTS.md, Configuration Driven: limits and retention are operational
    | settings, not constants to be recompiled. They differ between local,
    | staging and production, and the PDF ceiling in particular will move
    | once real memory numbers are observed.
    |
    */

    'export' => [

        /*
         | Maximum trips a single export may cover, per format. Null means no
         | limit: CSV and XLSX are written row by row to disk, so their memory
         | stays flat however many trips are involved.
         |
         | PDF is different — dompdf assembles the whole document in memory
         | before rendering — so it declares a ceiling and requests above it
         | are refused up front with an explanation, rather than a queued job
         | dying halfway through.
         */
        'row_limits' => [
            'csv' => env('REPORT_EXPORT_LIMIT_CSV') === null ? null : (int) env('REPORT_EXPORT_LIMIT_CSV'),
            'xlsx' => env('REPORT_EXPORT_LIMIT_XLSX') === null ? null : (int) env('REPORT_EXPORT_LIMIT_XLSX'),
            'pdf' => (int) env('REPORT_EXPORT_LIMIT_PDF', 5000),
        ],

        /*
         | Generated files hold trip PII, so they are not kept indefinitely.
         | Long enough to fetch one, short enough that copies do not
         | accumulate; the authoritative retention lives on the trips
         | themselves (AGENTS.md Compliance).
         */
        'retention_days' => (int) env('REPORT_EXPORT_RETENTION_DAYS', 7),

    ],

];
