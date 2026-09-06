<?php

namespace Modules\Trips\Distance;

/**
 * Step 5 of the measured-distance algorithm: four witnesses in, one figure
 * and a grade out (`docs/measured-distance-plan.md` §2, ADR-0045).
 *
 * Pure, and deliberately the smallest class in this namespace. Everything
 * that touches a database, a clock or a network happens before it (loading,
 * cleaning, matching, routing) or after it (persisting). What is left is the
 * rule — and the rule is what a bank's auditor and a driver's dispute both
 * come down to, so it is written to be read as a table and tested as one.
 *
 * ## The rule, for `GPS_PRIMARY`
 *
 *   trace trusted     → bill the trace.
 *                       A if the road agrees (within tolerance, plus half a
 *                       kilometre), B if it does not — a detour, or a road
 *                       the map lacks. Billed either way.
 *   trace not trusted → the odometer stands in, held inside the corridor the
 *     but road known      reference allows. B if the reading sat inside it
 *                       untouched, C if it had to be clamped: a reading the
 *                       road contradicts is held for a person.
 *   no road either    → the odometer, graded U: nothing vouches for it and
 *                       nothing contradicts it. Whether that bills is the
 *                       policy's call (`DistanceGate`), not the evidence's.
 *
 * "Trusted" is every bar at once: enough of the trip covered by pings, not
 * too much of the distance inferred across gaps, no mock-location ping
 * anywhere in it, and no more teleports than the operator allows. A trace
 * with no kilometres at all is not a trace, so `gpsKm === null` fails it.
 *
 * `ROUTE_CAPPED` is the same, then capped at the reference plus the detour
 * allowance unless the driver declared a stop. `ODOMETER` bills the reading
 * and grades it against the others — A when a trusted trace agrees with it,
 * B when it sits inside the road's corridor, C when a trusted trace
 * contradicts it or it falls outside the corridor, U when nothing can vouch
 * for it or against it.
 *
 * ## What is *not* here
 *
 * No averaging, no median. An earlier sketch billed the median of the three
 * figures; it was dropped because a median cannot be explained to a driver
 * in one sentence and it lets a bad odometer reading pull a good trace by a
 * third. Every branch below bills exactly one witness and says which.
 */
class DistanceResolver
{
    public function decide(
        DistanceWitnesses $witnesses,
        DistancePolicy $policy,
        DistanceThresholds $thresholds,
    ): DistanceDecision {
        $trusted = $this->traceTrusted($witnesses, $thresholds);

        $decision = match ($policy) {
            DistancePolicy::GPS_PRIMARY,
            DistancePolicy::ROUTE_CAPPED => $this->fromTrace($witnesses, $policy, $thresholds, $trusted),
            DistancePolicy::ODOMETER => $this->fromOdometer($witnesses, $policy, $thresholds, $trusted),
        };

        if ($policy === DistancePolicy::ROUTE_CAPPED) {
            $decision = $this->capDetour($decision, $witnesses, $thresholds);
        }

        return $decision;
    }

    private function traceTrusted(DistanceWitnesses $w, DistanceThresholds $t): bool
    {
        return $w->gpsKm !== null
            && $w->coveragePercent !== null
            && $w->coveragePercent >= $t->minCoveragePercent
            && $w->inferredSharePercent !== null
            && $w->inferredSharePercent <= $t->maxInferredSharePercent
            && $w->mockDropped === 0
            && $w->teleportsDropped <= $t->maxTeleports;
    }

