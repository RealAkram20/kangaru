<?php

namespace Modules\Trips\Support;

/**
 * A number to dial, and who answers it (ADR-0024 §7).
 *
 * `label` is not decoration. Under `DirectContactChannel` it is the person's
 * own name; under a future masking channel it would say so — "Passenger (via
 * KangaruRide)" — and a driver who dials a proxy number needs to know that
 * is what they are doing, or the first thing they will do is save it to
 * their contacts as the passenger's real number and call it next week.
 */
final class ContactDetails
{
    public function __construct(
        public readonly string $name,
        public readonly string $phone,
        public readonly string $label,
    ) {}

    /**
     * @return array<string, string>
     */
    public function toArray(): array
    {
        return [
            'name' => $this->name,
            'phone' => $this->phone,
            'label' => $this->label,
        ];
    }
}
