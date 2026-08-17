<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A driver's own photograph (ADR-0041).
 *
 * **A path, not a URL.** The file lives on the private disk beside the
 * identity documents ADR-0033 put there, and it is streamed through the API
 * rather than served from storage — a signed link to a photograph of somebody
 * is addressable by anyone who ever saw the link, and unlike a licence scan
 * this one is shown on a screen a driver opens dozens of times a day, so the
 * link would travel further.
 *
 * Nullable, and permanently so. A driver who has never sent one is the
 * ordinary case, not an error state: the app draws their initials, which is
 * what it drew for everybody before this column existed.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('drivers', function (Blueprint $table) {
            $table->string('photo_path', 255)->nullable()->after('referral_code');
        });
    }

    public function down(): void
    {
        Schema::table('drivers', function (Blueprint $table) {
            $table->dropColumn('photo_path');
        });
    }
};