    private function fromTrace(
        DistanceWitnesses $w,
        DistancePolicy $policy,
        DistanceThresholds $t,
        bool $trusted,
    ): DistanceDecision {
        if ($trusted) {
            /** @var float $gps */
            $gps = $w->gpsKm;

            if ($w->routeKm === null) {
                return $this->decision($gps, DistanceGrade::VERIFIED, $policy, true,
                    sprintf('Measured %.2f km from a trusted trace; no reference route to compare.', $gps));
            }

            return $this->roadAgrees($gps, $w->routeKm, $t)
                ? $this->decision($gps, DistanceGrade::VERIFIED, $policy, true,
                    sprintf('Measured %.2f km from a trusted trace; reference route %.2f km agrees.', $gps, $w->routeKm))
                : $this->decision($gps, DistanceGrade::BOUNDED, $policy, true,
                    sprintf('Measured %.2f km from a trusted trace; reference route %.2f km disagrees beyond tolerance.', $gps, $w->routeKm));
        }

        $why = $this->whyNotTrusted($w, $t);

        if ($w->routeKm !== null && $w->odometerKm !== null) {
            $floor = $this->metres($w->routeKm * $t->corridorFloorPercent / 100);
            $ceiling = $this->metres($w->routeKm * $t->corridorCeilingPercent / 100);
            $clamped = min(max($w->odometerKm, $floor), $ceiling);

            if ($clamped === $w->odometerKm) {
                return $this->decision($clamped, DistanceGrade::BOUNDED, $policy, false,
                    sprintf('%s; odometer %.2f km sits inside the corridor %.2f–%.2f km around reference route %.2f km.',
                        $why, $w->odometerKm, $floor, $ceiling, $w->routeKm));
            }

            return $this->decision($clamped, DistanceGrade::HELD, $policy, false,
                sprintf('%s; odometer %.2f km clamped to %.2f km by the corridor %.2f–%.2f km around reference route %.2f km.',
                    $why, $w->odometerKm, $clamped, $floor, $ceiling, $w->routeKm));
        }

        if ($w->odometerKm !== null) {
            return $this->unverifiedOrHeld($w, $policy, $why, $w->odometerKm);
        }

        // No odometer at all. Whatever was measured or routed is the only
        // figure there is, and nothing vouches for it — held, because a trip
        // with neither a reading nor a trustworthy trace has nothing a fare
        // could honestly stand on.
        $fallback = $w->gpsKm ?? $w->routeKm ?? 0.0;

        return $this->decision($fallback, DistanceGrade::HELD, $policy, false,
            sprintf('%s; no odometer reading, so %.2f km is the only figure available.', $why, $fallback));
    }

    private function fromOdometer(
        DistanceWitnesses $w,
        DistancePolicy $policy,
        DistanceThresholds $t,
        bool $trusted,
    ): DistanceDecision {
        if ($w->odometerKm === null) {
            // A contract that bills the odometer, and no odometer. The trace
            // is the only figure, and under this policy it is not the one the
            // contract named, so it is held for somebody to decide.
            $fallback = $w->gpsKm ?? $w->routeKm ?? 0.0;

            return $this->decision($fallback, DistanceGrade::HELD, $policy, $trusted,
                sprintf('Odometer policy but no odometer reading; %.2f km is the only figure available.', $fallback));
        }

        $odo = $w->odometerKm;

        if ($trusted) {
            /** @var float $gps */
            $gps = $w->gpsKm;

            return $this->roadAgrees($odo, $gps, $t)
                ? $this->decision($odo, DistanceGrade::VERIFIED, $policy, true,
                    sprintf('Odometer %.2f km; trusted trace %.2f km agrees.', $odo, $gps))
                : $this->decision($odo, DistanceGrade::HELD, $policy, true,
                    sprintf('Odometer %.2f km; trusted trace %.2f km contradicts it beyond tolerance.', $odo, $gps));
        }

        $why = $this->whyNotTrusted($w, $t);

        if ($w->routeKm !== null) {
            $floor = $this->metres($w->routeKm * $t->corridorFloorPercent / 100);
            $ceiling = $this->metres($w->routeKm * $t->corridorCeilingPercent / 100);

            return $odo >= $floor && $odo <= $ceiling
                ? $this->decision($odo, DistanceGrade::BOUNDED, $policy, false,
                    sprintf('%s; odometer %.2f km sits inside the corridor %.2f–%.2f km around reference route %.2f km.',
                        $why, $odo, $floor, $ceiling, $w->routeKm))
                : $this->decision($odo, DistanceGrade::HELD, $policy, false,
                    sprintf('%s; odometer %.2f km falls outside the corridor %.2f–%.2f km around reference route %.2f km.',
                        $why, $odo, $floor, $ceiling, $w->routeKm));
        }

        return $this->unverifiedOrHeld($w, $policy, $why, $odo);
    }

