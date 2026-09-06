<?php

namespace Modules\Drivers\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Modules\Drivers\Models\DriverPayoutAccount;

/**
 * A payout destination **as the office needs it** (ADR-0042 §4).
 *
 * This one carries the whole account number, because a clerk cannot wire money
 * to a mask. That is the entire reason it is a separate class from
 * `DriverPayoutAccountResource` rather than a flag on it: a boolean would put
 * "reveal the bank account" one wrong argument away, on a resource rendered by
 * a driver-facing endpoint.
 *
 * **The route that renders this is gated on `drivers.manage` and audited.**
 * A read here is a staff member looking at somebody's bank account, which is
 * exactly the kind of access AGENTS.md expects to be answerable for.
 *
 * @mixin DriverPayoutAccount
 */
class OfficePayoutAccountResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'kind' => $this->kind->value,
            'kind_label' => $this->kind->label(),
            'institution' => $this->institution,
            // The whole values, decrypted by the model's casts. Allow-listed
            // field by field even so — the model is never spread, because the
            // object being spread here is somebody's bank account.
            'account_holder' => $this->account_holder,
            'account_number' => $this->account_number,
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }
}
