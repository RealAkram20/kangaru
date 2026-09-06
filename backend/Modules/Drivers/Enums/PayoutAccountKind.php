<?php

namespace Modules\Drivers\Enums;

/**
 * The kinds of destination a driver's money can be sent to (ADR-0042 §2).
 *
 * Two, and deliberately not a longer list. `mobile_money` covers MTN MoMo and
 * Airtel Money without naming either, because the provider is free text in
 * `institution` — East Africa gains and loses mobile-money brands faster than a
 * migration cycle, and an enum case per provider is a deploy every time one
 * changes its name.
 */
enum PayoutAccountKind: string
{
    case BANK = 'bank';
    case MOBILE_MONEY = 'mobile_money';

    public function label(): string
    {
        return match ($this) {
            self::BANK => 'Bank account',
            self::MOBILE_MONEY => 'Mobile money',
        };
    }

    /**
     * What to call the institution on a form, in the driver's words.
     *
     * The two are different questions and a single "Provider" label would be
     * wrong for both: nobody calls Stanbic a provider, and nobody calls MTN a
     * bank.
     */
    public function institutionLabel(): string
    {
        return match ($this) {
            self::BANK => 'Bank',
            self::MOBILE_MONEY => 'Provider',
        };
    }

    /**
     * What to call the number.
     *
     * A mobile-money "account number" is a phone number, and asking a driver
     * for an account number when they are looking at their own handset is how
     * a form gets a wrong answer typed confidently.
     */
    public function numberLabel(): string
    {
        return match ($this) {
            self::BANK => 'Account number',
            self::MOBILE_MONEY => 'Mobile money number',
        };
    }
}
