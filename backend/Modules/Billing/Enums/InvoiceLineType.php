<?php

namespace Modules\Billing\Enums;

/**
 * The kinds of line an invoice can carry.
 *
 * Every charge and every adjustment is its own line, including the ones
 * that only cap or lift a total. AGENTS.md requires an invoice to be "fully
 * reproducible from stored data", and a minimum charge applied by silently
 * overwriting the total is not reproducible — the line says so instead, and
 * the arithmetic on the printed invoice adds up.
 *
 * Persisted as a string; never repurpose a case.
 */
enum InvoiceLineType: string
{
    case BASE_FARE = 'base_fare';
    case DISTANCE = 'distance';
    case WAITING = 'waiting';
    case MINIMUM_CHARGE_ADJUSTMENT = 'minimum_charge_adjustment';
    case MAXIMUM_CHARGE_ADJUSTMENT = 'maximum_charge_adjustment';

    public function label(): string
    {
        return match ($this) {
            self::BASE_FARE => 'Base fare',
            self::DISTANCE => 'Distance',
            self::WAITING => 'Waiting time',
            self::MINIMUM_CHARGE_ADJUSTMENT => 'Minimum charge adjustment',
            self::MAXIMUM_CHARGE_ADJUSTMENT => 'Maximum charge adjustment',
        };
    }

    /**
     * Whether this line is a real charge rather than a correction applied
     * to the running subtotal. The minimum/maximum adjustments are computed
     * from the sum of the chargeable lines, so they must not be included in
     * the sum they are derived from.
     */
    public function isChargeable(): bool
    {
        return match ($this) {
            self::BASE_FARE, self::DISTANCE, self::WAITING => true,
            self::MINIMUM_CHARGE_ADJUSTMENT, self::MAXIMUM_CHARGE_ADJUSTMENT => false,
        };
    }
}
