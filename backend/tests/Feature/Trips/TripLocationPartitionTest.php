<?php

use Illuminate\Support\Facades\DB;

/**
 * The partition maintenance command (ADR-0003 retention).
 *
 * These assert against `information_schema`, not against the command's own
 * console output: a command that prints "3 partitions added" while altering
 * nothing would sail through a test that only read its text.
 *
 * ## A caution for anyone adding to this file
 *
 * Every test here issues DDL, and in MySQL an `ALTER TABLE` **implicitly
 * commits** the open transaction — including the one `RefreshDatabase`
 * wraps each test in. So these tests deliberately create no rows: anything
 * they inserted would survive the rollback that no longer has a transaction
 * to undo, and would leak into whatever runs next. Keep them schema-only,
 * and clean up any partition they add.
 */

/**
 * @return array<int, string>
 */
function currentPartitions(): array
{
    $rows = DB::select(
        'SELECT PARTITION_NAME AS name FROM information_schema.PARTITIONS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND PARTITION_NAME IS NOT NULL
         ORDER BY PARTITION_ORDINAL_POSITION',
        ['trip_locations'],
    );

    return array_map(fn ($row) => (string) $row->name, $rows);
}

/**
 * Splits the earliest partition to manufacture one older than it.
 *
 * RANGE partitions must stay in ascending order, so an old month cannot be
 * appended or reorganised out of the MAXVALUE catch-all — the only way to
 * get one is to carve it off the front.
 */
function prependPartition(string $name, string $lessThan): void
{
    $first = currentPartitions()[0];

    $upperBound = DB::selectOne(
        'SELECT PARTITION_DESCRIPTION AS d FROM information_schema.PARTITIONS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND PARTITION_NAME = ?',
        ['trip_locations', $first],
    );

    DB::statement(sprintf(
        'ALTER TABLE `trip_locations` REORGANIZE PARTITION `%s` INTO ('
        ."PARTITION `%s` VALUES LESS THAN (TO_DAYS('%s')), "
        .'PARTITION `%s` VALUES LESS THAN (%s))',
        $first,
        $name,
        $lessThan,
        $first,
        $upperBound->d,
    ));
}

it('keeps months carved out ahead of the catch-all', function () {
    $before = currentPartitions();

    expect($before)->toContain('p_future');
    expect($before)->toContain('p'.now()->format('Ym'));

    $this->artisan('trip-locations:maintain')->assertSuccessful();

    $after = currentPartitions();

    // Every month within the configured headroom has its own partition, so
    // ingestion is never relying on the MAXVALUE catch-all.
    for ($i = 0; $i <= (int) config('tracking.partitions_ahead'); $i++) {
        expect($after)->toContain('p'.now()->addMonths($i)->format('Ym'));
    }

    // And the catch-all survives the reorganise — without it, a ping for a
    // month nobody carved out would fail to insert outright.
    expect($after)->toContain('p_future');
});

it('is safe to run twice', function () {
    $this->artisan('trip-locations:maintain')->assertSuccessful();
    $first = currentPartitions();

    $this->artisan('trip-locations:maintain')->assertSuccessful();

    expect(currentPartitions())->toBe($first);
});

it('drops a partition past the retention window', function () {
    $retention = (int) config('tracking.retention_months');
    $stale = now()->subMonths($retention + 2)->startOfMonth();
    $name = 'p'.$stale->format('Ym');

    prependPartition($name, $stale->copy()->addMonth()->format('Y-m-d'));
    expect(currentPartitions())->toContain($name);

    $this->artisan('trip-locations:maintain')->assertSuccessful();

    // Gone — and retiring a month is a DROP PARTITION rather than a DELETE
    // of tens of millions of rows contending with live ingestion.
    expect(currentPartitions())->not->toContain($name);
    expect(currentPartitions())->toContain('p'.now()->format('Ym'));
});

it('keeps a partition that is still inside the retention window', function () {
    $retention = (int) config('tracking.retention_months');
    // One month inside the boundary — the case an off-by-one would discard.
    $recent = now()->subMonths($retention - 1)->startOfMonth();
    $name = 'p'.$recent->format('Ym');

    prependPartition($name, $recent->copy()->addMonth()->format('Y-m-d'));

    $this->artisan('trip-locations:maintain')->assertSuccessful();

    expect(currentPartitions())->toContain($name);

    // Cleanup: this partition is inside retention, so the command will not
    // remove it and it would otherwise persist past the implicit commit.
    DB::statement("ALTER TABLE `trip_locations` DROP PARTITION `{$name}`");
});

it('changes nothing on a dry run', function () {
    $stale = now()->subMonths((int) config('tracking.retention_months') + 3)->startOfMonth();
    $name = 'p'.$stale->format('Ym');

    prependPartition($name, $stale->copy()->addMonth()->format('Y-m-d'));

    $this->artisan('trip-locations:maintain --dry-run')->assertSuccessful();

    // Still there: a dry run reports what it would do and does none of it.
    expect(currentPartitions())->toContain($name);

    DB::statement("ALTER TABLE `trip_locations` DROP PARTITION `{$name}`");
});
