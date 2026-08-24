<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A driver's contract with Kangaru for walk-in work (ADR-0055 §5, `K8`).
 *
 * The owner, 22 August 2026: *"each driver regardless of the Fleet company can
 * request to be part of our Walkin economy."*
 *
 * ## Three parties, and the row records all three answers
 *
 * The driver asks, their fleet consents, Kangaru approves. That is a chain
 * rather than a switch, so the row carries **who answered and when** at each
 * step rather than a single status somebody has to interpret backwards.
 *
 * `fleet_answered_at` and `kangaru_answered_at` are separate columns and not
 * one `answered_at`, because the two answers mean different things and the gap
 * between them is the state the queue is built on: *consented, waiting on head
 * office*.
 *
 * ## `operator_id` is on the row, not read through the driver
 *
 * A driver can move between fleets. The fleet that consented is a fact about
 * this contract at the moment it was given, and reading it through
 * `drivers.operator_id` would silently rewrite history the first time a driver
 * changed employer — the fleet that never agreed to anything would appear to
 * have consented.
 *
 * ## What this table is not
 *
 * It carries **no commission rate and no fleet share**. Those are
 * `docs/platform-plan.md` §6 questions 2 and 3, still open and still the
 * owner's, and a nullable column added now would be a number somebody fills in
 * before the argument is had. When they are answered the column arrives with
 * the decision that justifies it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('driver_walk_in_contracts', function (Blueprint $table) {
            $table->id();

            $table->foreignId('driver_id')->constrained()->cascadeOnDelete();

            // Nullable, and the null is meaningful: a driver who owns their
            // vehicle has no fleet to ask (ADR-0048 §7), which is exactly the
            // case ADR-0055 §5 waives fleet consent for.
            $table->foreignId('operator_id')->nullable()->constrained()->restrictOnDelete();

            $table->string('status', 24);

            $table->timestamp('fleet_answered_at')->nullable();
            $table->timestamp('kangaru_answered_at')->nullable();

            // Why a refusal was given. Optional, because a fleet declining its
            // own driver may have nothing to say publicly — but the driver is
            // told the outcome either way (ADR-0052), and an unexplained
            // refusal they can see beats a silent one they cannot.
            $table->string('refused_reason', 500)->nullable();

            $table->timestamps();

            // One live contract per driver. A driver who was refused and asks
            // again reuses the row rather than queueing a second, which is the
            // same shape `operator_client` takes for a fleet asking twice.
            $table->unique('driver_id');

            // The queue head office works: everything waiting on Kangaru,
            // oldest first.
            $table->index(['status', 'fleet_answered_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('driver_walk_in_contracts');
    }
};
