<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Periods a driver or a vehicle is *not* available (ADR-0017).
     *
     * One table for both, discriminated by `resource_type`, because the
     * question dispatch asks is the same question — "is this thing free
     * between these two moments?" — and two tables would mean two
     * implementations of the overlap predicate that could disagree.
     *
     * Deliberately not tenant-scoped. ADR-0005 puts the fleet with the
     * platform: a driver's leave and a vehicle's service booking are
     * Shanitah's facts, not a client's, and scoping them would make a
     * vehicle appear free to every client but the one that recorded the
     * block.
     */
    public function up(): void
    {
        Schema::create('availability_blocks', function (Blueprint $table) {
            $table->id();
            $table->string('resource_type', 16);
            $table->unsignedBigInteger('resource_id');
            $table->string('kind', 32);
            // Requested / approved / declined (ADR-0017 §6). The office
            // recording a workshop booking writes `approved` directly; a
            // driver asking for Friday off — from the Driver's Application,
            // Phase 2 — writes `requested` and waits for an answer. Only
            // `approved` withholds anything from dispatch, or asking would
            // be the same as being granted.
            $table->string('status', 16)->default('approved');
            $table->foreignId('answered_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->dateTime('answered_at')->nullable();
            $table->string('answer_note', 255)->nullable();
            $table->dateTime('starts_at');
            // Null is open-ended — "off the road until further notice",
            // which is the honest record when a vehicle fails an inspection
            // and nobody yet knows what the part costs. A far-future
            // sentinel date would be a lie that sorts correctly.
            $table->dateTime('ends_at')->nullable();
            $table->string('reason', 255)->nullable();
            $table->foreignId('created_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->softDeletes();

            // The dispatch query is "blocks for this resource overlapping
            // this window", so the resource pair leads and the start bounds
            // it. `ends_at` is deliberately not in the index: it is nullable
            // and the range predicate on it cannot be satisfied by the index
            // anyway once `starts_at` has been used for the range.
            $table->index(['resource_type', 'resource_id', 'starts_at']);
            // The fleet office's queue: "what have drivers asked for that
            // nobody has answered". Without this it is a full scan of a
            // table whose overwhelming majority of rows are answered.
            $table->index(['status', 'starts_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('availability_blocks');
    }
};
