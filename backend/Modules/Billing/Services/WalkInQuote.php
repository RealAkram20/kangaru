<?php

namespace Modules\Billing\Services;

/**
 * What a walk-in ride is estimated to cost (ADR-0026 §2).
 *
 * Carries the distance it was computed from, not just the total. A figure
 * with no basis is one a passenger cannot sanity-check and a dispatcher
 * cannot explain — and the distance is the part that is an estimate, so
 * showing it is what makes the estimate legible rather than merely labelled.
 */
final class WalkInQuote
{
    public function __construct(
        public readonly string $vehicleCategory,
        /** Great-circle kilometres. Under-reads against real roads, on purpose. */
        public readonly float $distanceKm,
        /** Minor units. UGX is zero-decimal, so this is shillings. */
        public readonly int $totalMinor,
        public readonly string $currency,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'vehicle_category' => $this->vehicleCategory,
            'distance_km' => $this->distanceKm,
            'total_minor' => $this->totalMinor,
            'currency' => $this->currency,
            // Said in the payload, not only in the UI. Any client rendering
            // this has to be able to tell a quote from a bill, and a flag
            // beats every client remembering to add the word.
            'is_estimate' => true,
            'basis' => 'Straight-line distance. The final fare follows the distance actually travelled.',
        ];
    }
}
