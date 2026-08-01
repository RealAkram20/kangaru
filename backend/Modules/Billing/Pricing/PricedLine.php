<?php

namespace Modules\Billing\Pricing;

use Brick\Money\Money;
use Modules\Billing\Enums\InvoiceLineType;
use Modules\Billing\Enums\RoundingMode;
use Modules\Billing\Models\InvoiceLine;

/**
 * One priced line, before it is written to an invoice.
 *
 * Carries exactly the columns `invoice_lines` stores, so persisting it is a
 * copy rather than a translation — a mapping step is where an input quietly
 * stops being recorded, and AGENTS.md requires every input to survive to
 * the invoice.
 *
 * The amount is computed once, at construction, by
 * InvoiceLine::computeAmount(): the same function the stored line later
 * re-derives itself with.
 */
final class PricedLine
{
    public readonly Money $amount;

    public function __construct(
        public readonly InvoiceLineType $type,
        public readonly string $description,
        /** Kilometres, minutes, or 1 for a flat line — the unit is the line type's own. */
        public readonly string $quantity,
        public readonly Money $unitAmount,
        public readonly RoundingMode $rounding,
        public readonly int $rateCardVersionId,
        public readonly string $vehicleCategory,
        public readonly int $multiplierBp = 10_000,
        public readonly ?string $distanceKm = null,
        public readonly ?int $waitingMinutes = null,
        /** Reserved for the geofencing engine; always null in this pass. */
        public readonly ?string $zone = null,
    ) {
        $this->amount = InvoiceLine::computeAmount(
            $unitAmount,
            $quantity,
            $multiplierBp,
            $rounding,
        );
    }

    /**
     * @return array<string, mixed>
     */
    public function toLineAttributes(int $lineNumber): array
    {
        return [
            'line_number' => $lineNumber,
            'type' => $this->type,
            'description' => $this->description,
            'quantity' => $this->quantity,
            'unit_amount_minor' => $this->unitAmount,
            'amount_minor' => $this->amount,
            'rate_card_version_id' => $this->rateCardVersionId,
            'vehicle_category' => $this->vehicleCategory,
            'zone' => $this->zone,
            'distance_km' => $this->distanceKm,
            'waiting_minutes' => $this->waitingMinutes,
            'multiplier_bp' => $this->multiplierBp,
            'rounding_mode' => $this->rounding,
        ];
    }
}
