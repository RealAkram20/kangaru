<?php

namespace Modules\Drivers\Enums;

/**
 * What a ledger row records (ADR-0029 §2).
 *
 * The signs are from the **driver's** point of view: positive means the
 * platform owes them, negative means they owe the platform. That convention
 * is the whole reason `cash_collected` exists — see its note.
 */
enum LedgerEntryKind: string
{
    /** The driver's share of a completed fare. Positive: they are owed it. */
    case FARE_EARNED = 'fare_earned';

    /**
     * The gross fare the driver took in cash. Negative, and it is not a
     * penalty — the passenger handed them the platform's money and they are
     * holding all of it until they settle.
     *
     * Pairing this with `FARE_EARNED` is what makes the balance come out
     * right: earn 8,000 of a 10,000 cash fare and the net is −2,000, which
     * is exactly the commission the driver now owes. Recording a separate
     * `commission` debit instead double-counts it, because the driver's
     * share was already net of it.
     */
    case CASH_COLLECTED = 'cash_collected';

    /**
     * Money that actually moved between the office and the driver, in
     * either direction — cash remitted at the depot (positive, it reduces
     * what they owe) or a payment out to them (negative).
     *
     * One kind rather than two, because the sign already says which way it
     * went and a `payout`/`remittance` pair would let the two disagree.
     */
    case SETTLEMENT = 'settlement';

    /** A correction. Always carries a reason and an author. */
    case ADJUSTMENT = 'adjustment';

    public function label(): string
    {
        return match ($this) {
            self::FARE_EARNED => 'Fare earned',
            self::CASH_COLLECTED => 'Cash collected',
            self::SETTLEMENT => 'Settlement',
            self::ADJUSTMENT => 'Adjustment',
        };
    }
}
