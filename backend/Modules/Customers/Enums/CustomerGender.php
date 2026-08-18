<?php

namespace Modules\Customers\Enums;

/**
 * A customer's gender, as they chose to state it (ADR-0015 §2).
 *
 * `PREFER_NOT_TO_SAY` is a stored answer, not the absence of one — it is
 * distinct from `null`, which means never asked. Keeping the two apart is
 * what stops a future screen re-asking somebody who already declined.
 *
 * The list is deliberately short and closed: this field exists to support
 * a same-gender captain preference, and a free-text gender could not be
 * matched against a driver record anyway.
 */
enum CustomerGender: string
{
    case FEMALE = 'female';
    case MALE = 'male';
    case OTHER = 'other';
    case PREFER_NOT_TO_SAY = 'prefer_not_to_say';

    public function label(): string
    {
        return match ($this) {
            self::FEMALE => 'Female',
            self::MALE => 'Male',
            self::OTHER => 'Other',
            self::PREFER_NOT_TO_SAY => 'Prefer not to say',
        };
    }
}
