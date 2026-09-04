<?php

namespace Modules\Billing\Services;

use Carbon\CarbonInterface;
use Modules\Billing\Enums\DocumentType;
use Modules\Billing\Repositories\DocumentNumberSequenceRepository;

/**
 * Renders the human-facing document number for an allocated sequence
 * value: `INV-2026-000001`, `CRN-2026-000042`.
 *
 * Split from DocumentNumberSequenceRepository so that the part which must
 * be correct under concurrency (allocating the integer) is separate from
 * the part that is only cosmetic (formatting it). The prefix and padding
 * come from config/billing.php and may change; the allocated integers may
 * not.
 *
 * Callers use it in three steps, and the order matters — see the
 * repository's docblock for why:
 *
 *   1. `ensureSeries()` before opening the transaction.
 *   2. `lockSeries()` as the first statement inside it.
 *   3. `next()` once the caller has decided it really is issuing.
 *
 * The year in every case comes from the issue date rather than `now()`, so
 * a caller that back-dates an issue cannot land a 2026-prefixed number in
 * the 2027 counter. Pass the same instant to all three.
 *
 * Since ADR-0055 §6 a counter is a **fleet's** series for a client, not a
 * client's alone: two fleets billing Centenary Bank draw from two counters, so
 * neither company's numbering has holes the other is holding. Pass the fleet
 * that did the work — the driver's, recorded on the trip — not the fleet of
 * whoever happens to be pressing the button.
 */
class DocumentNumberGenerator
{
    public function __construct(private readonly DocumentNumberSequenceRepository $sequences) {}

    /** Step 1. Outside the transaction. */
    public function ensureSeries(int $operatorId, int $tenantId, DocumentType $type, CarbonInterface $issuedAt): void
    {
        $this->sequences->ensureSeries($operatorId, $tenantId, $type, self::yearOf($issuedAt));
    }

    /**
     * Step 2. The first statement inside the transaction: serialises every
     * generator working on this tenant's series.
     */
    public function lockSeries(int $operatorId, int $tenantId, DocumentType $type, CarbonInterface $issuedAt): void
    {
        $this->sequences->lockSeries($operatorId, $tenantId, $type, self::yearOf($issuedAt));
    }

    /** Step 3. Consumes a number and renders it. Inside the transaction. */
    public function next(int $operatorId, int $tenantId, DocumentType $type, CarbonInterface $issuedAt): string
    {
        $year = self::yearOf($issuedAt);
        $number = $this->sequences->allocate($operatorId, $tenantId, $type, $year);

        /** @var array{prefix: string, padding: int} $format */
        $format = config($type->configKey());

        return sprintf(
            '%s-%d-%s',
            $format['prefix'],
            $year,
            str_pad((string) $number, $format['padding'], '0', STR_PAD_LEFT),
        );
    }

    private static function yearOf(CarbonInterface $issuedAt): int
    {
        return (int) $issuedAt->format('Y');
    }
}
