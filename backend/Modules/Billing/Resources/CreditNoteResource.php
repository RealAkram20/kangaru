<?php

namespace Modules\Billing\Resources;

use App\Support\Money\Shillings;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Modules\Billing\Models\CreditNote;
use Modules\Billing\Models\CreditNoteLine;

/**
 * @mixin CreditNote
 */
class CreditNoteResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'uuid' => $this->uuid,
            'credit_note_number' => $this->credit_note_number,
            'invoice_id' => $this->invoice_id,
            'currency' => $this->currency,
            // Positive: the amount taken off the invoice.
            'total_minor' => Shillings::toMinor($this->total()),
            'reason' => $this->reason,
            'issued_at' => $this->issued_at,
            'issued_by_user_id' => $this->issued_by_user_id,
            'lines' => $this->whenLoaded('lines', fn () => $this->lines->map(fn (CreditNoteLine $line) => [
                'line_number' => $line->line_number,
                'description' => $line->description,
                'amount_minor' => Shillings::toMinor($line->amount()),
                // Null on a goodwill or settlement credit that corrects no
                // single line.
                'invoice_line_id' => $line->invoice_line_id,
            ])),
        ];
    }
}
