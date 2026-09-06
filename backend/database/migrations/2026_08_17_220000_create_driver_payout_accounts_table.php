<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Where a driver's money is sent (ADR-0042).
     *
     * **This table does not move money and is not a balance.** It records a
     * destination; ADR-0032's request-and-confirm flow is still the only thing
     * that writes a ledger entry, and ADR-0029 §6's boundary is unchanged — the
     * platform records that a payment happened rather than making it happen.
     *
     * **One row per driver**, enforced by a unique key rather than by
     * convention. Two destinations create a question at the moment of paying —
     * *which one?* — and the person answering it is a clerk under time pressure
     * who does not know the driver's preference.
     */
    public function up(): void
    {
        Schema::create('driver_payout_accounts', function (Blueprint $table) {
            $table->id();

            /**
             * Unique, not merely indexed. The application also refuses a second
             * row, but a driver double-tapping Save on a bad connection is
             * exactly how two arrive a millisecond apart, and only the database
             * can settle that race.
             */
            $table->foreignId('driver_id')->unique()->constrained()->cascadeOnDelete();

            // `bank` or `mobile_money`. Kept as a short string like every other
            // enum-backed column in this schema, so the enum owns the values
            // and a migration is not needed to add a provider type.
            $table->string('kind', 20);

            /**
             * The bank or the mobile-money provider — "Stanbic", "MTN MoMo".
             *
             * **Not encrypted, deliberately.** It is not identifying on its own
             * (a third of Kampala banks at the same one), and leaving it
             * readable means the office can group a payment run by bank without
             * decrypting every row.
             */
            $table->string('institution', 120);

            /**
             * Encrypted at the application layer (ADR-0042 §3), like
             * `users.mfa_secret`.
             *
             * `text`, not `string`: ciphertext is substantially longer than the
             * plaintext it carries, and a 255-char column would truncate a
             * perfectly ordinary account number into something that decrypts to
             * an exception.
             */
            $table->text('account_number');
            $table->text('account_holder');

            /**
             * The last four characters, in clear.
             *
             * Stored rather than derived because the number it comes from is
             * encrypted: rendering a masked account for a list of drivers would
             * otherwise mean decrypting every row to show four characters of
             * each. Written by the model, never by a caller.
             */
            $table->string('last_four', 4);

            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('driver_payout_accounts');
    }
};
