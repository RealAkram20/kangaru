<?php

namespace Modules\Reports\Enums;

/**
 * How the financial report buckets its rows.
 *
 * PROJECT.md's Reports module asks for "daily, weekly, monthly and annual
 * reports". This is that cadence, applied to the one report where a period
 * is the row rather than a filter — the trip, driver and vehicle reports
 * are a row per thing, so a cadence would have nothing to bucket.
 *
 * Each bucket is produced by the database as a string that sorts
 * chronologically, so rows can be ordered by the bucket itself without a
 * second date column — and, more importantly, the same expression buckets
 * invoices and credit notes, which is what lets two separate queries be
 * merged period by period rather than joined.
 */
enum FinancialPeriod: string
{
    case DAY = 'day';
    case WEEK = 'week';
    case MONTH = 'month';
    case YEAR = 'year';

    /**
     * The default when a request does not ask for one.
     *
     * Monthly, because AGENTS.md and PROJECT.md both describe billing as a
     * monthly cycle ("Invoice generation <= 1 business day after month
     * close"), so it is the period a finance user is reconciling.
     *
     * @param  array<string, mixed>  $filters
     */
    public static function fromFilters(array $filters): self
    {
        $value = $filters['group_by'] ?? null;

        return (is_string($value) ? self::tryFrom($value) : null) ?? self::MONTH;
    }

    /**
     * The grouping expression for a timestamp column.
     *
     * `$column` is interpolated into SQL, so it is never user input — every
     * call site passes a literal. The user-supplied part of this is the
     * enum case, which can only be one of four values because
     * FinancialReportRequest validates it with Rule::enum before it is ever
     * read.
     *
     * Every branch is valid on both MySQL 8 (CI) and MariaDB 10.4 (local):
     * DATE_FORMAT, DATE_SUB and WEEKDAY behave identically on both, and
     * nothing here needs a window function or a CTE.
     *
     * Weeks are keyed by the Monday that starts them rather than by a
     * YEARWEEK number. `202631` is not a date a reader can place, and
     * YEARWEEK also stops sorting as a plain string across a year boundary
     * where week 1 is partial — a Monday date does both jobs.
     */
    public function sqlExpression(string $column): string
    {
        return match ($this) {
            self::DAY => "DATE_FORMAT({$column}, '%Y-%m-%d')",
            self::WEEK => "DATE_FORMAT(DATE_SUB({$column}, INTERVAL WEEKDAY({$column}) DAY), '%Y-%m-%d')",
            self::MONTH => "DATE_FORMAT({$column}, '%Y-%m')",
            self::YEAR => "DATE_FORMAT({$column}, '%Y')",
        };
    }

    /**
     * Renders a bucket key for the report's Period column.
     *
     * Falls back to the raw key rather than inventing a date when it cannot
     * be parsed — the same rule ReportPeriod follows and for the same
     * reason: `strtotime` answers `false` instead of throwing, and passing
     * that to `date()` prints 1 Jan 1970 onto a document a bank is
     * reconciling against.
     */
    public function label(string $bucket): string
    {
        $timestamp = strtotime(match ($this) {
            self::DAY, self::WEEK => $bucket,
            self::MONTH => $bucket.'-01',
            self::YEAR => $bucket.'-01-01',
        });

        if ($timestamp === false) {
            return $bucket;
        }

        return match ($this) {
            self::DAY => date('j M Y', $timestamp),
            self::WEEK => 'Week of '.date('j M Y', $timestamp),
            self::MONTH => date('M Y', $timestamp),
            self::YEAR => date('Y', $timestamp),
        };
    }

    /** Reads into "…, by month" on the document header. */
    public function noun(): string
    {
        return $this->value;
    }
}
