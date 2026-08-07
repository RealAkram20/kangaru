<?php

namespace Modules\Fleet\Services;

use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Modules\Drivers\Models\Driver;
use Modules\Fleet\Enums\AvailabilityResource;
use Modules\Fleet\Models\AvailabilityBlock;
use Modules\Fleet\Models\DriverShiftWindow;
use Modules\Trips\Enums\TripStatus;
use Modules\Vehicles\Models\Vehicle;

/**
 * Whether a driver or a vehicle can take work in a given window (ADR-0017).
 *
 * ## One question, one answer
 *
 * Before this, "available" meant three different things in three places:
 * `VehicleCandidates` meant `status = active`, `TripAssignmentGuard` meant
 * "not on a live trip", and nothing at all meant "not on leave". A
 * dispatcher could therefore be shown a vehicle the workshop had, and be
 * refused only after choosing it — or worse, not refused.
 *
 * This service is the single place all four signals are combined, and both
 * the candidate listing and the assignment path call it. That is the same
 * "one rule, one place" discipline `AllocationLookup` already holds for
 * contracts, and for the same reason: two implementations of the same
 * refusal drift silently, and the drift shows up as a list that says free
 * and an assignment that says no.
 *
 * ## Order of checks
 *
 * Cheapest and most decisive first — a retired vehicle needs no calendar
 * query — and the reason returned is the *first* that applies, because a
 * dispatcher wants the one fact that changes what they do next, not all
 * four.
 *
 * ## What it deliberately does not know
 *
 * Contracts. `AllocationLookup` answers those, and it needs a client to
 * answer for; this service answers a question about the resource alone.
 * `VehicleCandidates` composes the two.
 */
class AvailabilityService
{
    public function forVehicle(int $vehicleId, CarbonInterface $from, CarbonInterface $to, ?int $ignoreTripId = null): Availability
    {
        $vehicle = Vehicle::query()->whereKey($vehicleId)->first();

        if ($vehicle === null || $vehicle->status !== 'active') {
            return Availability::blocked(
                Availability::OUT_OF_SERVICE,
                'This vehicle is not in service.',
            );
        }

        if (($trip = $this->occupyingTripId('vehicle_id', $vehicleId, $ignoreTripId)) !== null) {
            return Availability::blocked(
                Availability::ON_TRIP,
                "This vehicle is already on trip #{$trip}.",
            );
        }

        return $this->blockVerdict(AvailabilityResource::VEHICLE, $vehicleId, $from, $to);
    }

    public function forDriver(int $driverId, CarbonInterface $from, CarbonInterface $to, ?int $ignoreTripId = null): Availability
    {
        $driver = Driver::query()->whereKey($driverId)->first();

        if ($driver === null || $driver->status !== 'active') {
            return Availability::blocked(
                Availability::OUT_OF_SERVICE,
                'This driver is not available for work.',
            );
        }

        if (($trip = $this->occupyingTripId('driver_id', $driverId, $ignoreTripId)) !== null) {
            return Availability::blocked(
                Availability::ON_TRIP,
                "This driver is already on trip #{$trip}.",
            );
        }

        $blocked = $this->blockVerdict(AvailabilityResource::DRIVER, $driverId, $from, $to);

        if (! $blocked->free) {
            return $blocked;
        }

        return $this->shiftVerdict($driverId, $from, $to);
    }

    /**
     * Drivers free for the window, in a single pass rather than N queries.
     *
     * The dispatch board asks this for every booking it renders, so the
     * naive shape — loop the roster calling `forDriver` — is an N+1 against
     * three tables. AGENTS.md's performance rule is not advisory at 3,000
     * drivers.
     *
     * @return Collection<int, Driver>
     */
    public function availableDrivers(CarbonInterface $from, CarbonInterface $to): Collection
    {
        $drivers = Driver::query()->where('status', 'active')->orderBy('name')->get();

        if ($drivers->isEmpty()) {
            return $drivers;
        }

        $ids = $drivers->pluck('id')->all();

        $busy = DB::table('trips')
            ->whereNull('deleted_at')
            ->whereIn('status', TripStatus::occupyingValues())
            ->whereIn('driver_id', $ids)
            ->pluck('driver_id')
            ->map(fn ($id) => (int) $id)
            ->flip();

        $blocked = AvailabilityBlock::query()
            ->binding()
            ->where('resource_type', AvailabilityResource::DRIVER)
            ->whereIn('resource_id', $ids)
            ->overlapping($from, $to)
            ->pluck('resource_id')
            ->map(fn ($id) => (int) $id)
            ->flip();

        $windows = DriverShiftWindow::query()
            ->whereIn('driver_id', $ids)
            ->get()
            ->groupBy('driver_id');

        return $drivers
            ->reject(fn (Driver $driver) => $busy->has($driver->id) || $blocked->has($driver->id))
            ->filter(fn (Driver $driver) => $this->onShift(
                $windows->get($driver->id) ?? collect(), $from, $to,
            ))
            ->values();
    }

