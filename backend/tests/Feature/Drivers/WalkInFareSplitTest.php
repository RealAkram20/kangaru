<?php

declare(strict_types=1);

use App\Models\Operator;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Models\DriverWalkInContract;
use Modules\Drivers\Services\WalkInFareSplit;

/**
 * Splitting a walk-in fare three ways (ADR-0063, `K8`).
 *
 * **The property, and it is the only one that really matters:** the three
 * shares sum to the fare, on every rounding boundary. Three parties on one
 * figure means three ways to get the sum wrong, and the wrong ones do not look
 * wrong — they look like a fare that is a shilling out, on one trip, once.
 */
function splitContract(int $commissionBp = 1500, int $fleetBp = 1000, ?int $operatorId = null): DriverWalkInContract
{
    $driver = Driver::factory()->create(['operator_id' => Operator::SHANITAH]);

    return DriverWalkInContract::create([
        'driver_id' => $driver->id,
        'operator_id' => $operatorId ?? Operator::SHANITAH,
        'status' => DriverWalkInContract::ACTIVE,
        'kangaru_commission_bp' => $commissionBp,
        'fleet_share_bp' => $fleetBp,
    ]);
}

it('takes commission for Kangaru and a share for the fleet', function () {
    $split = app(WalkInFareSplit::class)->of(100_000, splitContract(), onFleetVehicle: true);

    expect($split['kangaru'])->toBe(15_000)
        ->and($split['fleet'])->toBe(10_000)
        ->and($split['driver'])->toBe(75_000);
});

/**
 * ADR-0063 §2. The share is **for the vehicle**, not for the driver — so a
 * driver-partner on their own car has no fleet share, and the money that would
 * have gone to a fleet goes to them rather than to Kangaru.
 */
it('pays no fleet share on a driver-partner s own vehicle', function () {
    $split = app(WalkInFareSplit::class)->of(100_000, splitContract(), onFleetVehicle: false);

    expect($split['fleet'])->toBe(0)
        ->and($split['kangaru'])->toBe(15_000)
        ->and($split['driver'])->toBe(85_000);
});

/**
 * **The one that matters.** Every awkward fare, every rounding boundary, and
 * the three shares still sum exactly — because the driver takes the remainder
 * rather than a third percentage.
 */
it('always sums to the fare, whatever the rounding', function () {
    $split = app(WalkInFareSplit::class);
    $contract = splitContract(commissionBp: 3333, fleetBp: 3333);

    foreach ([1, 2, 3, 7, 99, 101, 1_001, 12_345, 99_999, 1_000_003] as $fare) {
        foreach ([true, false] as $onFleetVehicle) {
            $shares = $split->of($fare, $contract, $onFleetVehicle);

            expect($shares['kangaru'] + $shares['fleet'] + $shares['driver'])
                ->toBe($fare, "fare {$fare} did not sum");
        }
    }
});

/**
 * Rounding goes to the driver deliberately: they are the party who cannot
 * re-invoice a rounding error, and they are holding the cash.
 */
it('gives the rounding remainder to the driver, never to Kangaru', function () {
    // 1 shilling at 33.33% each: both percentages round down to nothing.
    $split = app(WalkInFareSplit::class)->of(1, splitContract(3333, 3333), onFleetVehicle: true);

    expect($split['kangaru'])->toBe(0)
        ->and($split['fleet'])->toBe(0)
        ->and($split['driver'])->toBe(1);
});

it('never pays out more than the fare, even at the extremes', function () {
    $split = app(WalkInFareSplit::class)->of(50_000, splitContract(5000, 5000), onFleetVehicle: true);

    expect($split['kangaru'] + $split['fleet'])->toBe(50_000)
        ->and($split['driver'])->toBe(0);
});

/**
 * Read from the **trip's** record of whose vehicle it was, not the driver's
 * row today: a driver who buys their own car next year must not retroactively
 * unpay the fleet whose vehicle they drove last year.
 */
it('decides the fleet share from the contract and the trip, not from today', function () {
    $split = app(WalkInFareSplit::class);

    expect($split->onFleetVehicle(Operator::SHANITAH, driverOwnedTheVehicle: false))->toBeTrue()
        ->and($split->onFleetVehicle(Operator::SHANITAH, driverOwnedTheVehicle: true))->toBeFalse()
        ->and($split->onFleetVehicle(null, driverOwnedTheVehicle: false))->toBeFalse();
});
