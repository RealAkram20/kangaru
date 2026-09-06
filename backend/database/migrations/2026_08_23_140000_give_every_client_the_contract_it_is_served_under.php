<?php

use App\Models\Operator;
use App\Models\OperatorClient;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Every corporate client that predates `operator_client` gets the contract it
 * has been served under all along (ADR-0060, `K6`).
 *
 * ## Why this is needed before the scope can be narrowed
 *
 * `companies` has no `operator_id` — the link to a fleet is the join table —
 * so `BelongsToTenant::narrowToFleet()` cannot reach it. Its own docblock says
 * as much: the fleet half is *"applied only to models that actually record a
 * fleet"*, and the other fifteen tenant-scoped models have no column to filter
 * on.
 *
 * The consequence, verified against the running database rather than reasoned
 * about: **a fleet's Super Admin currently reads every corporate client on the
 * platform.** With one fleet that is invisible. With two it is the cross-fleet
 * leak ADR-0055 §6 exists to prevent, on a table the concern could not reach.
 *
 * `K6` narrows that read to the clients a fleet actually serves. Narrowing it
 * against a table where no client has a contract would take every fleet from
 * *"sees everybody"* to *"sees nobody"* — so the contracts have to exist
 * first, and this is where they come from.
 *
 * ## Every existing client is Shanitah's, because Shanitah is the only fleet
 *
 * The same reasoning F0 used when it backfilled `operator_id` across six
 * tables: there has only ever been one fleet, so *"which fleet served this"*
 * has exactly one answer and inventing a choice would be dishonest. If a
 * second fleet had ever existed this migration could not be written, and it
 * would have to be a decision rather than a backfill.
 *
 * `started_on` is deliberately **null** rather than today's date. The contract
 * did not start today; it has been in force since the client was onboarded,
 * and stamping a date that is provably wrong is worse than admitting the date
 * is unknown.
 */
return new class extends Migration
{
    public function up(): void
    {
        $shanitah = Operator::query()->find(Operator::SHANITAH);

        // A deployment with no Shanitah is a deployment F0 never ran on, and
        // there is nothing here to backfill toward.
        if ($shanitah === null) {
            return;
        }

        DB::table('companies')
            ->whereNull('deleted_at')
            ->orderBy('id')
            ->select('tenant_id')
            ->chunk(200, function ($clients) use ($shanitah) {
                foreach ($clients as $client) {
                    OperatorClient::query()->firstOrCreate(
                        ['operator_id' => $shanitah->id, 'tenant_id' => $client->tenant_id],
                        ['status' => OperatorClient::ACTIVE, 'started_on' => null],
                    );
                }
            });
    }

    /**
     * Only the rows this migration could have created, and only while they
     * still look untouched.
     *
     * A contract somebody has since ended, or given a start date, or attached
     * billing terms to, is a decision a human made — reversing this migration
     * must not silently discard it. Deleting on the whole pair would.
     */
    public function down(): void
    {
        OperatorClient::query()
            ->where('operator_id', Operator::SHANITAH)
            ->where('status', OperatorClient::ACTIVE)
            ->whereNull('started_on')
            ->whereNull('ended_on')
            ->whereNull('billing_email')
            ->whereNull('credit_limit_minor')
            ->delete();
    }
};
