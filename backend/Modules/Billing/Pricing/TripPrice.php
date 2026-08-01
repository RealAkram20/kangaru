<?php

namespace Modules\Billing\Pricing;

use App\Support\Money\Shillings;
use Brick\Money\Money;
use Modules\Billing\Models\RateCardVersion;

/**
 * The complete priced result for one trip: the lines and the total they add
 * up to.
 *
 * The total is summed from the lines rather than tracked alongside them, so
 * "the invoice total does not match its lines" is not a state this type can
 * represent.
 */
final class TripPrice
{
    /**
     * @param  array<int, PricedLine>  $lines
     */
    public function __construct(
        public readonly RateCardVersion $version,
        public readonly array $lines,
    ) {}

    public function total(): Money
    {
        return array_reduce(
            $this->lines,
            fn (Money $carry, PricedLine $line) => $carry->plus($line->amount),
            Shillings::zero(),
        );
    }
}
