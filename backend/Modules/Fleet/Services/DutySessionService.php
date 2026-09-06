<?php

namespace Modules\Fleet\Services;

use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Modules\Fleet\Models\DriverDutySession;
use Modules\Trips\Enums\TripStatus;

/**
 * Shifts: when a driver went on duty, when they came off, and how long that
 * adds up to (ADR-0038).
 *
 * The half of `driver_presence` that had no history. Presence answers "is
 * this driver available right now, and where" and is a snapshot; this answers
 * "how long were they available", and needs rows that survive.
 *
 * ## The three ways a shift ends, and why the third exists
 *
 * A driver presses the switch, or the platform stops hearing from them, or
 * they press the switch again without ever having pressed it off (a reinstall,
 * a second handset). Only the first is tidy.
 *
 * The second is the one that makes the figure honest. A shift that ended only
 * when somebody remembered to end it would report a phone left in a drawer
 * over a weekend as a fifty-hour week, and the first time that figure was
 * quoted at a driver it would be indefensible.
 */
class DutySessionService
{
    public function __construct(private readonly RosterService $roster) {}

    /**
     * Opens a shift, or leaves the one already running alone.
     *
     * **Idempotent, because `PUT /me/duty` is.** That route's own comment
     * says a driver whose request times out and retries "must not end up
     * having started two shifts", and this is where that promise is kept —
     * the presence upsert it sits beside is naturally idempotent and this is
     * not.
     *
     * The vehicle is refreshed on the open session rather than ignored: a
     * driver who signs on, is handed different keys and signs on again is
     * telling the platform something true about the shift they are already
     * working.
     */
    public function open(int $driverId, ?int $vehicleId, ?CarbonImmutable $at = null): DriverDutySession
    {
        $now = $at ?? CarbonImmutable::now();
        $open = $this->openSession($driverId);

        if ($open !== null) {
            $open->forceFill(['vehicle_id' => $vehicleId])->save();

            return $open;
        }

        return DriverDutySession::create([
            'driver_id' => $driverId,
            'vehicle_id' => $vehicleId,
            'started_at' => $now,
            // Seeded to the start rather than left null, so a shift that
            // ends before the app's first position still has a defensible
            // close point and is not swept from a null.
            'last_seen_at' => $now,
            'ended_at' => null,
            'ended_reason' => null,
        ]);
    }

    /**
     * Closes the running shift. A no-op when there is none.
     *
     * Silent rather than throwing, because the caller is a driver pressing a
     * switch: signing off when the platform already believes you are off is
     * not an error a driver can act on, and `PUT /me/duty` answers "you are
     * off duty" either way. The two agreeing is the point.
     */
    public function close(int $driverId, ?CarbonImmutable $at = null, string $reason = DriverDutySession::ENDED_BY_DRIVER): void
    {
        $open = $this->openSession($driverId);

        if ($open === null) {
            return;
        }

        $endedAt = $at ?? CarbonImmutable::now();

        $open->forceFill([
            // Never before the start. A clock adjustment between the two
            // writes would otherwise store a negative shift, and every sum
            // downstream would quietly lose those minutes with nothing
            // looking wrong.
            'ended_at' => $endedAt->lessThan($open->started_at) ? $open->started_at : $endedAt,
            'ended_reason' => $reason,
        ])->save();
    }

    /**
     * Records that the platform heard from this driver.
     *
     * Called from the presence heartbeat. Raw query builder and no model
     * hydration, matching `DatabaseDriverPresenceStore`'s reasoning: this
     * runs on every heartbeat from every handset, and loading a model to
     * write one column it then discards is work for nothing. It also means
     * no Eloquent events fire — see the model's note on `Auditable`.
     */
    public function heartbeat(int $driverId, ?CarbonImmutable $at = null): void
    {
        $seenAt = ($at ?? CarbonImmutable::now())->toDateTimeString();

        DB::table('driver_duty_sessions')
            ->where('driver_id', $driverId)
            ->whereNull('ended_at')
            // Older pings never move the mark backwards, for the reason
            // `DriverPresenceStore::heartbeat()` gives: a handset catching up
            // after a tunnel sends its backlog oldest-first, and letting that
            // land would make a live shift look stale enough to sweep.
            ->where(fn ($q) => $q->whereNull('last_seen_at')->orWhere('last_seen_at', '<', $seenAt))
            ->update(['last_seen_at' => $seenAt, 'updated_at' => now()]);
    }

