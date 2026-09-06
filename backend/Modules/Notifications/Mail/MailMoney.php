<?php

namespace Modules\Notifications\Mail;

use Brick\Money\Money;

/**
 * An amount, formatted for an email.
 *
 * ## Why the server formats this and the API does not
 *
 * Every resource in this codebase serves `amount_minor` plus `currency` and
 * lets the client decide how to print it, which is right: PRODUCT.md wants
 * money currency-shaped in minor units, and a formatted string in an API
 * response is a decision taken in the wrong place.
 *
 * An email has no client. There is nobody downstream to do the formatting, so
 * it has to happen here, and doing it here badly is how a driver reads
 * "UGX 4500000" for forty five thousand shillings.
 *
 * ## The scale comes from the currency, never from a constant
 *
 * `Money::ofMinor()` asks the currency how many decimal places it has. UGX has
 * none, so 45000 minor units is UGX 45,000. USD has two, so 4500 minor units
 * is USD 45.00. That is the whole reason this is three lines and not one
 * `number_format($minor / 100)`: dividing by a hundred is correct in exactly
 * the countries this platform has not launched in yet, and PRODUCT.md is
 * explicit that new work must not deepen the Uganda assumption.
 *
 * ## An unknown currency prints rather than throws
 *
 * A notification is raised by something else finishing. A ledger row with a
 * currency `brick/money` does not recognise is a data problem worth fixing,
 * but it must not be the reason a driver never hears that their settlement was
 * confirmed. So the fallback prints the code and the number plainly, which is
 * ugly and true.
 */
final class MailMoney
{
    public static function format(int $minor, string $currency): string
    {
        try {
            return self::plainSpaces(Money::ofMinor($minor, $currency)->formatTo('en'));
        } catch (\Throwable) {
            return trim($currency.' '.number_format($minor));
        }
    }

    /**
     * ICU separates the currency from the number with a **non-breaking space**
     * (U+00A0), and that is good typography everywhere except here.
     *
     * In email it is a liability. A non-breaking space is among the most
     * common characters to arrive mangled when a client, a proxy or a
     * spam-filter rewrite gets the encoding wrong, and "UGX 45,000" turning
     * into "UGX 45,000" with a stray character in a driver's inbox is exactly
     * the kind of small wrongness that makes a platform look unreliable about
     * money.
     *
     * It also breaks copy and paste into a spreadsheet, which is the first
     * thing a finance officer does with a figure.
     *
     * The narrow no-break space (U+202F) is included because ICU uses it for
     * some locales and it fails the same way.
     */
    private static function plainSpaces(string $formatted): string
    {
        return str_replace(["\u{00A0}", "\u{202F}"], ' ', $formatted);
    }
}