    /**
     * No route to check the odometer against. Nothing vouches for it — but
     * a mock-location ping is not "nothing": a handset that faked its
     * position has spoken against the trip, and that is held, not merely
     * unverified, whatever the policy.
     */
    private function unverifiedOrHeld(DistanceWitnesses $w, DistancePolicy $policy, string $why, float $odo): DistanceDecision
    {
        if ($w->mockDropped > 0) {
            return $this->decision($odo, DistanceGrade::HELD, $policy, false,
                sprintf('%s; no reference route, and the odometer %.2f km cannot be trusted beside a faked position.', $why, $odo));
        }

        return $this->decision($odo, DistanceGrade::UNVERIFIED, $policy, false,
            sprintf('%s; no reference route, so the odometer %.2f km stands unverified.', $why, $odo));
    }

    /**
     * `ROUTE_CAPPED` only: the billed figure may not exceed the reference by
     * more than the detour allowance, unless the driver declared a stop —
     * the reference does not visit a place the trip was asked to wait at.
     *
     * The grade is untouched. A cap is a commercial adjustment to a figure
     * whose evidence has already been graded; it does not make a verified
     * trace less verified.
     */
    private function capDetour(DistanceDecision $d, DistanceWitnesses $w, DistanceThresholds $t): DistanceDecision
    {
        if ($w->routeKm === null || $w->stopsDeclared) {
            return $d;
        }

        $cap = round($w->routeKm * (1 + $t->detourCapPercent / 100), 2);

        if ($d->billedKm <= $cap) {
            return $d;
        }

        return new DistanceDecision(
            billedKm: $cap,
            grade: $d->grade,
            policy: $d->policy,
            reason: sprintf('%s Capped at %.2f km (reference %.2f km + %s%% detour allowance).',
                $d->reason, $cap, $w->routeKm, rtrim(rtrim(number_format($t->detourCapPercent, 2, '.', ''), '0'), '.')),
            traceTrusted: $d->traceTrusted,
        );
    }

    /**
     * Whether two figures agree within the route tolerance: a percentage of
     * the second, plus a fixed half kilometre so a short hop is not graded
     * on a rounding error.
     */
    private function roadAgrees(float $measured, float $reference, DistanceThresholds $t): bool
    {
        $slack = $reference * $t->routeTolerancePercent / 100 + DistanceThresholds::ROUTE_TOLERANCE_FLOOR_KM;

        // Compared to the metre. Distances are stored to two decimals and a
        // percentage of one is a float; without this, 14.3 km against a
        // 12 km reference reads as 2.3000000000000007 over and a trip on
        // the line is graded by rounding error.
        return $this->metres(abs($measured - $reference)) <= $this->metres($slack);
    }

    /** A kilometre figure rounded to the metre, for comparisons. */
    private function metres(float $km): float
    {
        return round($km, 3);
    }

    /**
     * The first bar the trace failed, in the order they are checked — one
     * clause, so the reason line stays one sentence.
     */
    private function whyNotTrusted(DistanceWitnesses $w, DistanceThresholds $t): string
    {
        return match (true) {
            $w->gpsKm === null => 'No usable trace',
            $w->mockDropped > 0 => sprintf('Trace not trusted: %d mock-location ping(s)', $w->mockDropped),
            $w->teleportsDropped > $t->maxTeleports => sprintf('Trace not trusted: %d teleports (limit %d)', $w->teleportsDropped, $t->maxTeleports),
            $w->coveragePercent === null || $w->coveragePercent < $t->minCoveragePercent => sprintf('Trace not trusted: coverage %s%% (minimum %s%%)', $this->pct($w->coveragePercent), $this->pct($t->minCoveragePercent)),
            default => sprintf('Trace not trusted: %s%% inferred across gaps (maximum %s%%)', $this->pct($w->inferredSharePercent), $this->pct($t->maxInferredSharePercent)),
        };
    }

    private function pct(?float $value): string
    {
        return $value === null ? '—' : rtrim(rtrim(number_format($value, 1, '.', ''), '0'), '.');
    }

    private function decision(float $km, DistanceGrade $grade, DistancePolicy $policy, bool $trusted, string $reason): DistanceDecision
    {
        return new DistanceDecision(
            billedKm: round(max(0.0, $km), 2),
            grade: $grade,
            policy: $policy,
            reason: $reason,
            traceTrusted: $trusted,
        );
    }
}
