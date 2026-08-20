<?php

namespace Modules\Trips\Services;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Modules\Administration\Services\SettingsService;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Events\TripCompleted;
use Modules\Trips\Events\TripStatusChanged;
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
        private readonly OdometerPhotoStore $photos,
        private readonly SettingsService $settings,
        private readonly TripDistanceResolver $distances,
    ) {}

    /**
     * Moves a trip along its lifecycle, recording who did it.
     *
     * `$actor` is nullable because not every principal on this platform is a
     * `User`. A walk-in passenger cancelling their own ride (ADR-0024 §7) is
     * authenticated on the `customer` guard and has no staff account, and
     * inventing a system user to stand in for them would put a fictitious
     * name on a real audit row. `trip_events.user_id` is already nullable and
     * `TripEvent::record` already takes `?User`; this signature was the only
     * thing insisting otherwise.
     *
     * Null means "no staff user did this", not "nobody did" — callers pass a
     * note saying who, and every existing caller still passes an actor.
     *
     * @param  array<string, mixed>  $payload
     */
    public function transition(Trip $trip, TripStatus $to, ?User $actor, array $payload = []): Trip
    {
        $from = $trip->status;

        if (! $from->canTransitionTo($to)) {
            throw new InvalidTripTransitionException($from, $to);
        }

        // Stored before the transaction opens, deliberately. A file write is
        // not transactional, and holding a row lock for the length of a
        // mobile upload to object storage would be far worse than the
        // orphaned file it avoids — so the upload happens first and is
        // cleaned up explicitly if the database work then fails.
        $photoPath = $this->photos->storeForTransition(
            $trip,
            $to,
            $payload['odometer_photo'] ?? null,
        );

        try {
            return DB::transaction(function () use ($trip, $from, $to, $actor, $payload, $photoPath) {
                $remark = $this->applySideEffects($trip, $from, $to, $payload, $photoPath);

                $trip->status = $to;
                $trip->save();

                TripEvent::record($trip, $from, $to, $actor, $this->note($payload['notes'] ?? null, $remark));

                // Announced, not acted on. `trip_completed` is the
                // transition that captures the closing odometer and computes
                // the distance, so it is the first moment a fare can exist —
                // and this module deliberately does not know that anybody
                // prices anything (see the event's docblock, and
                // `BookingApproved` before it).
                if ($to === TripStatus::TRIP_COMPLETED) {
                    TripCompleted::dispatch($trip);
                }

                // Every move, for whoever is waiting on the car; see the
                // event's docblock for why this is not folded into the one
                // above.
                TripStatusChanged::dispatch($trip, $from, $to);

                return $trip->refresh();
            });
        } catch (\Throwable $e) {
            $this->photos->discard($photoPath);

            throw $e;
        }
    }

    /**
     * Applies the transition's side effects, and returns anything the
     * timeline should say about them beyond what the caller wrote.
     *
     * Only the closing transition has such a thing to say today: with the
     * odometer off, *why* a trip was priced at the figure it was — measured,
     * capped at the road ceiling, or not measurable at all — is not deducible
     * from the columns, and a reviewer opening a flagged trip should not have
     * to infer it (ADR-0047 §2).
     *
     * Returned rather than held on the service. This class is resolved as a
     * singleton, so a property written here would outlive the trip that set
     * it and land on the next one — a note about somebody else's journey,
     * appearing on a timeline that is treated as evidence.
     *
     * @param  array<string, mixed>  $payload
     */
    private function applySideEffects(Trip $trip, TripStatus $from, TripStatus $to, array $payload, ?string $photoPath = null): ?string
    {
        return match ($to) {
            TripStatus::TRIP_STARTED => $this->captureOpeningOdometer($trip, $payload, $photoPath),
            TripStatus::TRIP_COMPLETED => $this->captureClosingOdometer($trip, $payload, $photoPath),
            TripStatus::CANCELLED => (function () use ($trip, $payload) {
                $trip->cancellation_charge_applicable = $payload['cancellation_charge_applicable'] ?? null;

                return null;
            })(),
            TripStatus::ASSIGNED => (function () use ($trip, $from, $payload) {
                $this->applyReassignment($trip, $from, $payload);

                return null;
            })(),
            default => null,
        };
    }

    /**
     * The driver's own note and the platform's, as one paragraph.
     *
     * The driver's comes first: they wrote it, and a reviewer reading a
     * timeline wants the human sentence before the machine's. Either half may
     * be absent, and both absent is null rather than an empty string — an
     * empty note renders as a blank line on the timeline and reads as
     * something having failed to save.
     */
    private function note(?string $written, ?string $remark): ?string
    {
        $parts = array_filter([
            is_string($written) && trim($written) !== '' ? trim($written) : null,
            $remark,
        ]);

        return $parts === [] ? null : implode("\n\n", $parts);
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function captureOpeningOdometer(Trip $trip, array $payload, ?string $photoPath = null): ?string
    {
        // **`started_at` is unconditional; the reading is not** (ADR-0047).
        // The timestamp is the Bank's acceptance criterion #1 and has nothing
        // to do with the odometer — an early version of this guarded the whole
        // method on the switch and produced trips that had started with no
        // record of when, which broke a criterion the switch was never meant
        // to touch.
        $trip->started_at = now();

        if (! $this->distances->odometerEnabled()) {
            return null;
        }

        $trip->odometer_start = $payload['odometer_start'];

        if ($photoPath !== null) {
            $trip->odometer_start_photo_path = $photoPath;
        }

        return null;
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function captureClosingOdometer(Trip $trip, array $payload, ?string $photoPath = null): ?string
    {
        // Unconditional, like `started_at` above and for the same reason:
        // acceptance criteria #1 and #6 are about the clock, not the dial.
        $trip->completed_at = now();

        // **The odometer is off, so the trace prices the trip** (ADR-0047 §2).
        // `TripDistanceResolver` owns that decision entirely, including the
        // road ceiling that keeps a jittery or spoofed trace from inflating a
        // fare, and including the case where it cannot answer at all.
        if (! $this->distances->odometerEnabled()) {
            $measured = $this->distances->resolve($trip->id);

            // Null distance is written as null, not coerced. A trip the
            // platform could not measure must reach billing as unpriced work
            // somebody resolves — never as a zero-kilometre journey, which
            // reads as "the vehicle did not move" and invites nobody to look.
            $trip->distance_km = $measured->kilometres === null
                ? null
                : (string) $measured->kilometres;

            // The raw trace is kept even when the ceiling overrode it. It is
            // the evidence a reviewer needs to answer a disputed fare: "the
            // trace said 41 km, the road allows 15.6, we billed 15.6".
            $trip->gps_distance_km = $measured->traceKilometres === null
                ? null
                : (string) $measured->traceKilometres;

            $trip->distance_variance_flagged = $measured->flagged;

            // Returned to `transition()`, which writes it onto the timeline
            // row — so *why* this trip was priced the way it was is readable
            // beside the status change rather than deduced from three columns.
            return $measured->note;
        }

        $trip->odometer_end = $payload['odometer_end'];

        if ($photoPath !== null) {
            $trip->odometer_end_photo_path = $photoPath;
        }
        // Cast because `distance_km` is a decimal:2 attribute and reads back
        // as a string; assigning the raw int would have the property hold
        // two different types depending on whether the model was reloaded.
        $trip->distance_km = (string) ($trip->odometer_end - $trip->odometer_start);

        $this->reconcileAgainstGps($trip);

        return null;
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

        // The office's number, not an env var's (ADR-0035). It was
        // `config('tracking.variance_threshold_percent')`, which meant the
        // threshold behind PROJECT.md's "reviewed within two business days"
        // metric could only be changed by a deploy, was invisible in the
        // console, and was not audited. Same default, so nothing moves until
        // somebody decides it should.
        $trip->distance_variance_flagged = $variancePercent
            > (float) $this->settings->get('tracking', 'variance_threshold_percent');
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
