<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * ADR-0013 §4: an order request may belong to a customer, and anonymity
 * survives.
 *
 * Nullable, because the anonymous walk-in is the product, not a degraded
 * mode — the public form keeps working with no account. `nullOnDelete`
 * rather than restrict: an order request is the dispatcher's record of an
 * ask, and it must outlive the account that made it (the same reasoning
 * as users being suspended, never deleted — but a customer has no
 * suspended state to fall back to yet).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('order_requests', function (Blueprint $table) {
            $table->foreignId('customer_id')
                ->nullable()
                ->after('handled_by_user_id')
                ->constrained('customers')
                ->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('order_requests', function (Blueprint $table) {
            $table->dropConstrainedForeignId('customer_id');
        });
    }
};
