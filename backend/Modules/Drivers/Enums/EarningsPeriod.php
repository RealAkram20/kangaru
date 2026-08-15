<?php

namespace Modules\Drivers\Enums;

use Carbon\CarbonImmutable;

/**
 * The three spans a driver reads their earnings over, and how each is bucketed.
 *
 * Modelled on `Modules\Reports\Enums\FinancialPeriod`, which is this
 * codebase's one existing period-bucketing enum, and constrained the same way:
 * **every SQL branch must be valid on both MySQL 8 (CI) and MariaDB 10.4
 * (local)**, so no window functions and no CTEs. `DATE_FORMAT` is the whole
 * toolkit.
 *
 * It is a separate enum rather than a reuse of `FinancialPeriod` for two
 * reasons that are not stylistic. That one has a `YEAR` case and no `HOUR`
 * bucket, because it answers "what did we invoice this quarter" for a finance
 * team; this one needs hourly resolution for a single day and has no use for a
 * year — a driver does not read an annual earnings chart on a phone. And they
 * live in different modules: ADR-0029 is explicit that driver pay is *not*
 * `Modules\Billing`'s "what a client owes", and importing Reports' enum into
 * Drivers would tie a driver's screen to a finance report's release cycle.
 */
enum EarningsPeriod: string
{
    case DAY = 'day';
    case WEEK = 'week';
    case MONTH = 'month';

    /**
     * The start of this period, in the driver's local day.
     *
     * **`$now` must already be in the display timezone.** Passing a UTC
     * instant here yields a UTC-aligned boundary, which is exactly the bug
     * this whole class exists to avoid: `config/app.php` sets the app timezone
     * to UTC, so `startOfDay()` on an unconverted `Carbon::now()` rolls a
     * Kampala driver's day over at 03:00 local and files their evening work
     * under yesterday.
     */
    public function startsAt(CarbonImmutable $now): CarbonImmutable
    {
        return match ($this) {
            self::DAY => $now->startOfDay(),
            // Monday, matching `FinancialPeriod::WEEK`'s `WEEKDAY()` SQL,
            // which is Monday-based. A week that started on a different day
            // in the chart than in the total would be two different weeks.
            self::WEEK => $now->startOfWeek(),
            self::MONTH => $now->startOfMonth(),
        };
    }

    /**
     * The exclusive end of this period.
     *
     * Exclusive rather than `endOfDay()`, and it matters for money: an
     * inclusive `23:59:59` boundary silently drops every entry written in the
     * final second of the period. Half-open `[start, end)` cannot.
     */
    public function endsAt(CarbonImmutable $now): CarbonImmutable
    {
        return match ($this) {
            self::DAY => $now->startOfDay()->addDay(),
            self::WEEK => $now->startOfWeek()->addWeek(),
            self::MONTH => $now->startOfMonth()->addMonth(),
        };
    }

    /**
     * How wide one bar of the trend chart is.
     *
     * A day is read hour by hour — that is the shape of a driving shift, and
     * it is what tells a driver their evenings pay better than their
     * mornings. A week and a month are read day by day: 720 hourly bars on a
     * phone is not a chart, it is a texture.
     */
    public function bucket(): EarningsBucket
    {
        return $this === self::DAY ? EarningsBucket::HOUR : EarningsBucket::DAY;
    }
}
