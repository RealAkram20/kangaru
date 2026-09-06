<?php

namespace Modules\Trips\Distance;

use Modules\Dispatch\Support\GreatCircle;

/**
 * Step 1 of the measured-distance algorithm: decide which pings are evidence
 * (`docs/measured-distance-plan.md` §2, ADR-0045).
 *
 * Pure. Points in, points out, and a tally of the ones that did not make it,
 * by reason. Nothing here knows about a database, a trip or a setting — the
 * thresholds arrive as a value — which is what lets every rule below be
 * pinned by a unit test on a hand-built trace.
 *
 * ## The rules, in the order they are applied to each ping
 *
 * 1. **Mock** — the device said this fix came from a mock-location provider.
 *    Dropped, and counted separately from everything else, because one such
 *    ping is enough to make the whole trace untrustworthy: the resolver
 *    refuses to bill from a trace with any mock in it.
 * 2. **Accuracy** — the device rated the fix worse than the ceiling. A ping
 *    with no accuracy figure is kept; "did not say" is not "said it was bad".
 * 3. **Duplicate** — same second as the previous kept ping. Two fixes in one
 *    second cannot yield a speed, and `recorded_at` has second resolution.
 * 4. **Teleport** — the implied speed from the previous kept ping is beyond
 *    what any vehicle on the fleet does. Consumer GPS produces these when it
 *    re-acquires after a tunnel, and spoofing apps produce them when the
 *    operator drags the pin. Counted, because a trace with more than a
 *    handful is not believed at all.
 * 5. **Jitter** — closer to the previous kept ping than the noise floor. A
 *    parked vehicle still pings, and its receiver wanders; this is the same
 *    rule `RouteDistanceCalculator` applies, expressed on points rather than
 *    segments so the map-matcher never sees the wander either.
 *
 * Each rule compares against the previous **kept** ping, not the previous
 * raw one. A teleport followed by a ping back on the road is one bad fix,
 * not two: the return leg is measured from the last good position, where
 * it is an ordinary move.
 *
 * Input must already be in recorded order — the loader orders by
 * `recorded_at, id` — and the first ping is always kept, because there is
 * nothing before it to compare against.
 *
 * ## Presence is not the same as evidence
 *
 * A ping dropped for jitter, accuracy or a duplicate second still proves the
 * handset was awake and reporting at that moment; only a mock ping proves
 * nothing. So every non-mock timestamp is also returned as *presence*, and
 * that — not the kept points — is what coverage is computed from. Without
 * this, a vehicle parked for twenty minutes with its tracker running would
 * read as twenty minutes of dead zone, because every ping in that stretch
 * was rightly dropped as jitter.
 */
class TraceCleaner
{
    /**
     * @param  array<int, TracePoint>  $points  in recorded order
     */
    public function clean(array $points, DistanceThresholds $thresholds): CleanedTrace
    {
        $dropped = array_fill_keys(CleanedTrace::REASONS, 0);
        $kept = [];
        $presence = [];
        $previous = null;

        foreach ($points as $point) {
            if ($point->isMock) {
                $dropped['mock']++;

                continue;
            }

            $presence[] = $point->recordedAt;

            if ($point->accuracyMetres !== null && $point->accuracyMetres > $thresholds->maxPingAccuracyMetres) {
                $dropped['accuracy']++;

                continue;
            }

            if ($previous !== null) {
                $seconds = $point->recordedAt - $previous->recordedAt;

                if ($seconds <= 0) {
                    $dropped['duplicate']++;

                    continue;
                }

                $metres = GreatCircle::kilometres(
                    $previous->latitude,
                    $previous->longitude,
                    $point->latitude,
                    $point->longitude,
                ) * 1000;

                if (($metres / $seconds) * 3.6 > $thresholds->maxPlausibleSpeedKph) {
                    $dropped['teleport']++;

                    continue;
                }

                if ($metres < $thresholds->minSegmentMetres) {
                    $dropped['jitter']++;

                    continue;
                }
            }

            $kept[] = $point;
            $previous = $point;
        }

        return new CleanedTrace(points: $kept, presence: $presence, total: count($points), dropped: $dropped);
    }
}
