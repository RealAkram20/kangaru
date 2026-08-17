<?php

namespace Modules\Fleet\Services;

use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;
use Modules\Drivers\Services\DriverEarningsService;
use Modules\Fleet\Models\DriverShiftWindow;

/**
 * How many hours a driver was *rostered* for over a stretch of calendar
 * (ADR-0017 §3).
 *
 * `AvailabilityService` asks a shift window a yes/no question about one
 * moment. This asks it an arithmetic question about a span, which needs the
 * window turned back into intervals on real days — and the reason that is not
 * simply `ends_at - starts_at` is the overnight case: an 18:00→06:00 window
 * describes a night shift, not an empty set, and it lands twelve hours on two
 * different calendar days.
 *
 * ## Null means "no roster", and is not zero
 *
 * ADR-0017 §3 makes an empty roster mean **available at any hour**, which is
 * how every driver on the platform starts. Returning 0 for them would make
 * the Performance screen tell a driver who worked eight hours that they
 * worked eight of nothing — and any ratio built on it would be a division by
 * zero dressed up as a percentage. Null says "there is no target here", and
 * the screen draws no arc.
 */
class RosterService
{
    public function __construct(private readonly DriverEarningsService $earnings) {}

    /**
     * Rostered seconds inside `[$from, $to)`, or null when this driver has no
     * roster at all.
     */
    public function secondsIn(int $driverId, CarbonImmutable $from, CarbonImmutable $to): ?int
    {
        /** @var Collection<int, DriverShiftWindow> $windows */
        $windows = DriverShiftWindow::query()->where('driver_id', $driverId)->get();

        if ($windows->isEmpty()) {
            return null;
        }

        $timezone = $this->earnings->timezone();
        $localFrom = $from->setTimezone($timezone);
        $localTo = $to->setTimezone($timezone);

        if (! $localTo->greaterThan($localFrom)) {
            return 0;
        }

        $seconds = 0;

        // Walk local calendar days, starting one day early. A window that
        // wraps past midnight begins on the *previous* day and reaches into
        // the first hours of this one, so a walk that started on the window's
        // own first day would silently drop that tail.
        $day = $localFrom->startOfDay()->subDay();
        $lastDay = $localTo->startOfDay();

        while (! $day->greaterThan($lastDay)) {
            foreach ($windows as $window) {
                if ($window->weekday !== $day->dayOfWeek) {
                    continue;
                }

                [$start, $end] = $this->intervalOn($day, $window);

                $overlapStart = $start->greaterThan($localFrom) ? $start : $localFrom;
                $overlapEnd = $end->lessThan($localTo) ? $end : $localTo;

                if ($overlapEnd->greaterThan($overlapStart)) {
                    $seconds += $overlapEnd->diffInSeconds($overlapStart, true);
                }
            }

            $day = $day->addDay();
        }

        return (int) $seconds;
    }

    /**
     * The window as a real interval on `$day`.
     *
     * `setTimeFromTimeString` rather than string arithmetic, so a shift that
     * spans a DST change lands on the wall-clock hours the roster names —
     * which is the property `create_driver_shift_windows_table` chose TIME
     * columns for. A shift is "six in the morning" to the person driving it.
     *
     * @return array{0: CarbonImmutable, 1: CarbonImmutable}
     */
    private function intervalOn(CarbonImmutable $day, DriverShiftWindow $window): array
    {
        $start = $day->setTimeFromTimeString($window->starts_at);
        $end = $day->setTimeFromTimeString($window->ends_at);

        // Wraps midnight — the night shift. It ends on the following day, and
        // `covers()` on the model implements the same rule for its own
        // question.
        if (! $end->greaterThan($start)) {
            $end = $end->addDay();
        }

        return [$start, $end];
    }
}
