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
        Schema::create('report_exports', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
            // Who asked for it: an export is a copy of tenant data leaving
            // the system, so it is attributable. restrictOnDelete for the
            // same reason trips keep their vehicle.
            $table->foreignId('requested_by_user_id')->constrained('users')->restrictOnDelete();

            // Which report and in what shape. Validated strings cast to
            // enums on the model, matching the convention used by
            // trips.status and bookings.status.
            $table->string('report')->default('trips');
            $table->string('format');
            $table->string('status')->default('queued');

            // The exact filters the job must reproduce. Stored rather than
            // re-derived so a finished file can always be explained: "this
            // is July, vehicle UBA 111A" is a question an auditor asks.
            $table->json('filters');

            // Relative to the configured disk, always under tenants/{id}/
            // per ADR-0001. Null until the job succeeds.
            $table->string('path')->nullable();
            $table->unsignedInteger('row_count')->nullable();
            $table->unsignedBigInteger('file_size')->nullable();
            $table->text('error')->nullable();

            $table->timestamp('started_at')->nullable();
            $table->timestamp('finished_at')->nullable();
            // Exports hold trip PII, so they are not kept indefinitely; a
            // prune command deletes the file past this. Nullable so a
            // failed export, which has no file, needs no expiry.
            $table->timestamp('expires_at')->nullable();

            $table->timestamps();

            $table->index(['tenant_id', 'status']);
            $table->index(['tenant_id', 'created_at']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('report_exports');
    }
};
