<?php

namespace App\Support\Money;

use Brick\Money\Money;

/**
 * The one place the platform currency is read from configuration and turned
 * into a Brick\Money\Money.
 *
 * AGENTS.md forbids "raw integer math on money outside the value object".
 * That rule only holds if constructing the value object is trivial —
 * otherwise `$a_minor + $b_minor` stays the path of least resistance. So
 * every service that touches money starts here and never unwraps back to an
 * int until the value is handed to the database (via MoneyMinorCast) or to
 * a JSON resource.
 *
 * Named for what it produces rather than "MoneyFactory": PROJECT.md's
 * naming rule rejects Helper/Utils/Manager names, and Phase 1 is
 * single-currency UGX by config/money.php.
 */
final class Shillings
{
    /**
     * Builds money from a stored minor-unit integer. For UGX (zero-decimal)
     * one minor unit is one shilling.
     */
    public static function ofMinor(int $minor): Money
    {
        return Money::ofMinor($minor, self::currency());
    }

    public static function zero(): Money
    {
        return Money::zero(self::currency());
    }

    /**
     * The inverse of ofMinor(): the integer actually written to a
     * `..._minor` column.
     */
    public static function toMinor(Money $money): int
    {
        return $money->getMinorAmount()->toInt();
    }

    public static function currency(): string
    {
        /** @var string $currency */
        $currency = config('money.currency', 'UGX');

        return $currency;
    }
}
