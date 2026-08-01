<?php

namespace Modules\Billing\Resources;

use App\Support\Money\Shillings;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Modules\Billing\Models\Invoice;

/**
 * @mixin Invoice
 */
class InvoiceResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            // The uuid is the external reference (AGENTS.md Database
            // Standards); the integer id is not served at all, so a client
            // cannot come to depend on it and cannot count another tenant's
            // invoices by watching it climb.
            'uuid' => $this->uuid,
            'invoice_number' => $this->invoice_number,
            'trip_id' => $this->trip_id,
            'rate_card_version_id' => $this->rate_card_version_id,

            'currency' => $this->currency,
            'total_minor' => Shillings::toMinor($this->total()),
            // Derived from the credit notes, so an invoice that has been
            // partly credited never has to be read alongside a second
            // endpoint to know what is actually owed.
            'credited_minor' => Shillings::toMinor($this->creditedTotal()),
            'balance_minor' => Shillings::toMinor($this->balance()),

            'issued_at' => $this->issued_at,
            'issued_by_user_id' => $this->issued_by_user_id,
            'notes' => $this->notes,

            'lines' => InvoiceLineResource::collection($this->whenLoaded('lines')),
            'credit_notes' => CreditNoteResource::collection($this->whenLoaded('creditNotes')),
        ];
    }
}
