<?php

namespace Modules\Reports\Exports;

/**
 * Renders the filtered date range for a document header.
 *
 * Shared by every report because they all filter on the same two keys, and
 * because the one thing that must not vary is how an unparseable date is
 * handled: `strtotime` answers `false` rather than throwing, and feeding
 * that to `date()` prints 1 Jan 1970 on a document a bank is reconciling
 * against.
 */
final class ReportPeriod
{
    /**
     * @param  array<string, mixed>  $filters
     */
    public static function describe(array $filters, string $verb = 'Trips commencing'): string
    {
        $from = self::humanDate($filters['from'] ?? null) ?? 'the beginning';
        $to = self::humanDate($filters['to'] ?? null) ?? 'today';

        return "{$verb} {$from} to {$to}";
    }

    public static function humanDate(mixed $value): ?string
    {
        if (! is_string($value) && ! is_int($value)) {
            return null;
        }

        $timestamp = is_int($value) ? $value : strtotime($value);

        return $timestamp === false ? null : date('j M Y', $timestamp);
    }
}
