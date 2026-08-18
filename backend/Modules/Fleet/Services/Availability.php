<?php

namespace Modules\Fleet\Services;

/**
 * The answer to "is this driver or vehicle free between these two moments?"
 * — and, when it is not, which of the several possible reasons applies.
 *
 * A value object rather than a bare bool because every caller needs the
 * reason. The dispatch board shows it beside the greyed-out row; the
 * assignment endpoint puts it in a 409; a future automatic dispatcher logs
 * it to explain why it picked the driver it did. Returning `false` and
 * making three callers re-derive the cause is how three slightly different
 * explanations of the same refusal end up in the product.
 */
final class Availability
{
    private function __construct(
        public readonly bool $free,
        public readonly ?string $code,
        public readonly ?string $note,
    ) {}

    public static function free(): self
    {
        return new self(true, null, null);
    }

    /**
     * @param  string  $code  stable and machine-readable, for a client that branches
     * @param  string  $note  a sentence for a person, which never names another client
     */
    public static function blocked(string $code, string $note): self
    {
        return new self(false, $code, $note);
    }

    /** The resource is suspended or retired, so nothing else needs asking. */
    public const OUT_OF_SERVICE = 'OUT_OF_SERVICE';

    /** Already committed to a trip that has not finished. */
    public const ON_TRIP = 'ON_TRIP';

    /** Leave, maintenance, inspection — an `AvailabilityBlock` covers the window. */
    public const BLOCKED = 'BLOCKED';

    /** A driver with a roster, asked for hours outside every window of it. */
    public const OFF_SHIFT = 'OFF_SHIFT';
}
