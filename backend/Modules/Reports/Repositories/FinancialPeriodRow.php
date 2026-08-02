<?php

namespace Modules\Reports\Repositories;

use Brick\Money\Money;

/**
 * One period of the financial report.
 *
 * A typed object rather than the stdClass the fleet aggregate returns,
 * because these figures are money: AGENTS.md requires a money value object
 * in all services and forbids "raw integer math on money outside the value
 * object". A stdClass carrying `->invoiced_minor` would make
 * `$a->invoiced_minor + $b->invoiced_minor` the path of least resistance;
 * a Money makes it a TypeError. The fleet report's distances are under no
 * such rule, which is why that one is free to stay untyped.
 */
final class FinancialPeriodRow
{
    public function __construct(
        /** The sortable bucket key the database grouped on — "2026-07", "2026-07-13", "2026". */
        public readonly string $bucket,
        public readonly int $invoiceCount,
        public readonly Money $invoiced,
        public readonly int $creditNoteCount,
        public readonly Money $credited,
    ) {}

    /**
     * What this period added to the ledger: issued less credited.
     *
     * Can be negative, and is deliberately not clamped at zero. A month
     * whose credit notes corrected invoices raised in an earlier month
     * really did reduce receivables by more than it added, and flooring
     * that would hide exactly the correction this report exists to surface.
     */
    public function net(): Money
    {
        return $this->invoiced->minus($this->credited);
    }
}
