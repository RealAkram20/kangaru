<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A record that somebody became somebody else, and for how long (ADR-0056).
 *
 * ## Why a table rather than a token claim
 *
 * ADR-0056 §2 requires that **starting and ending a session are themselves
 * audited**, not only the acts inside one: *"a session that opened, looked, and
 * changed nothing must still leave a record — reading a bank's trip history is
 * the act, whether or not anything was written."* A claim inside a bearer token
 * records nothing when it is minted and nothing when it lapses. A row does
 * both, and it is the same row the time-box reads.
 *
 * ## The subject is a morph, and only one half is implemented
 *
 * The owner asked for *"any tenant, corporate client, walk-in client and
 * drivers"*. Three of those four are `users` rows. A walk-in is a `Customer`
 * (ADR-0013) — a different model behind a different guard — so becoming one is
 * a second mechanism, not a second row shape.
 *
 * The columns are polymorphic so that half does not need a migration when it
 * lands, but **this pass implements `User` subjects only** and the session
 * service refuses a `Customer` with a message saying so. A morph with one
 * implemented type is speculative if nobody asked for the second; here it was
 * asked for by name.
 *
 * ## `reason` is required, which ADR-0056 does not demand
 *
 * A judgement, made because the first question an auditor asks a support log is
 * *why*, and the cheapest moment to capture it is the one where somebody is
 * already typing. A nullable column here would be null on every row within a
 * month.
 *
 * ## No cascade on either side
 *
 * `restrictOnDelete` both ways. A support session is evidence: deleting the
 * employee who used it, or the person it was used on, must not quietly remove
 * the record that it happened. Accounts are deactivated on this platform, not
 * deleted (`users.status`), so this refuses an act nothing legitimate performs.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('impersonation_sessions', function (Blueprint $table) {
            $table->id();

            // The real hand. Always a Kangaru account (ADR-0056 §6).
            $table->foreignId('actor_user_id')->constrained('users')->restrictOnDelete();

            // Who they became. `users` today; `customers` when the walk-in
            // half lands — see the class docblock.
            $table->string('subject_type');
            $table->unsignedBigInteger('subject_id');

            $table->string('reason', 255);

            // `dateTime`, not `timestamp`, and it is not a style preference.
            //
            // MySQL and MariaDB give the **first** non-nullable `TIMESTAMP`
            // column in a table an implicit `DEFAULT CURRENT_TIMESTAMP` and
            // every one after it `DEFAULT '0000-00-00 00:00:00'` — which
            // strict mode then refuses outright: *"Invalid default value for
            // 'expires_at'"*. Observed on the first run of this migration, not
            // predicted.
            //
            // `DATETIME` carries no implicit default, and these are absolute
            // instants the application stamps rather than row-modification
            // times, which is what `TIMESTAMP` is actually for.
            $table->dateTime('started_at');
            // The time-box. ADR-0056 §5: "an acting-as session that outlives
            // the support call is an unattended key."
            $table->dateTime('expires_at');
            $table->dateTime('ended_at')->nullable();

            $table->string('ip_address', 45)->nullable();

            $table->timestamps();

            // The question every request asks: "is this actor currently acting
            // as somebody?" — answered by one indexed read on the hot path.
            $table->index(['actor_user_id', 'ended_at']);

            // And the question a client's auditor asks: "was my account ever
            // used by support?"
            $table->index(['subject_type', 'subject_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('impersonation_sessions');
    }
};
