<?php

namespace Modules\Billing\Pricing;

/**
 * Raised when a trip cannot be priced because the tenant's rate cards do
 * not cover it — no default card, no version in force on the trip date, or
 * no rate for the vehicle's category.
 *
 * Every one of those is a refusal to guess. AGENTS.md's configuration rule
 * ("Vehicle rate = 3800" is the example of what not to do) means there is
 * no fallback price to fall back to, and billing a trip at zero because a
 * category was never priced would be a silent revenue loss the client would
 * find before we did.
 *
 * User-facing: this surfaces as 422 RATE_CARD_NOT_CONFIGURED with the
 * message below, which names the thing to go and fix.
 */
class RateCardNotConfiguredException extends \RuntimeException
{
    public static function noDefaultCard(): self
    {
        return new self(
            'This trip cannot be invoiced because no default rate card has been set up for your organisation. '.
            'Create a rate card and mark it as the default, then try again.'
        );
    }

    public static function noEffectiveVersion(string $cardName, string $tripDate): self
    {
        return new self(sprintf(
            'This trip cannot be invoiced because the rate card "%s" has no version in force on %s. '.
            'Add a version effective on or before that date, then try again.',
            $cardName,
            $tripDate,
        ));
    }

    public static function categoryNotPriced(string $cardName, int $version, string $category): self
    {
        return new self(sprintf(
            'This trip cannot be invoiced because version %d of the rate card "%s" does not price the vehicle '.
            'category "%s". Create a new rate card version that includes it, then try again.',
            $version,
            $cardName,
            $category,
        ));
    }
}
