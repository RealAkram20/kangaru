<?php

namespace Modules\Clients\Services;

use App\Models\OperatorClient;
use Illuminate\Support\Facades\DB;
use Modules\Clients\Models\Company;

/**
 * Setting which fleets serve a corporate client (ADR-0060, ADR-0062).
 *
 * ## Why this exists, and what it changes
 *
 * ADR-0060 §5 gave the contract to the client — *"theirs to grant, and nobody
 * else's — not Kangaru's"* — and `OperatorClientPolicy::end()` said the same:
 * head office *"is not a party to a contract between two other
 * organisations."* That governed the case the ADR was written for, which is a
 * **fleet asking** to serve somebody else's client, where consent has to come
 * from the client or the ask is not an ask.
 *
 * The owner's decision of 24 August adds the case it did not cover: head
 * office already names the first fleet when it onboards, so it is already
 * choosing a supplier — and being unable to correct that choice afterwards
 * meant a client onboarded onto the wrong fleet stayed there for ever. Head
 * office may now set the whole set, and a fleet still cannot help itself to a
 * client: `store` on `ContractController` is untouched and still asks.
 *
 * ## A set, not a single fleet
 *
 * *"we can asign multer fleetcompanies"*. A client may be served by several
 * (ADR-0060 §1), so the endpoint takes the whole set and reconciles to it,
 * rather than offering an add and a remove that a caller has to sequence
 * correctly. Sending `[1, 3]` means those two serve the client and nobody
 * else does — which is a statement anybody can verify by reading the form,
 * where "add 3, remove 2" is a statement about history.
 *
 * ## Removing a fleet ends the contract; it never deletes the row
 *
 * ADR-0060 §7: *"a contract ends without ending the client. The row stays: the
 * trips and invoices it explains are still the client's history."* Deleting
 * would strand every invoice raised under it against a relationship the
 * database says never existed.
 *
 * The same fact makes re-adding a fleet a **revival** rather than an insert:
 * the unique pair is already on the table, so a blind create is a duplicate-key
 * failure the first time anybody changes their mind and changes it back.
 */
class ClientFleetAssignment
{
    /**
     * @param  list<int>  $operatorIds  the fleets that serve this client, in full
     */
    public function set(Company $company, array $operatorIds): void
    {
        $wanted = array_values(array_unique($operatorIds));

        DB::transaction(function () use ($company, $wanted): void {
            /*
             * Every row for this client, including ended ones and requests.
             *
             * `requested` rows are deliberately in scope: a fleet has asked,
             * head office is now saying who serves this client, and leaving a
             * dangling request would put an answerable question in front of
             * the client about a fleet that is already serving them. Naming a
             * requested fleet activates it; not naming it leaves the request
             * alone, because refusing on the client's behalf is the one thing
             * ADR-0060 §5 still forbids.
             */
            $existing = OperatorClient::query()
                ->where('tenant_id', $company->tenant_id)
                ->get()
                ->keyBy('operator_id');

            foreach ($existing as $operatorId => $contract) {
                if ($contract->status === OperatorClient::ACTIVE && ! in_array($operatorId, $wanted, true)) {
                    $contract->update([
                        'status' => OperatorClient::ENDED,
                        'ended_on' => now()->toDateString(),
                    ]);
                }
            }

            foreach ($wanted as $operatorId) {
                $contract = $existing->get($operatorId);

                if ($contract === null) {
                    OperatorClient::create([
                        'operator_id' => $operatorId,
                        'tenant_id' => $company->tenant_id,
                        'status' => OperatorClient::ACTIVE,
                        'started_on' => now()->toDateString(),
                    ]);

                    continue;
                }

                if ($contract->status !== OperatorClient::ACTIVE) {
                    // `ended_on` cleared, or the row would claim to have
                    // finished on a date before the day it restarted.
                    $contract->update([
                        'status' => OperatorClient::ACTIVE,
                        'started_on' => now()->toDateString(),
                        'ended_on' => null,
                    ]);
                }
            }
        });
    }
}
