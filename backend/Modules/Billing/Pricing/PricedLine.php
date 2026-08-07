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
        /**
         * The zone whose rate priced this line, or null when the vehicle
         * category's default rate did (ADR-0021, billing half).
         *
         * Null is deliberately *not* "we did not record it": a trip whose
         * pickup fell inside a zone that carries no rate for this category
         * is priced by the default rate and records no zone, because the
         * zone contributed nothing to the amount. That keeps the column
         * meaning what it meant on every invoice issued before zone pricing
         * existed.
         *
         * The name is the snapshot for the issued document; the id is what
         * identifies the rate row, since zones can be renamed.
         */
        public readonly ?string $zone = null,
        public readonly ?int $zoneId = null,
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
            'zone_id' => $this->zoneId,
            'distance_km' => $this->distanceKm,
            'waiting_minutes' => $this->waitingMinutes,
            'multiplier_bp' => $this->multiplierBp,
            'rounding_mode' => $this->rounding,
        ];
    }
}
