<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Modules\Drivers\Enums\DriverDocumentStatus;

return new class extends Migration
{
    /**
     * The papers a driver has to hold, and what the office made of them
     * (ADR-0033).
     *
     * **One row per driver per type**, enforced by the unique index below.
     * Re-uploading replaces the file and resets the status to `pending`,
     * because a document the office verified is not evidence for a different
     * file that arrived afterwards. The superseded file is deleted; ADR-0033
     * §2 argues the trade and names the seam if a dispute ever needs it back.
     *
     * **This table gates nothing.** An unverified driver is dispatched exactly
     * as before. ADR-0033 §6 keeps enforcement out of scope deliberately — a
     * fleet where half the licences lapse on a Sunday cannot take work on
     * Monday, and that is a depot manager's decision, not a schema's.
     */
    public function up(): void
    {
        Schema::create('driver_documents', function (Blueprint $table) {
            $table->id();
            $table->foreignId('driver_id')->constrained()->cascadeOnDelete();

            /**
             * One of `DriverDocumentType`, and deliberately **not** named for
             * one country: `identity_document` rather than "national ID",
             * `vehicle_registration` rather than "logbook". A type enum ends
             * up in a column, an OpenAPI enum and every shipped handset, so it
             * is the exact place a Uganda assumption becomes permanent.
             */
            $table->string('type', 32);
            $table->string('status', 16)->default(DriverDocumentStatus::PENDING->value);

            /**
             * Where the file lives, relative to the private disk. Never a URL:
             * it is served by a controller behind the policy, because a signed
             * link to somebody's national ID is addressable by anyone who ever
             * saw it (ADR-0033 §5).
             */
            $table->string('file_path', 512);
            /** The handset's own name for it, so the office sees what the driver sent. */
            $table->string('original_name', 255)->nullable();
            $table->string('mime_type', 128);
            $table->unsignedInteger('size_bytes');

            /**
             * A date, not a datetime. A licence expires on a day, and storing
             * midnight-somewhere invites the timezone bug the earnings work
             * already found: `config/app.php` is UTC, so a Kampala day rolls
             * over at 03:00. `expired` is derived from this at read time and
             * never stored — a stored expiry state needs a nightly job and is
             * wrong for up to a day every time it runs (ADR-0033 §3).
             */
            $table->date('expires_at')->nullable();

            $table->dateTime('uploaded_at');

            // Who looked, when, and why they said no. A rejection with no
            // reason is how a driver stops using a feature — ADR-0032 §3
            // reached the same conclusion about a declined settlement.
            $table->foreignId('reviewed_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->dateTime('reviewed_at')->nullable();
            $table->string('rejection_reason', 255)->nullable();

            $table->timestamps();

            // One document of each type per driver. The uniqueness is the
            // model: without it a re-upload silently becomes a second row and
            // "what is the state of my licence" stops having one answer.
            $table->unique(['driver_id', 'type']);
            // The office queue: everything still waiting, oldest first.
            $table->index(['status', 'uploaded_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('driver_documents');
    }
};
