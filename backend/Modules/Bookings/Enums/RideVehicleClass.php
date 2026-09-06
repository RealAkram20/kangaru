<?php

namespace Modules\Bookings\Enums;

/**
 * The ride classes the public order form offers, and the fleet category each
 * one is priced as.
 *
 * ## Two vocabularies, one meeting point
 *
 * The customer chooses a *class* — Economy, Standard, XL, Boda, Electric Boda
 * — which is a promise about the ride. The tariff prices a *vehicle category*
 * (`Vehicle::CATEGORIES`: sedan, suv, van, boda …), which is a fact about a
 * van. Until now nothing joined them: `details.vehicle_class` was validated
 * against a literal list in `StorePublicOrderRequest`, the driver's estimate
 * was priced from whatever vehicle happened to accept, and the customer's
 * form showed a hard-coded "from UGX 12,500" that no rate card had ever
 * produced — the owner: *"the web app is showing the trip price according to
 * the vehicles, of which I thought the logic was implemented"*. It was; it was
 * not connected. This enum is the connection, so a class can be quoted
 * before any vehicle exists.
 *
 * ## The mapping is a product decision, recorded here rather than guessed twice
 *
 * - `economy` → `sedan`, `standard` → `suv`, `xl` → `van`: the three car
 *   classes onto the three car categories, smallest to largest.
 * - `boda` → `boda`.
 * - `electric_boda` → `boda`. **An assumption**, flagged in
 *   `docs/agent-worklog.md`: `electric_boda` is not a `Vehicle::CATEGORIES`
 *   member, so it cannot carry its own rate today. When the office wants it
 *   priced differently the fix is a new category on the fleet and one line
 *   here — not a second table.
 */
enum RideVehicleClass: string
{
    case ECONOMY = 'economy';
    case STANDARD = 'standard';
    case XL = 'xl';
    case BODA = 'boda';
    case ELECTRIC_BODA = 'electric_boda';

    /** The `Vehicle::CATEGORIES` member the tariff prices this class as. */
    public function vehicleCategory(): string
    {
        return match ($this) {
            self::ECONOMY => 'sedan',
            self::STANDARD => 'suv',
            self::XL => 'van',
            self::BODA, self::ELECTRIC_BODA => 'boda',
        };
    }

    /** @return list<string> */
    public static function values(): array
    {
        return array_map(fn (self $class) => $class->value, self::cases());
    }
}
