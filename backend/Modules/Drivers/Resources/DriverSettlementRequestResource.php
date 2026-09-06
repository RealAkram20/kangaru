<?php

namespace Modules\Drivers\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Modules\Drivers\Models\DriverSettlementRequest;

/**
 * A settlement request, for the driver who raised it and for the office queue.
 *
 * @mixin DriverSettlementRequest
 */
class DriverSettlementRequestResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'driver_id' => $this->driver_id,
            // The trip a tip was taken on (ADR-0034 §1); null on the other
            // two kinds, which cover a day's takings rather than one journey.
            'trip_id' => $this->trip_id,
            'kind' => $this->kind->value,
            'kind_label' => $this->kind->label(),
            'status' => $this->status->value,
            'status_label' => $this->status->label(),
            // **Always positive.** The direction is `kind`, and the signed
            // figure only ever exists on the ledger entry a confirmation
            // produces — see `SettlementRequestKind::ledgerSign()`.
            'amount_minor' => $this->amount_minor,
            'currency' => $this->currency,
            // The driver's own words about the handover, which is the only
            // record of its circumstances.
            'note' => $this->note,
            // Present only on a decline, and never empty when it is: a
            // refusal with no reason is how a driver stops using a feature.
            'decline_reason' => $this->decline_reason,
            'reviewed_at' => $this->reviewed_at?->toIso8601String(),
            /**
             * Which ledger entry the confirmation produced, or null.
             *
             * Served so a driver's app can point from the request to the row
             * that settled it, and so the office can prove a request paid
             * exactly once — the field is what makes confirmation idempotent.
             */
            'ledger_entry_id' => $this->ledger_entry_id,
            // `->`, not `?->`: `created_at` is non-nullable on this model —
            // a row cannot exist without one — and Larastan is right to
            // refuse a nullsafe call that can never be null.
            'created_at' => $this->created_at->toIso8601String(),
        ];
    }
}
