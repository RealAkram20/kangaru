<?php

namespace Modules\Trips\Services;

/**
 * What a completed trip's distance is, and how much to trust it (ADR-0047).
 *
 * A value object rather than a bare float because **three different things
 * can be true at once** and a caller needs all of them: what to bill, what
 * the trace actually measured, and whether a human should look. Returning
 * only the first would throw away the evidence that makes a disputed fare
 * answerable.
 */
final class TripDistance
{
    public function __construct(
        /**
         * The billable figure, in kilometres — or **null when the platform
         * does not know**.
         *
         * Null is a real answer and is never to be coerced to zero. A trip
         * whose handset never reported a position has no distance, and a fare
         * of zero is a claim that the vehicle did not move — which is a
         * different statement, and one the operator would have no reason to
         * question. Null reaches the invoice as an unpriced line somebody has
         * to resolve, which is the honest outcome.
         */
        public readonly ?float $kilometres,

        /** Whether this needs a human before it becomes money. */
        public readonly bool $flagged,

        /**
         * What the GPS trace measured, before any ceiling was applied.
         *
         * Kept even when it was overridden, because it is the thing a
         * reviewer needs to see: "the trace said 41 km, the road says 12, we
         * billed 15.6" is a reviewable sentence. "We billed 15.6" is not.
         */
        public readonly ?float $traceKilometres,

        /** One line for the trip's timeline, in the office's own words. */
        public readonly string $note,
    ) {}
}
