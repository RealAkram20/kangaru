<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * ADR-0003 and PROJECT.md both require this table to be "partitioned by
     * month from day one" — it is the platform's growth risk at roughly 500M
     * rows a year, and retiring a month has to be a DROP PARTITION rather
     * than a DELETE competing with live traffic for row locks.
     *
     * Written as raw DDL because Laravel's schema builder cannot express
     * partitioning, and because three of the choices below are forced by the
     * storage engine rather than chosen:
     *
     * 1. **No foreign keys.** InnoDB refuses them outright on a partitioned
     *    table — verified against the local server, which answers
     *    "ERROR 1506: Foreign key clause is not yet supported in conjunction
     *    with partitioning". This is the AGENTS.md "proper foreign keys"
     *    rule's one justified exception in this schema; `tenant_id` and
     *    `trip_id` are only ever written from an already-loaded Trip, so the
     *    reference is established before the row exists.
     *
     * 2. **The primary key is (id, recorded_at).** Every unique key on a
     *    partitioned table must contain every partitioning column. `id`
     *    stays first so it can remain AUTO_INCREMENT.
     *
     * 3. **`recorded_at` is DATETIME, not TIMESTAMP.** A TIMESTAMP column can
     *    only be range-partitioned through UNIX_TIMESTAMP(), which rules out
     *    the readable month boundaries below.
     *
     * `recorded_at` is the device's clock, not the server's: a ping captured
     * in a dead zone and synced an hour later belongs to the month it was
     * recorded in, which is also the month its trip is billed in.
     */
    public function up(): void
    {
        DB::statement('
            CREATE TABLE `trip_locations` (
                `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                `tenant_id` BIGINT UNSIGNED NOT NULL,
                `trip_id` BIGINT UNSIGNED NOT NULL,

                -- 7 decimal places is ~1cm at the equator, far beyond what
                -- consumer GPS resolves; the extra digits cost nothing and
                -- avoid ever having to widen the column.
                `latitude` DECIMAL(10, 7) NOT NULL,
                `longitude` DECIMAL(10, 7) NOT NULL,

                -- All optional: a device reports what it has. A ping with a
                -- position but no speed is still a point on the route.
                `speed_kph` DECIMAL(6, 2) NULL DEFAULT NULL,
                `heading_degrees` SMALLINT UNSIGNED NULL DEFAULT NULL,
                `accuracy_metres` DECIMAL(7, 2) NULL DEFAULT NULL,

                `recorded_at` DATETIME NOT NULL,
                `created_at` TIMESTAMP NULL DEFAULT NULL,

                PRIMARY KEY (`id`, `recorded_at`),

                -- The route-replay and distance queries: every point of one
                -- trip, in order.
                KEY `trip_locations_trip_recorded_index` (`trip_id`, `recorded_at`),
                -- ADR-0001 tenant scoping, which every read goes through.
                KEY `trip_locations_tenant_recorded_index` (`tenant_id`, `recorded_at`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            PARTITION BY RANGE (TO_DAYS(`recorded_at`)) ('.$this->initialPartitions().')
        ');
    }

    /**
     * The current month, a few ahead, and a MAXVALUE catch-all.
     *
     * `p_future` is what makes ingestion independent of maintenance: if
     * `trip-locations:maintain` stops running, pings still land somewhere
     * instead of the insert failing. They are simply not separable for
     * retention until the command reorganises that partition, which is why
     * it keeps months carved out ahead of time.
     */
    private function initialPartitions(): string
    {
        $definitions = [];
        $month = Carbon::now()->startOfMonth();

        for ($i = 0; $i <= (int) config('tracking.partitions_ahead', 3); $i++) {
            $definitions[] = sprintf(
                'PARTITION `p%s` VALUES LESS THAN (TO_DAYS(\'%s\'))',
                $month->format('Ym'),
                $month->copy()->addMonth()->format('Y-m-d'),
            );

            $month->addMonth();
        }

        $definitions[] = 'PARTITION `p_future` VALUES LESS THAN MAXVALUE';

        return implode(', ', $definitions);
    }

    /**
     * Reverse the migrations.
     *
     * Dropping a partitioned table needs no special handling, and there are
     * no foreign keys pointing at it to order around.
     */
    public function down(): void
    {
        Schema::dropIfExists('trip_locations');
    }
};