    /**
     * Closes shifts the platform has stopped hearing from, at their last
     * heartbeat — and refreshes the ones that are mid-journey.
     *
     * **The trip exception is not a nicety.** `PresenceController` is a
     * JavaScript `setInterval`, and it stops when the handset backgrounds the
     * app — which is exactly what a driver does when they put the phone in a
     * cradle and drive. Without this, a two-hour journey reports as three
     * minutes online and the driver is signed off with a passenger aboard.
     *
     * Being on a trip is the most on-duty a driver can be;
     * `DriverPresenceController::refusalToStartShift()` reached the same
     * conclusion for a different question, and records what it cost to learn.
     *
     * Refreshing rather than merely skipping matters: when the trip ends, the
     * shift must be sweepable from a *recent* mark. Skipping alone would leave
     * `last_seen_at` at the moment the app went to background, and the whole
     * journey would be discarded the first time the sweep ran afterwards.
     *
     * @return array{closed: int, refreshed: int}
     */
    public function sweep(?CarbonImmutable $at = null, ?int $ttlSeconds = null): array
    {
        $now = $at ?? CarbonImmutable::now();
        $ttl = $ttlSeconds ?? (int) config('dispatch.presence_ttl_seconds');
        $cutoff = $now->subSeconds(max(1, $ttl));

        /** @var Collection<int, DriverDutySession> $stale */
        $stale = DriverDutySession::query()
            ->whereNull('ended_at')
            ->where(fn ($q) => $q->whereNull('last_seen_at')->orWhere('last_seen_at', '<', $cutoff))
            ->get();

        if ($stale->isEmpty()) {
            return ['closed' => 0, 'refreshed' => 0];
        }

        $driving = $this->driversOnLiveTrips($stale->pluck('driver_id')->all());
        $closed = 0;
        $refreshed = 0;

        foreach ($stale as $session) {
            if (in_array($session->driver_id, $driving, true)) {
                $session->forceFill(['last_seen_at' => $now])->save();
                $refreshed++;

                continue;
            }

            $this->close(
                $session->driver_id,
                CarbonImmutable::parse($session->last_seen_at ?? $session->started_at),
                DriverDutySession::ENDED_BY_STALENESS,
            );
            $closed++;
        }

        return ['closed' => $closed, 'refreshed' => $refreshed];
    }

    /**
     * Seconds this driver was on duty inside `[$from, $to)`.
     *
     * Sessions are clipped to the window rather than counted whole: a shift
     * that began on Sunday night and ran into Monday belongs to both weeks,
     * in the proportion actually worked. Counting it whole in either would
     * make two weeks' figures sum to more than the time that passed.
     *
     * An **open** session is counted to `min($to, now)`. The sweep guarantees
     * an open session is either fresh or mid-trip, so the overhang is bounded
     * by the TTL — three minutes by default, on a figure rendered to the
     * nearest minute.
     */
    public function secondsIn(int $driverId, CarbonImmutable $from, CarbonImmutable $to): int
    {
        $now = CarbonImmutable::now();

        /** @var Collection<int, DriverDutySession> $sessions */
        $sessions = DriverDutySession::query()
            ->where('driver_id', $driverId)
            // Overlap, not containment: a shift that started before the
            // window and is still running has to be found by it. Anchored on
            // `started_at` so the index is used, with the open case pulled in
            // by the null branch.
            ->where('started_at', '<', $to->utc())
            ->where(fn ($q) => $q->whereNull('ended_at')->orWhere('ended_at', '>', $from->utc()))
            ->get();

        $seconds = 0;

        foreach ($sessions as $session) {
            $start = CarbonImmutable::parse($session->started_at);

            // A running shift is counted to *now*, not to its last heartbeat:
            // the driver is on duty as this is being read, and the heartbeat
            // is only how the sweep decides they have stopped being. Clipping
            // to the window below keeps a shift running past midnight out of
            // tomorrow's figure.
            $end = $session->ended_at === null
                ? $now
                : CarbonImmutable::parse($session->ended_at);

            $overlapStart = $start->greaterThan($from) ? $start : $from;
            $overlapEnd = $end->lessThan($to) ? $end : $to;

            if ($overlapEnd->greaterThan($overlapStart)) {
                $seconds += $overlapEnd->diffInSeconds($overlapStart, true);
            }
        }

        return (int) $seconds;
    }

    /**
     * Seconds this driver was *rostered* for inside the window — the
     * denominator the Performance screen draws online hours against.
     *
     * Delegated rather than computed here: shift windows are ADR-0017's and
     * the wrap-past-midnight arithmetic is subtle enough that a second
     * implementation would be a second set of bugs.
     */
    public function rosteredSecondsIn(int $driverId, CarbonImmutable $from, CarbonImmutable $to): ?int
    {
        return $this->roster->secondsIn($driverId, $from, $to);
    }

    /** The running shift, or null. */
    public function openSession(int $driverId): ?DriverDutySession
    {
        return DriverDutySession::query()
            ->where('driver_id', $driverId)
            ->whereNull('ended_at')
            // Newest first: the invariant is one open session per driver, but
            // a historical double-open must not make this method arbitrary.
            ->latest('started_at')
            ->first();
    }

    /**
     * Which of these drivers are on a trip that has not ended.
     *
     * `TripStatus` cases from assignment to the last moving state — the same
     * set that means "this driver is working right now". Terminal statuses
     * are excluded, so a driver whose last trip completed an hour ago is
     * sweepable like anybody else.
     *
     * @param  array<int, int>  $driverIds
     * @return array<int, int>
     */
    private function driversOnLiveTrips(array $driverIds): array
    {
        if ($driverIds === []) {
            return [];
        }

        $live = array_map(
            fn (TripStatus $status) => $status->value,
            [
                TripStatus::ASSIGNED,
                TripStatus::ACCEPTED,
                TripStatus::DRIVER_EN_ROUTE,
                TripStatus::DRIVER_ARRIVED,
                TripStatus::PASSENGER_ONBOARD,
                TripStatus::TRIP_STARTED,
                TripStatus::WAITING,
                TripStatus::TRIP_RESUMED,
            ],
        );

        return DB::table('trips')
            ->whereIn('driver_id', $driverIds)
            ->whereIn('status', $live)
            ->whereNull('deleted_at')
            ->distinct()
            ->pluck('driver_id')
            ->map(fn ($id) => (int) $id)
            ->all();
    }
}
