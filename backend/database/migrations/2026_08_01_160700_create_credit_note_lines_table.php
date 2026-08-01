<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('credit_note_lines', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignId('credit_note_id')->constrained()->cascadeOnDelete();

            $table->unsignedInteger('line_number');

            // Which invoice line is being corrected, when the correction is
            // attributable to one. Nullable because a goodwill credit or a
            // negotiated settlement corrects the invoice as a whole and
            // pretending otherwise would put a false attribution on the
            // record.
            $table->foreignId('invoice_line_id')->nullable()->constrained()->restrictOnDelete();

            $table->string('description');
            $table->unsignedBigInteger('amount_minor');

            $table->timestamps();

            $table->unique(['credit_note_id', 'line_number']);
            $table->index(['tenant_id', 'credit_note_id']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('credit_note_lines');
    }
};
