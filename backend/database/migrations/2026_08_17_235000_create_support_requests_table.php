<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * A driver's written report, and the office's answer to it (ADR-0044).
     *
     * **The answer lives on the same row as the report, and that is the
     * design.** A separate replies table would be a thread, and ADR-0044 §5
     * rules threading out: one report, one answer, both permanent. Keeping the
     * pair together also makes the one query the office queue needs — "what is
     * still unanswered" — an index scan rather than a join.
     *
     * `driver_id` and no tenant column, like every other driver-owned table
     * here (`driver_settlement_requests`, `driver_documents`): the driver is
     * the anchor, and `TenantScope` fails closed on rows that have no tenant of
     * their own.
     */
    public function up(): void
    {
        Schema::create('support_requests', function (Blueprint $table) {
            $table->id();
            $table->foreignId('driver_id')->constrained()->cascadeOnDelete();

            // One of the five Help Topics (ADR-0044 §1). Stored as its string
            // value; `SupportRequestTopic` warns against ever repurposing a
            // case, because a rename re-files somebody's old report under a
            // heading they never chose.
            $table->string('topic', 20);
            $table->string('status', 20)->default('open');

            /**
             * The trip this is about, when it is about one.
             *
             * Nullable and **never required by the topic**: a vehicle fault can
             * happen mid-trip and a payment query might not be about a single
             * journey. `nullOnDelete` rather than cascade — a report survives
             * the trip it mentions, because the office may still owe an answer
             * about a journey somebody has since removed.
             */
            $table->foreignId('trip_id')->nullable()->constrained()->nullOnDelete();

            /**
             * The driver's own account of what happened.
             *
             * `text`, not a `string(N)`. This is the one field on the platform
             * where somebody describes a problem in their own words, and a
             * length cap here becomes a driver rewriting an account of being
             * threatened to fit a validator.
             */
            $table->text('body');

            /**
             * The office's reply, and who wrote it.
             *
             * Null while open, and **set together with `status` in one service
             * call** — a row that is `answered` with no answer would be the
             * silence the feature exists to prevent, expressed as data.
             */
            $table->text('answer')->nullable();
            $table->foreignId('answered_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->dateTime('answered_at')->nullable();

            $table->timestamps();

            // The driver's own list, newest first.
            $table->index(['driver_id', 'created_at']);
            // The office queue: everything still waiting, **oldest first** —
            // the report that has waited longest is the one that has most
            // earned an answer.
            $table->index(['status', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('support_requests');
    }
};
