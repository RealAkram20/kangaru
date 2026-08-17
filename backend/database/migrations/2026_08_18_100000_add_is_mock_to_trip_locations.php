<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Whether the device said this ping came from a mock-location provider
 * (`docs/measured-distance-plan.md` §2 Step 1, ADR-0045).
 *
 * The operating system already knows — Android marks a fix produced by a
 * "fake GPS" app, and Expo surfaces it as `LocationObject.mocked` — but the
 * ping payload never carried it, so the trace could not tell a driven
 * kilometre from a typed one. Now that the measured trace is the figure the
 * fare will be priced from, that distinction is the difference between
 * evidence and a claim.
 *
 * Stored, not yet acted on. Ingestion accepts the flag and the resolver
 * counts it; nothing refuses a mock ping at the door until the flag has been
 * observed in the wild long enough to know how often a real handset sets it
 * by mistake (Phase 4 of the plan).
 *
 * `NOT NULL DEFAULT 0`: a device that does not report the field — every
 * handset today, until the app is updated — is recorded as not-mock rather
 * than unknown. That is the honest reading of "the OS did not say so", and
 * it keeps the column out of every existing query's NULL handling.
 *
 * Raw DDL, because `trip_locations` is partitioned and was created that way.
 * Adding a column that is not part of the partitioning key is an ordinary
 * ALTER on a partitioned table; no reorganisation is involved.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE `trip_locations` ADD COLUMN `is_mock` TINYINT(1) NOT NULL DEFAULT 0 AFTER `accuracy_metres`');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE `trip_locations` DROP COLUMN `is_mock`');
    }
};
