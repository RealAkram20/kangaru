<?php

namespace Modules\Drivers\Enums;

/**
 * Which way a driver is asking money to move (ADR-0032 §1).
 *
 * The two mirror the ledger's two directions. **Neither is called "deposit"
 * or "withdrawal"**, and that is deliberate: a driver is not depositing into
 * an account this platform holds, and there is nothing here to withdraw from.
 * They are telling the office that cash changed hands, or asking it to.
 */
enum SettlementRequestKind: string
{
    /**
     * "I have handed you cash." Confirmed, it credits the driver — reducing
     * what they owe.
     *
     * **The common case.** Cash work runs towards the office: a rider takes
     * the whole fare in hand all day and remits the platform's share later,
     * which is the same observation ADR-0029 §2 made when it replaced a
     * one-way `payout` kind with a signed `settlement`.
     */
    case REMITTANCE = 'remittance';

    /** "Please pay me what I am owed." Confirmed, it debits the driver. */
    case PAYOUT = 'payout';

    /**
     * "A passenger tipped me on this trip" (ADR-0034 §1).
     *
     * The third kind, and the one that is not a settlement at all — which is
     * why it is here anyway. The *mechanism* is identical and already built:
     * a driver declares that cash changed hands, the office answers, and the
     * answer is what writes the ledger. Growing a parallel declare/confirm
     * pipeline beside this one would be two copies of a money workflow, and
     * the second copy is the one that misses a fix.
     *
     * **It is the only kind that names a trip**, and that changes two rules:
     * the ledger entry it writes is a *pair* rather than a signed settlement
     * (see `writesSettlement()`), and ADR-0032 §4's one-open-request rule
     * becomes one open declaration per *trip*.
     */
    case TIP = 'tip';

    /**
     * The sign the ledger entry takes when this request is confirmed.
     *
     * Derived here rather than stored on the request, so a wrong sign in the
     * request table cannot become a wrong sign in the ledger. The stored
     * amount is always positive — a person typing an amount does not type a
     * sign.
     *
     * Meaningless for `TIP`, which writes a pair rather than one signed
     * entry, and `writesSettlement()` is the guard that stops anything
     * calling this for it.
     */
    public function ledgerSign(): int
    {
        return $this === self::REMITTANCE ? 1 : -1;
    }

    /**
     * Whether confirming this writes a single signed `settlement`.
     *
     * False for `TIP` alone. A tip is commissionable (ADR-0034 §2), so it
     * writes the same two-entry pair a cash fare does — the driver's share
     * and the gross they are holding — and routing it through
     * `recordSettlement()` would credit the whole tip and lose the platform's
     * cut silently.
     */
    public function writesSettlement(): bool
    {
        return $this !== self::TIP;
    }

    /** Whether a declaration of this kind must name the trip it happened on. */
    public function requiresTrip(): bool
    {
        return $this === self::TIP;
    }

    public function label(): string
    {
        return match ($this) {
            self::REMITTANCE => 'Cash handed to the office',
            self::PAYOUT => 'Payout requested',
            self::TIP => 'Tip declared',
        };
    }
}
