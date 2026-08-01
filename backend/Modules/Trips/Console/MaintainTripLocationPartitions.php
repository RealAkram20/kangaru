<?php

namespace Modules\Trips\Console;

use Illuminate\Console\Command;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Keeps `trip_locations` partitioned ahead of time and prunes what is past
 * retention.
 *
 * ADR-0003: raw pings are kept 12 months. Because the table is partitioned
 * by month, retiring a month is `DROP PARTITION` — near-instant, and it
 * never takes row locks that live ingestion is waiting on. The same job as a
 * `DELETE WHERE recorded_at < ...` would be tens of millions of rows and
 * hours of contention.
 *
 * Intended to run monthly from the scheduler. Safe to run repeatedly: adding
 * a partition that exists and dropping one that does not are both no-ops.
 */
class MaintainTripLocationPartitions extends Command
{
    protected $signature = 'trip-locations:maintain
                            {--dry-run : Report what would change without altering anything}';

    protected $description = 'Add upcoming monthly partitions to trip_locations and drop those past retention';

    public function handle(): int
    {
        $dryRun = (bool) $this->option('dry-run');
        $existing = $this->existingPartitions();

        if ($existing === []) {
            $this->error('trip_locations is not partitioned — has the migration run?');

            return self::FAILURE;
        }

        $added = $this->addUpcoming($existing, $dryRun);
        $dropped = $this->dropExpired($existing, $dryRun);

        $this->info(sprintf(
            '%s%d partition(s) added, %d dropped.',
            $dryRun ? '[dry run] ' : '',
            $added,
            $dropped,
        ));

        return self::SUCCESS;
    }

    /**
     * Carves months out of the MAXVALUE catch-all.
     *
     * New months can only be added by reorganising `p_future`: RANGE
     * partitions must stay in ascending order, so ADD PARTITION after a
     * MAXVALUE partition is rejected. Reorganising also relocates any rows
     * that already landed in the catch-all into the month they belong to.
     *
     * @param  array<int, string>  $existing
     */
    private function addUpcoming(array $existing, bool $dryRun): int
    {
        $wanted = [];
        $month = Carbon::now()->startOfMonth();

        for ($i = 0; $i <= (int) config('tracking.partitions_ahead', 3); $i++) {
            $name = 'p'.$month->format('Ym');

            if (! in_array($name, $existing, true)) {
                $wanted[$name] = $month->copy()->addMonth()->format('Y-m-d');
            }

            $month->addMonth();
        }

        if ($wanted === []) {
            return 0;
        }

        $definitions = [];

        foreach ($wanted as $name => $lessThan) {
            $definitions[] = sprintf("PARTITION `%s` VALUES LESS THAN (TO_DAYS('%s'))", $name, $lessThan);
            $this->line(($dryRun ? '[dry run] ' : '').'Adding partition '.$name);
        }

        $definitions[] = 'PARTITION `p_future` VALUES LESS THAN MAXVALUE';

        if (! $dryRun) {
            DB::statement(
                'ALTER TABLE `trip_locations` REORGANIZE PARTITION `p_future` INTO ('
                .implode(', ', $definitions).')'
            );
        }

        return count($wanted);
    }

    /**
     * Drops whole months past the retention window.
     *
     * ADR-0003 pairs this with "then downsampled polylines only" — the
     * route is meant to be compacted before the raw pings go. That half is
     * not built, so a dropped partition is a route that is gone. The command
     * says so on every run rather than leaving it to the ADR.
     *
     * @param  array<int, string>  $existing
     */
    private function dropExpired(array $existing, bool $dryRun): int
    {
        $months = (int) config('tracking.retention_months', 12);
        $cutoff = Carbon::now()->startOfMonth()->subMonths($months);
        $dropped = 0;

        foreach ($existing as $name) {
            if ($name === 'p_future' || ! preg_match('/^p(\d{4})(\d{2})$/', $name, $matches)) {
                continue;
            }

            $partitionMonth = Carbon::createFromDate((int) $matches[1], (int) $matches[2], 1)->startOfMonth();

            if ($partitionMonth->greaterThanOrEqualTo($cutoff)) {
                continue;
            }

            $this->warn(sprintf(
                '%sDropping partition %s (%s) — raw pings are discarded, not downsampled.',
                $dryRun ? '[dry run] ' : '',
                $name,
                $partitionMonth->format('F Y'),
            ));

            if (! $dryRun) {
                DB::statement("ALTER TABLE `trip_locations` DROP PARTITION `{$name}`");
            }

            $dropped++;
        }

        return $dropped;
    }

    /**
     * @return array<int, string>
     */
    private function existingPartitions(): array
    {
        $rows = DB::select(
            'SELECT PARTITION_NAME AS name
             FROM information_schema.PARTITIONS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = ?
               AND PARTITION_NAME IS NOT NULL
             ORDER BY PARTITION_ORDINAL_POSITION',
            ['trip_locations'],
        );

        return array_map(fn ($row) => (string) $row->name, $rows);
    }
}