    /**
     * @return Collection<int, int> ids of vehicles unavailable for the window,
     *                              for the candidate listing to mark
     */
    public function unavailableVehicleIds(CarbonInterface $from, CarbonInterface $to): Collection
    {
        $busy = DB::table('trips')
            ->whereNull('deleted_at')
            ->whereIn('status', TripStatus::occupyingValues())
            ->pluck('vehicle_id');

        $blocked = AvailabilityBlock::query()
            ->binding()
            ->where('resource_type', AvailabilityResource::VEHICLE)
            ->overlapping($from, $to)
            ->pluck('resource_id');

        return $busy->concat($blocked)->map(fn ($id) => (int) $id)->unique()->values();
    }

    /**
     * The window a booking occupies.
     *
     * A trip's real duration is not knowable before it happens, so this is
     * an assumption, and it is configuration rather than a literal
     * (AGENTS.md — configuration driven). Too short and a driver is offered
     * two overlapping jobs; too long and the fleet looks busier than it is.
     *
     * @return array{0: CarbonImmutable, 1: CarbonImmutable}
     */
    public function windowFor(?CarbonInterface $scheduledFor): array
    {
        $from = CarbonImmutable::parse($scheduledFor ?? now());

        return [$from, $from->addMinutes((int) config('dispatch.assumed_trip_minutes'))];
    }

    private function blockVerdict(AvailabilityResource $type, int $id, CarbonInterface $from, CarbonInterface $to): Availability
    {
        $block = AvailabilityBlock::query()
            ->binding()
            ->forResource($type, $id)
            ->overlapping($from, $to)
            ->orderBy('starts_at')
            ->first();

        return $block === null
            ? Availability::free()
            : Availability::blocked(Availability::BLOCKED, $block->kind->dispatchNote());
    }

    private function shiftVerdict(int $driverId, CarbonInterface $from, CarbonInterface $to): Availability
    {
        $windows = DriverShiftWindow::query()->where('driver_id', $driverId)->get();

        return $this->onShift($windows, $from, $to)
            ? Availability::free()
            : Availability::blocked(Availability::OFF_SHIFT, 'This driver is not rostered for that time.');
    }

    /**
     * A driver with no roster is available at any hour — which is what keeps
     * ADR-0017 additive: every driver predates this table, and dispatch must
     * behave for them exactly as it did before it existed.
     *
     * With a roster, *both* ends of the window must fall inside it. Checking
     * only the start would roster a driver onto a job beginning ten minutes
     * before they clock off.
     *
     * @param  Collection<int, DriverShiftWindow>  $windows
     */
    private function onShift(Collection $windows, CarbonInterface $from, CarbonInterface $to): bool
    {
        if ($windows->isEmpty()) {
            return true;
        }

        $timezone = (string) config('billing.timezone');

        // The end is exclusive, so the instant to test is the last one the
        // trip actually occupies — a shift ending at 18:00 covers a job
        // finishing at 18:00.
        $lastMoment = CarbonImmutable::parse($to)->subSecond();

        return $windows->contains(fn (DriverShiftWindow $w) => $w->covers($from, $timezone))
            && $windows->contains(fn (DriverShiftWindow $w) => $w->covers($lastMoment, $timezone));
    }

    private function occupyingTripId(string $column, int $id, ?int $ignoreTripId): ?int
    {
        $trip = DB::table('trips')
            ->whereNull('deleted_at')
            ->whereIn('status', TripStatus::occupyingValues())
            ->where($column, $id)
            ->when($ignoreTripId !== null, fn ($q) => $q->where('id', '!=', $ignoreTripId))
            ->value('id');

        return $trip === null ? null : (int) $trip;
    }
}
