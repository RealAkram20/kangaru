<?php

namespace Modules\Billing\Resources;

use App\Support\Money\Shillings;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Modules\Billing\Models\InvoiceLine;

/**
 * Money crosses the wire as an integer in the minor unit plus the currency
 * — never as a formatted string and never as a float. A client that wants
 * "UGX 4,750" formats it; a client that receives 4750.0 has already lost.
 *
 * The `inputs` block is the reproducibility contract made visible: it is
 * every value that went into `amount_minor`, so a client disputing a line
 * can check the arithmetic without asking us for a database export.
 *
 * @mixin InvoiceLine
 */
class InvoiceLineResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            // Served because a credit note line may be attributed to a
            // specific invoice line, and StoreCreditNoteRequest validates
            // that reference against `invoice_lines.id`. Without it a client
            // has no way to name the line it is correcting. Unlike an
            // invoice, a line has no uuid — it is only ever addressed from
            // within its own invoice, which is already uuid-keyed, so this
            // exposes no cross-tenant surface of its own.
            'id' => $this->id,
            'line_number' => $this->line_number,
            'type' => $this->type->value,
            // The stable machine value plus a display name, so a client
            // grouping by type does not have to keep its own copy of the
            // wording — the same reasoning as `allowed_transitions` on
            // TripResource.
            'type_label' => $this->type->label(),
            // Rendered when the invoice was issued, not now: the wording on
            // an issued document must not change when a label in the code
            // does. `type_label` is presentation; this is the document.
            'description' => $this->description,
            'quantity' => $this->quantity,
            'unit_amount_minor' => Shillings::toMinor($this->unitAmount()),
            'amount_minor' => Shillings::toMinor($this->amount()),
            // From the invoice rather than configuration — an issued
            // document must not start reporting a currency it was never
            // priced in. `invoice_id` is a non-nullable FK, so the relation
            // always resolves.
            'currency' => $this->invoice->currency,

            // AGENTS.md: "Every invoice line stores its inputs ... An
            // invoice must be fully reproducible from stored data."
            'inputs' => [
                'rate_card_version_id' => $this->rate_card_version_id,
                'vehicle_category' => $this->vehicle_category,
                // Always null until the geofencing engine exists.
                'zone' => $this->zone,
                'distance_km' => $this->distance_km,
                'waiting_minutes' => $this->waiting_minutes,
                'multiplier_bp' => $this->multiplier_bp,
                'rounding_mode' => $this->rounding_mode->value,
            ],
        ];
    }
}
