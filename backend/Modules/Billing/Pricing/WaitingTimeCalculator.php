<?php

namespace Modules\Billing\Pricing;

use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Trips\Models\TripEvent;

/**
 * Derives billable waiting time from the append-only trip timeline.
 *
 * AGENTS.md, Trip State Machine: "Waiting-time billing is computed from
 * `trip_events`, never from a mutable column."
 *
 * That rule is the whole reason this class exists rather than a
 * `waiting_minutes` column on `trips`. A column can be edited by anyone who
 * can write to the trip, and a client disputing a waiting charge would have
 * no way to check it. The timeline can only be appended to, so the charge
 * can always be re-derived and shown.
 *
 * A waiting period opens on a transition *into* Waiting and closes on the
 * next transition of any kind. In the current state graph that next
 * transition is always Trip Resumed, but this deliberately does not assume
 * so: if the graph ever gains another exit from Waiting, the period still
 * closes correctly rather than silently running on.
 */
class WaitingTimeCalculator
{
    /**
     * Whole minutes waited across the whole trip, before the rate card's
     * free allowance is applied.
     *
     * Seconds are summed across every waiting period and truncated to
     * minutes once, at the end. Truncating each period separately would
     * discard up to 59 seconds per period and systematically under-bill a
     * trip that waited three times; rounding each period up would
     * over-bill it. One truncation of the true total is the only version of
     * this that is defensible to a client.
     */
    public function minutesFor(Trip $trip): int
    {
        return intdiv($this->secondsFor($trip), 60);
    }

    public function secondsFor(Trip $trip): int
    {
        $events = TripEvent::query()
            ->where('trip_id', $trip->id)
            // created_at has second granularity, so two transitions in the
            // same second would otherwise come back in an arbitrary order
            // and could pair a period's end with its own start.
            ->orderBy('created_at')
            ->orderBy('id')
            ->get(['id', 'to_status', 'created_at']);

        $seconds = 0;
        $waitingSince = null;

        foreach ($events as $event) {
            if ($event->to_status === TripStatus::WAITING) {
                // Only the first of consecutive Waiting events opens the
                // period; the graph does not allow Waiting -> Waiting, but
                // treating a repeat as a restart would silently drop time.
                $waitingSince ??= $event->created_at;

                continue;
            }

            if ($waitingSince !== null) {
                $seconds += (int) $waitingSince->diffInSeconds($event->created_at);
                $waitingSince = null;
            }
        }

        // A trip still sitting in Waiting has an open period with no end to
        // measure against. It is not billable yet, and it cannot be
        // invoiced either — only a Trip Completed trip reaches billing.
        return $seconds;
    }
}
