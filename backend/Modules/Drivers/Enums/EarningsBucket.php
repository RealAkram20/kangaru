<?php

namespace Modules\Drivers\Enums;

use Carbon\CarbonImmutable;

/**
 * One bar of the earnings trend.
 *
 * Split from `EarningsPeriod` because the two answer different questions and a
 * single enum would carry both: the period is *how far back*, the bucket is
 * *how finely*. Week and month share a bucket, so folding them together would
 * mean writing the day bucket twice.
 *
 * ## Why there is no SQL here
 *
 * `Modules\Reports\Enums\FinancialPeriod` buckets with `DATE_FORMAT` in a
 * `GROUP BY`, and this deliberately does not follow it. Two reasons, both
 * about correctness rather than taste:
 *
 * - **Timezones.** Grouping in SQL means converting the column first, and
 *   `CONVERT_TZ` with a named zone needs MySQL's timezone tables loaded, which
 *   they generally are not. The alternative — a numeric offset computed once
 *   in PHP — is wrong across a DST boundary, and a month-long period can
 *   contain one. Uganda has no DST; AGENTS.md's international-ready rule means
 *   the next market might.
 * - **Volume.** The financial report groups every invoice a tenant ever
 *   issued, so pushing the work into the database earns its complexity. This
 *   reads *one driver's own entries over at most a month* — bounded by how
 *   many trips a person can physically drive. Fetching them and bucketing in
 *   PHP is a smaller, more portable, and exactly-correct answer.
 */
enum EarningsBucket: string
{
    case HOUR = 'hour';
    case DAY = 'day';

    /**
     * The key a moment falls into.
     *
     * **The moment must already be in the display timezone.** Bucketing a UTC
     * instant labels a Kampala driver's 9 PM as 6 PM, so the chart's tallest
     * bar lands three hours from where they remember being busy — which reads
     * as the chart being wrong about them rather than about time.
     */
    public function keyFor(CarbonImmutable $moment): string
    {
        return match ($this) {
            self::HOUR => $moment->format('Y-m-d H:00'),
            self::DAY => $moment->format('Y-m-d'),
        };
    }

    /** One step along the axis, for walking a continuous series. */
    public function advance(CarbonImmutable $moment): CarbonImmutable
    {
        return match ($this) {
            self::HOUR => $moment->addHour(),
            self::DAY => $moment->addDay(),
        };
    }
}
