<?php

namespace Modules\Dispatch\Services;

use App\Models\User;
use Carbon\CarbonInterface;
use Illuminate\Support\Collection;
use Modules\Bookings\Models\Booking;
use Modules\Drivers\Models\Driver;
use Modules\Fleet\Services\Availability;
use Modules\Fleet\Services\AvailabilityService;

/**
 * The driver roster, judged for one booking (ADR-0017).
 *
 * The sibling of `VehicleCandidates`, and it exists for the same reason: a
 * dispatcher was being offered every active driver with nothing to say which
 * of them was on leave, rostered off, or already out on a job. The rule was
 * enforced — the assignment endpoint refuses them — so it was discovered by
 * being stopped rather than by looking, which is a rule the product keeps to
 * itself.
 *
 * ## Listed, not filtered out
 *
 * An unavailable driver is returned with `dispatchable: false` and a reason
 * rather than dropped, for the reason ADR-0009 already gives about vehicles:
 * a dispatcher who knows the roster will ask where somebody went, and
 * silence is the worst available answer.
 *
 * ## The note is deliberately vague
 *
 * "Not available for this time", not "on sick leave". A board is shared
 * across a depot and a driver's health is not a dispatch input; the fact
 * that changes what the dispatcher does next is simply that this person
 * cannot take the job. The specific kind stays on the block, queryable by
 * the people who are supposed to see it.
 *
 * ## One rule, one place
 *
 * Every verdict comes from `AvailabilityService`, which is also what
 * `DispatchService` enforces with. Two implementations would drift, and the
 * drift would show up as a list that says free beside an endpoint that says
 * no.
 */
class DriverCandidates
{
    public function __construct(private readonly AvailabilityService $availability) {}

    /**
     * @return Collection<int, array{driver: Driver, dispatchable: bool, note: string|null}>
     */
    public function forBooking(Booking $booking, User $actor): Collection
    {
        [$from, $to] = $this->availability->windowFor($booking->scheduled_for);

        // One query for the free set rather than one verdict per driver:
        // this list is rendered every time a dispatcher opens a booking, and
        // at 3,000 drivers the naive shape is an N+1 across three tables.
        $free = $this->availability->availableDrivers($from, $to)->pluck('id')->flip();

        // `forActor`, for the reason `VehicleCandidates` sets out beside the
        // same line: `BelongsToOperator` has no global scope, so a bare query
        // here put every fleet's roster on this fleet's board — names and
        // licence numbers of a competitor's drivers.
        return Driver::forActor($actor)
            ->where('status', 'active')
            ->orderBy('name')
            ->get()
            ->map(fn (Driver $driver) => [
                'driver' => $driver,
                'dispatchable' => $free->has($driver->id),
                'note' => $free->has($driver->id) ? null : $this->note($driver, $from, $to),
            ])
            // Available first, then by name so the order is stable rather
            // than incidental. `sortBy` is stable in Laravel, so the name
            // ordering above survives underneath.
            ->sortBy(fn (array $row) => $row['dispatchable'] ? 0 : 1)
            ->values();
    }

    /**
     * One extra verdict per *unavailable* driver, not per driver.
     *
     * The bulk query answers "who is free" and cannot say why anybody is
     * not; a dispatcher needs the reason only for the ones they are being
     * refused, and on a healthy roster that is a short list.
     */
    private function note(Driver $driver, CarbonInterface $from, CarbonInterface $to): string
    {
        $verdict = $this->availability->forDriver($driver->id, $from, $to);

        return match ($verdict->code) {
            Availability::ON_TRIP => 'Already out on a trip.',
            Availability::OFF_SHIFT => 'Not rostered for this time.',
            default => 'Not available for this time.',
        };
    }
}
