<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The contract between a fleet and a client (ADR-0055 §6).
 *
 * This is the record that makes *"a corporate client on two or more fleets"*
 * expressible at all. The owner asked for it twice, and until now the schema
 * has had nowhere to put the answer: `tenants` is the client's identity and
 * `operators` is the fleet's, with nothing joining them.
 *
 * ## Identity stays the client's; the relationship is the fleet's
 *
 * Centenary Bank's legal name, registration number and address are facts about
 * the Bank. If Fleet A could edit them, Fleet A would be rewriting Fleet B's
 * client — a cross-fleet **write**, and the mirror of the read leak ADR-0001
 * calls the worst bug this platform can have. So identity stays on
 * `tenants`/`companies` and only the relationship lands here.
 *
 * ## The money fields override rather than move, and that is a change of plan
 *
 * `docs/fleet-model-plan.md` said `billing_email` and `credit_limit_minor`
 * would move **off** `companies` and onto the contract, leaving one source of
 * truth. They stay, and the contract carries nullable overrides instead.
 *
 * The reason is blast radius against value. Both fields are **inert** — they
 * appear in `Company`, its two requests and `CompanyResource`, and nowhere
 * else; no credit limit is enforced and no invoice is sent to that address.
 * Dropping them would change the API contract, so it would need
 * `docs/api/openapi.yaml`, `frontend/src/types/company.ts` and every screen
 * reading them, and would put the ADR-0011 contract gate in the path of a
 * change that buys no capability today.
 *
 * Overriding is also the pattern this effort already established one package
 * ago: F1's reference data is *"Kangaru's default, which a fleet may
 * override"*, and this is the same shape one level in — the client's default,
 * which a contract may override. Null here means "use the client's", exactly
 * as null means "use Kangaru's" there. The two-sources-of-truth objection is
 * answered by the resolution rule being explicit rather than by there being
 * only one row.
 *
 * When something finally consumes a credit limit, that is the moment the
 * fields earn a migration of their own.
 *
 * ## Status is not `tenants.status` and not `companies.status`
 *
 * `tenants.status` answers *is this client on the platform at all*.
 * `companies.status` duplicates it and predates this question. This one
 * answers *is this fleet currently serving them* — a client can be perfectly
 * active while one of its two contracts has ended.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('operator_client', function (Blueprint $table) {
            $table->id();

            $table->foreignId('operator_id')->constrained()->restrictOnDelete();
            $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();

            // The relationship's own state, not the client's (see docblock).
            $table->string('status', 16)->default('active');
            $table->date('started_on')->nullable();
            $table->date('ended_on')->nullable();

            // Null means "use the client's own value on `companies`". Present
            // means this fleet bills them differently.
            $table->string('billing_email')->nullable();
            $table->unsignedBigInteger('credit_limit_minor')->nullable();

            $table->timestamps();

            // One contract per pair. A second relationship with the same fleet
            // is the same relationship; ending and restarting it is
            // `status` and the dates, not another row — otherwise "which
            // contract prices this trip" has more than one answer.
            $table->unique(['operator_id', 'tenant_id']);

            // The client's side of the question — "who serves this client" —
            // is the one the switcher asks on every page load, and the unique
            // above leads with the fleet, so it cannot serve it.
            $table->index(['tenant_id', 'status']);
        });

        // Every client on the platform today is served by Shanitah and by
        // nobody else. `started_on` is left null rather than invented: the
        // date a contract began is a commercial fact this schema does not
        // hold, and a plausible-looking guess in a contract record is worse
        // than an honest blank.
        $now = now();

        $rows = DB::table('tenants')->pluck('id')->map(fn ($tenantId) => [
            'operator_id' => 1,
            'tenant_id' => $tenantId,
            'status' => 'active',
            'started_on' => null,
            'ended_on' => null,
            'billing_email' => null,
            'credit_limit_minor' => null,
            'created_at' => $now,
            'updated_at' => $now,
        ])->all();

        if ($rows !== []) {
            DB::table('operator_client')->insert($rows);
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('operator_client');
    }
};
