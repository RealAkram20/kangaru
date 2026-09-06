<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * A driver asking the office to settle, in either direction (ADR-0032).
     *
     * **This table is not a balance and must never be summed into one.** The
     * wallet total comes from `driver_ledger_entries` alone; a row here is a
     * request that a human has not yet acted on. If a pending request could
     * move a balance, a driver could request their way out of what they owe.
     *
     * Confirming a row is what writes the ledger entry — through
     * `DriverLedgerService::recordSettlement()`, never by inserting one —
     * and `ledger_entry_id` below records which entry it produced so a
     * replay cannot pay twice.
     */
    public function up(): void
    {
        Schema::create('driver_settlement_requests', function (Blueprint $table) {
            $table->id();
            $table->foreignId('driver_id')->constrained()->cascadeOnDelete();

            // `remittance` (the driver handed cash over) or `payout` (asking
            // to be paid). Cash work runs towards the office, so the first is
            // the common case — ADR-0029 §2 made the same observation.
            $table->string('kind', 20);
            $table->string('status', 20)->default('pending');

            /**
             * Always **positive**, whatever the kind: this is the amount a
             * driver typed, and a person typing an amount does not type a
             * sign. The direction lives in `kind`, and the ledger entry's
             * sign is derived from it on confirmation — so a wrong sign here
             * cannot become a wrong sign there.
             */
            $table->unsignedBigInteger('amount_minor');
            $table->string('currency', 3)->default('UGX');

            // The driver's own words — "paid Musoke at Nakawa depot". Free
            // text, and the only place the *circumstances* of a handover are
            // recorded; the office reads it to recognise the payment.
            $table->string('note', 255)->nullable();

            // Who acted, when, and why they said no. A decline with no reason
            // is how a driver stops using a feature.
            $table->foreignId('reviewed_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->dateTime('reviewed_at')->nullable();
            $table->string('decline_reason', 255)->nullable();

            /**
             * The ledger entry a confirmation produced.
             *
             * Null while pending or declined. Set once, and the service
             * refuses to confirm a request that already has one — which is
             * what makes confirmation idempotent under a double-tap or a
             * retried request.
             */
            $table->foreignId('ledger_entry_id')
                ->nullable()
                ->constrained('driver_ledger_entries')
                ->nullOnDelete();

            $table->timestamps();

            // The driver's own list, newest first.
            $table->index(['driver_id', 'created_at']);
            // The office queue: everything still waiting, oldest first.
            $table->index(['status', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('driver_settlement_requests');
    }
};
