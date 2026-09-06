<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Whether this row's bytes on disk are ciphertext (ADR-0053).
     *
     * AGENTS.md has required this since Phase 1 — *"driver documents (IDs,
     * licenses) additionally app-level encrypted"* — and nothing implemented
     * it. The files have been sitting in plaintext on the operator's
     * filesystem, which is also the sentence the KYC screen was about to
     * print at an applicant while it was untrue.
     *
     * ## Why a column rather than a switch
     *
     * Because files written before this migration exist and cannot be read
     * with a decryptor. The alternatives were both worse:
     *
     * - **Rewrite every file in the migration.** A data migration that reads,
     *   encrypts and rewrites every document is irreversible in practice, has
     *   to be right the first time on production, and fails halfway leaving
     *   the set half-readable with nothing recording which half.
     * - **Sniff the payload on read.** Laravel's ciphertext is a base64 JSON
     *   object, so a `json_decode` would *usually* tell the two apart — and a
     *   PDF or an image that happened to decode is a document served as
     *   gibberish. Guessing at the meaning of bytes is not a security
     *   posture.
     *
     * A stored boolean answers exactly, per row, forever. Old rows keep
     * `false` and stream as they always did; everything written from now on
     * is `true`. **The flag describes the file, it does not control it** — no
     * code path consults it to decide whether to encrypt, only to decide how
     * to read what is already there.
     *
     * ## The consequence to accept
     *
     * There is no backfill here, so a deployment carrying old documents holds
     * a shrinking set of plaintext files until each is replaced. That is
     * deliberate and it is the honest state: pretending otherwise would need
     * the data migration rejected above. `ADR-0053` records it as the open
     * item it is.
     */
    public function up(): void
    {
        Schema::table('driver_documents', function (Blueprint $table) {
            $table->boolean('encrypted')
                ->default(false)
                ->after('file_path');
        });
    }

    public function down(): void
    {
        /**
         * Dropping the column does not decrypt anything.
         *
         * A rollback leaves ciphertext on disk that nothing can now identify
         * as ciphertext, so this `down()` is honest about being a schema
         * reversal and not a data one — the same distinction AGENTS.md draws
         * when it allows destructive data migrations to be irreversible.
         * Rolling back past this point on a deployment that has taken
         * uploads means restoring from the backup the runbook requires,
         * not running this and hoping.
         */
        Schema::table('driver_documents', function (Blueprint $table) {
            $table->dropColumn('encrypted');
        });
    }
};
