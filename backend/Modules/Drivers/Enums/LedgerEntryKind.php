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

    /**
     * The driver's share of a tip a passenger handed them in cash (ADR-0034).
     *
     * Positive, and net of commission at the rate in force when the office
     * confirmed it — the owner's ruling that the platform takes its usual cut
     * of a tip is what makes a tip behave exactly like a fare, and therefore
     * what lets it reuse the pair below instead of needing a table of its own.
     */
    case TIP_EARNED = 'tip_earned';

    /**
     * The gross tip in the driver's hand. Negative, and the counterpart that
     * makes the balance come out right: take a 2,000 tip at 20% and the net
     * of this pair is −400, which is exactly the commission now owed.
     *
     * **A distinct kind rather than a second `CASH_COLLECTED` row**, and the
     * reason is the `(trip_id, kind)` unique index. That index is the guard
     * that stops a completion retried through the offline outbox (ADR-0023)
     * paying a driver twice, so a tip on a trip that already has a fare
     * cannot write another `cash_collected` for it. Splitting the kind keeps
     * the trip link *and* keeps the guard.
     */
    case TIP_CASH_COLLECTED = 'tip_cash_collected';

    /**
     * A weekly target bonus (ADR-0034 §4). Positive, and **unpaired** —
     * unlike a tip this is not cash in anybody's hand, it is simply an amount
     * the office has come to owe, so the balance moves by the whole of it and
     * settles through the ordinary handover.
     */
    case BONUS = 'bonus';

    public function label(): string
    {
        return match ($this) {
            self::FARE_EARNED => 'Fare earned',
            self::CASH_COLLECTED => 'Cash collected',
            self::SETTLEMENT => 'Settlement',
            self::ADJUSTMENT => 'Adjustment',
            // Never "Tip from <name>", whatever a mockup says. ADR-0024 §7
            // releases a passenger's details only while a trip is live, and a
            // wallet statement is permanent and scrollable — see ADR-0034 §6.
            self::TIP_EARNED => 'Tip',
            self::TIP_CASH_COLLECTED => 'Cash from tip',
            self::BONUS => 'Bonus',
        };
    }

    /**
     * The kinds that are *income* — what a driver made, as against what they
     * are holding or what has been settled.
     *
     * `DriverEarningsService` sums exactly these. It is a method on the enum
     * rather than a list in that service because the Trips History endpoint
     * needs the same answer, and two hand-written copies of "which kinds are
     * earnings" is one copy that gains `tip_earned` and one that does not.
     *
     * **`CASH_COLLECTED` and `TIP_CASH_COLLECTED` are deliberately absent.**
     * They are the negative halves that make the *balance* work; summing them
     * into earnings reports a completed ride as roughly minus the commission.
     *
     * @return array<int, self>
     */
    public static function earnings(): array
    {
        return [self::FARE_EARNED, self::TIP_EARNED, self::BONUS];
    }

    /** @return array<int, string> */
    public static function earningsValues(): array
    {
        return array_map(fn (self $kind) => $kind->value, self::earnings());
    }
}
