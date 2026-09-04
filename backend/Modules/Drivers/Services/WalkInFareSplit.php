<?php

namespace Modules\Drivers\Services;

use Modules\Drivers\Models\DriverWalkInContract;

/**
 * Splitting a walk-in fare three ways (ADR-0063 §2 and §4).
 *
 * ## The property this class exists to hold
 *
 * > **The three shares sum to the fare. Always, on every rounding boundary.**
 *
 * Three parties on one figure means three ways to get the sum wrong, and the
 * wrong ones do not look wrong — they look like a fare that is a shilling out,
 * on one trip, once. The test that matters here is not that each share is
 * right; it is that they add up.
 *
 * ## Who gets what, and why the fleet's share is conditional
 *
 * | Party | Takes | When |
 * |---|---|---|
 * | Kangaru | commission | always — it supplied the demand |
 * | The fleet | a share | **only where its vehicle was used** |
 * | The driver | the remainder | always — and they collected the cash |
 *
 * The fleet's share is **for the vehicle, not for the driver**, which is the
 * whole of the owner's wording: *a share of a walk-in run **on its vehicle***.
 * So a driver-partner who owns their car has no fleet share — there is no
 * fleet asset involved and no fleet to pay.
 *
 * ## Rounding goes to the driver, deliberately
 *
 * Both percentages are rounded **down** and the driver takes what is left.
 * That is not arbitrary: the driver is the party who cannot re-invoice a
 * rounding error, and they are the one holding the cash. It also makes the
 * sum exact by construction rather than by three separate roundings happening
 * to agree — which they do not, at a third of a shilling.
 */
class WalkInFareSplit
{
    private const BASIS_POINTS = 10_000;

    /**
     * @return array{kangaru: int, fleet: int, driver: int}
     */
    public function of(int $fareMinor, DriverWalkInContract $contract, bool $onFleetVehicle): array
    {
        // Rounded down, so the remainder is always non-negative and always the
        // driver's. `intdiv` rather than a float: money never touches a float
        // in this codebase (AGENTS.md).
        $kangaru = intdiv($fareMinor * $contract->kangaru_commission_bp, self::BASIS_POINTS);

        $fleet = $onFleetVehicle
            ? intdiv($fareMinor * $contract->fleet_share_bp, self::BASIS_POINTS)
            : 0;

        return [
            'kangaru' => $kangaru,
            'fleet' => $fleet,
            // The remainder, never a fourth percentage. This is what makes the
            // three sum to the fare by construction.
            'driver' => $fareMinor - $kangaru - $fleet,
        ];
    }

    /**
     * Whether the fleet's share applies, read from the **trip's** record of
     * whose vehicle it was rather than from the driver's row today.
     *
     * A driver who buys their own car next year must not retroactively unpay
     * the fleet whose vehicle they were driving last year (ADR-0063 §2).
     */
    public function onFleetVehicle(?int $contractOperatorId, bool $driverOwnedTheVehicle): bool
    {
        return $contractOperatorId !== null && ! $driverOwnedTheVehicle;
    }
}
