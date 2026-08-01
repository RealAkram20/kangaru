<?php

namespace Modules\Trips\Services;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Trips\Models\TripEvent;

/**
 * The only code path allowed to change Trip::status or the bank-required
 * fields it gates (odometer, timestamps, distance). Never call
 * Trip::update(['status' => ...]) directly — it bypasses the transition
 * map, side effects, and the trip_events timeline AGENTS.md requires.
 */
class TripStateMachine
{
    public function __construct(
        private readonly TripAssignmentGuard $guard,
        private readonly RouteDistanceCalculator $routeDistance,
    ) {}

    /**
     * @param  array<string, mixed>  $payload
     */
    public function transition(Trip $trip, TripStatus $to, User $actor, array $payload = []): Trip
    {
        $from = $trip->status;

        if (! $from->canTransitionTo($to)) {
            throw new InvalidTripTransitionException($from, $to);
        }

        return DB::transaction(function () use ($trip, $from, $to, $actor, $payload) {
            $this->applySideEffects($trip, $from, $to, $payload);

            $trip->status = $to;
            $trip->save();

            TripEvent::record($trip, $from, $to, $actor, $payload['notes'] ?? null);

            return $trip->refresh();
        });
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function applySideEffects(Trip $trip, TripStatus $from, TripStatus $to, array $payload): void
    {
        match ($to) {
            TripStatus::TRIP_STARTED => $this->captureOpeningOdometer($trip, $payload),
            TripStatus::TRIP_COMPLETED => $this->captureClosingOdometer($trip, $payload),
            TripStatus::CANCELLED => $trip->cancellation_charge_applicable
                = $payload['cancellation_charge_applicable'] ?? null,
            TripStatus::ASSIGNED => $this->applyReassignment($trip, $from, $payload),
            default => null,
        };
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function captureOpeningOdometer(Trip $trip, array $payload): void
    {
        $trip->odometer_start = $payload['odometer_start'];
        $trip->started_at = now();
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function captureClosingOdometer(Trip $trip, array $payload): void
    {
        $trip->odometer_end = $payload['odometer_end'];
        $trip->completed_at = now();
        // Cast because `distance_km` is a decimal:2 attribute and reads back
        // as a string; assigning the raw int would have the property hold
        // two different types depending on whether the model was reloaded.
        $trip->distance_km = (string) ($trip->odometer_end - $trip->odometer_start);

        $this->reconcileAgainstGps($trip);
    }

    /**
     * PROJECT.md: "Odometer distance is automatically reconciled against
     * GPS-calculated distance; variances beyond a configurable threshold are
     * flagged for review."
     *
     * Runs at Trip Completed, on the odometer reading the driver has just
     * entered — the moment the two numbers can first be compared, and before
     * the trip can be invoiced.
     *
     * A trip with no GPS trace is left unflagged with `gps_distance_km` null.
     * That distinction is the whole value of the flag: "the readings
     * disagree" is a thing to investigate, "there is no GPS evidence" is not
     * the driver's doing, and flagging both would flag every trip taken
     * before a device was fitted. PROJECT.md's success metric asks for
     * flagged trips to be reviewed within two business days, which only
     * survives if the flag stays rare and means one thing.
     */
    private function reconcileAgainstGps(Trip $trip): void
    {
        $gpsKilometres = $this->routeDistance->kilometresFor($trip->id);

        if ($gpsKilometres === null) {
            return;
        }

        $trip->gps_distance_km = (string) $gpsKilometres;

        $odometerKilometres = (float) $trip->distance_km;

        // An odometer distance of zero cannot be expressed as a percentage
        // difference. Any GPS movement at all against a zero reading is a
        // disagreement worth a look.
        if ($odometerKilometres <= 0.0) {
            $trip->distance_variance_flagged = $gpsKilometres > 0.0;

            return;
        }

        $variancePercent = abs($odometerKilometres - $gpsKilometres) / $odometerKilometres * 100;

        $trip->distance_variance_flagged = $variancePercent
            > (float) config('tracking.variance_threshold_percent', 10);
    }

    /**
     * Only meaningful on the Rejected -> Assigned reassignment path — lets
     * a dispatcher swap driver/vehicle when returning a rejected trip to
     * the "pool" (same Trip row). A no-op for the initial Assigned event,
     * which is created directly by TripService::create(), not through this
     * method.
     *
     * Putting a vehicle and driver back onto a trip is an assignment like
     * any other, so it takes the same pessimistic lock — otherwise a
     * dispatcher reassigning here could race a dispatcher assigning the
     * same vehicle from the booking queue.
     *
     * @param  array<string, mixed>  $payload
     *
     * @throws VehicleUnavailableException
     * @throws DriverUnavailableException
     */
    private function applyReassignment(Trip $trip, TripStatus $from, array $payload): void
    {
        if ($from !== TripStatus::REJECTED) {
            return;
        }

        $vehicleId = (int) ($payload['vehicle_id'] ?? $trip->vehicle_id);
        $driverId = (int) ($payload['driver_id'] ?? $trip->driver_id);

        // This trip is in Rejected and so occupies nothing, but it is
        // excluded explicitly rather than relying on that — the day a
        // status's occupancy changes, this must not start reporting the
        // trip as its own conflict.
        $this->guard->assertAvailable($vehicleId, $driverId, $trip->id);

        $trip->vehicle_id = $vehicleId;
        $trip->driver_id = $driverId;
    }
}
