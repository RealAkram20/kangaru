<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Invoices and credit notes must name a fleet (ADR-0055 §6).
 *
 * F0 added `operator_id` to `invoices` nullable and said why:
 *
 * > NOT NULL is the eventual truth for both, [but] it is not imposed now
 * > because nothing in F0 teaches `InvoiceService` to set the column, and a
 * > constraint with no writer behind it turns a green suite red for a rule
 * > nobody is yet in a position to keep.
 *
 * F2 built the writer. `InvoiceService` takes the fleet from the trip and
 * **refuses** a corporate trip that names none rather than guessing;
 * `CreditNoteService` takes it from the invoice being corrected and refuses on
 * the same terms. So every document either carries a fleet or was never
 * created, and the constraint now has something behind it.
 *
 * ## Why this is worth a migration rather than trusting the services
 *
 * A document number is the thing this platform sells to a bank: *"every
 * invoice reproducible from stored data"*. A fleetless invoice is one that
 * belongs to no series — it cannot be reproduced, reconciled, or explained to
 * an auditor. Two services keeping that rule is two places to forget it; the
 * column keeping it is one place that cannot.
 *
 * Both are already fully backfilled — F0 and the credit-note migration set
 * every existing row to Shanitah — so this only closes the door behind them.
 */
return new class extends Migration
{
    public function up(): void
    {
        $this->guardAgainstFleetlessRows();

        foreach (['invoices', 'credit_notes'] as $table) {
            Schema::table($table, function (Blueprint $blueprint) {
                $blueprint->unsignedBigInteger('operator_id')->nullable(false)->change();
            });
        }
    }

    public function down(): void
    {
        foreach (['invoices', 'credit_notes'] as $table) {
            Schema::table($table, function (Blueprint $blueprint) {
                $blueprint->unsignedBigInteger('operator_id')->nullable()->change();
            });
        }
    }

    /**
     * Reported rather than silently backfilled.
     *
     * A row with no fleet at this point is not a migration artefact — F0 and
     * `add_operator_to_credit_notes` filled every row that existed, and both
     * services have refused to create a fleetless one since. So a null here
     * means something wrote around them, and quietly assigning it to Shanitah
     * would file another fleet's money in Shanitah's ledger and destroy the
     * evidence that it happened.
     */
    private function guardAgainstFleetlessRows(): void
    {
        foreach (['invoices', 'credit_notes'] as $table) {
            $orphans = DB::table($table)->whereNull('operator_id')->count();

            if ($orphans > 0) {
                throw new RuntimeException(
                    "{$orphans} row(s) in {$table} name no fleet. Every row was backfilled to "
                    .'Shanitah and both services refuse to create one without a fleet, so these '
                    .'were written by something that bypassed both. Find out what before '
                    .'assigning them — guessing would file one fleet\'s money in another\'s ledger.'
                );
            }
        }
    }
};
