<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * A document that belongs to an applicant, not yet to a driver
     * (ADR-0048 §3).
     *
     * ADR-0033 put documents firmly on the driver and argued it well: an
     * application "is a stranger's row that is deleted or abandoned", and a
     * licence renewing in 2029 "has nothing to do with a form filled in
     * 2026". That argument survives — this is not a second home for a
     * driver's papers, it is a **waiting room**. Everything here either moves
     * to a driver at approval or is destroyed at rejection (ADR-0048 §5).
     *
     * ## Why not a second table
     *
     * `driver_application_documents` was the obvious shape and it was
     * rejected on what it would duplicate: the same private-disk storage, the
     * same four review states, the same expiry derivation, the same policy,
     * the same streaming controller and the same enum. **Two tables holding
     * the same file with the same review states is where the second one
     * drifts** — silently, because the office only ever opens one of them.
     *
     * ## The invariant, and how the indexes enforce it
     *
     * Exactly one of `driver_id` and `driver_application_id` is set. Never
     * both, never neither. The service and the model both refuse the other
     * two states; the database cannot express "exactly one of" portably, so
     * this comment is where that gap is recorded rather than hidden.
     *
     * The two unique indexes coexist **because MySQL permits many NULLs in a
     * unique index** — the same property ADR-0016 §3 leaned on for
     * `drivers.user_id`. An applicant's rows all have a NULL `driver_id`, so
     * they cannot collide on the pre-existing driver index; a driver's rows
     * all have a NULL `driver_application_id` and cannot collide on the new
     * one. Neither index has to learn about the other.
     */
    public function up(): void
    {
        Schema::table('driver_documents', function (Blueprint $table) {
            /**
             * `cascadeOnDelete`, unlike the driver side's, and the asymmetry
             * is the point.
             *
             * A `Driver` is soft-deleted, so its documents must outlive the
             * row. A `driver_applications` row is not — when one genuinely
             * goes, the photographs of a stranger's face and national ID have
             * no reason at all to survive it.
             */
            $table->foreignId('driver_application_id')
                ->nullable()
                ->after('driver_id')
                ->constrained()
                ->cascadeOnDelete();
        });

        // Separated from the column addition: the foreign key created above
        // has to exist before the column it sits on can be indexed again, and
        // MySQL will not reorder these for us.
        Schema::table('driver_documents', function (Blueprint $table) {
            $table->unique(['driver_application_id', 'type']);
        });

        /**
         * `driver_id` becomes nullable, which means dropping and restoring
         * its foreign key around the change.
         *
         * Laravel 12 changes columns natively — no doctrine/dbal — but a
         * `->change()` on a constrained column still has to step around the
         * constraint, because MySQL will not alter a column an active foreign
         * key depends on.
         */
        Schema::table('driver_documents', function (Blueprint $table) {
            $table->dropForeign(['driver_id']);
        });

        Schema::table('driver_documents', function (Blueprint $table) {
            $table->foreignId('driver_id')->nullable()->change();
        });

        Schema::table('driver_documents', function (Blueprint $table) {
            $table->foreign('driver_id')->references('id')->on('drivers')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        /**
         * Down is only honest if the waiting room is empty first.
         *
         * `driver_id` cannot go back to NOT NULL while application-owned rows
         * hold a NULL in it, and a migration that dies half-applied on a
         * production rollback is worse than one that says what it is doing.
         * These rows are, by construction, files nobody has been approved
         * for.
         */
        DB::table('driver_documents')->whereNull('driver_id')->delete();

        /**
         * **The foreign key goes before the index it rides on.**
         *
         * MySQL refuses to drop `driver_documents_driver_application_id_type_unique`
         * while the foreign key needs it — *"Cannot drop index: needed in a
         * foreign key constraint"* — because that composite unique is the only
         * index with `driver_application_id` on its left, and InnoDB requires
         * one to enforce the constraint. `dropConstrainedForeignId()` does the
         * key and the column in one call, which puts them the wrong way round,
         * so the three steps are spelled out.
         *
         * Found by running the rollback, not by reading it.
         */
        Schema::table('driver_documents', function (Blueprint $table) {
            $table->dropForeign(['driver_application_id']);
        });

        Schema::table('driver_documents', function (Blueprint $table) {
            $table->dropUnique(['driver_application_id', 'type']);
        });

        Schema::table('driver_documents', function (Blueprint $table) {
            $table->dropColumn('driver_application_id');
        });

        Schema::table('driver_documents', function (Blueprint $table) {
            $table->dropForeign(['driver_id']);
        });

        Schema::table('driver_documents', function (Blueprint $table) {
            $table->foreignId('driver_id')->nullable(false)->change();
        });

        Schema::table('driver_documents', function (Blueprint $table) {
            $table->foreign('driver_id')->references('id')->on('drivers')->cascadeOnDelete();
        });
    }
};
