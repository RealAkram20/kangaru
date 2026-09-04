<?php

namespace Modules\Drivers\Services;

use App\Enums\Permission;
use App\Models\User;
use App\Support\Tenancy\TenantScope;
use Illuminate\Support\Facades\DB;
use Modules\Drivers\Enums\SettlementRequestKind;
use Modules\Drivers\Enums\SettlementRequestStatus;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Models\DriverLedgerEntry;
use Modules\Drivers\Models\DriverSettlementRequest;
use Modules\Notifications\Enums\NotificationType;
use Modules\Notifications\Mail\MailMoney;
use Modules\Notifications\Mail\OfficeRecipient;
use Modules\Notifications\Notifications\DriverEventNotification;
use Modules\Notifications\Notifications\OfficeEventNotification;
use Modules\Trips\Models\Trip;

/**
 * Raising, confirming and declining settlement requests (ADR-0032).
 *
 * The loop ADR-0029 §6 left open. It said the office would write `settlement`
 * entries when cash changed hands; nothing ever could, because
 * `recordSettlement()` had no caller outside a seeder. This is that caller,
 * and it is driven by the party who actually knows the cash moved.
 *
 * **Money still does not move through this platform.** A driver hands cash
 * over at a depot exactly as before; this records that they say they did, and
 * a human confirms it. The ledger only ever learns about it from that
 * confirmation.
 */
class DriverSettlementRequestService
{
    public function __construct(private readonly DriverLedgerService $ledger) {}

    /**
     * A driver asks.
     *
     * **One open request per kind**, enforced under a lock rather than by a
     * unique index: the constraint is "at most one *pending*", which a
     * partial index would express and MySQL 8 does not have. Two pending
     * payout requests are not two payouts — they are one driver asking twice,
     * and a queue full of duplicates is a queue the office stops reading.
     *
     * @throws SettlementRequestAlreadyOpenException
     */
    public function raise(
        Driver $driver,
        SettlementRequestKind $kind,
        int $amountMinor,
        ?string $note,
        string $currency = 'UGX',
        ?Trip $trip = null,
    ): DriverSettlementRequest {
        $request = DB::transaction(function () use ($driver, $kind, $amountMinor, $note, $currency, $trip) {
            $open = DriverSettlementRequest::query()
                ->where('driver_id', $driver->getKey())
                ->where('kind', $kind->value)
                // **Per trip for a tip, per kind for the other two**
                // (ADR-0034 §1). The original rule exists so the office is not
                // handed a queue of duplicate payout requests — one driver
                // asking twice is not two payouts. A driver who took three
                // tips in a day has three genuinely different things to
                // declare, and each names the trip it happened on, so they are
                // distinguishable in a way two payout requests are not.
                ->when(
                    $kind->requiresTrip(),
                    fn ($query) => $query->where('trip_id', $trip?->getKey()),
                )
                ->open()
                ->lockForUpdate()
                ->exists();

            if ($open) {
                throw new SettlementRequestAlreadyOpenException(
                    $kind->requiresTrip()
                        ? 'You have already declared a tip on this trip, and the office has not answered yet.'
                        : 'You already have a request of this kind waiting for the office.',
                );
            }

            return DriverSettlementRequest::create([
                'driver_id' => $driver->getKey(),
                // Null on everything but a tip. A remittance covers a day's
                // takings and a payout is a request against a balance;
                // neither belongs to one journey.
                'trip_id' => $kind->requiresTrip() ? $trip?->getKey() : null,
                'kind' => $kind,
                'status' => SettlementRequestStatus::PENDING,
                // Stored positive whatever the kind. A person typing an
                // amount does not type a sign, and the direction is `kind`'s
                // job — so a wrong sign here cannot become a wrong sign in
                // the ledger.
                'amount_minor' => abs($amountMinor),
                'currency' => $currency,
                'note' => $note,
            ]);
        });

        // The driver is waiting on an answer, so somebody who can give one is
        // told. Outside the transaction: a request that exists and was not
        // announced is recoverable, one announced but not written is not.
        $this->tellTheOffice(
            $driver,
            NotificationType::FLEET_SETTLEMENT_REQUESTED,
            Permission::DRIVERS_MANAGE,
            '/settlement-requests',
        );

        return $request;
    }

    /**
     * The office agrees it happened — and **this is what writes the ledger.**
     *
     * Through `DriverLedgerService::recordSettlement()`, never by inserting a
     * row: the sign convention and the entry's shape stay in one place, and a
     * change to that service changes this with it.
     *
     * **Idempotent under a double-tap or a retried request.** The row is
     * locked and re-read inside the transaction, and a request that is no
     * longer pending is returned untouched rather than paying a second time.
     * That check cannot be done before the transaction: two requests arriving
     * together would both read `pending` and both pay.
     */
    public function confirm(DriverSettlementRequest $request, User $by): DriverSettlementRequest
    {
        return DB::transaction(function () use ($request, $by) {
            /** @var DriverSettlementRequest $locked */
            $locked = DriverSettlementRequest::query()
                ->whereKey($request->getKey())
                ->lockForUpdate()
                ->firstOrFail();

            if (! $locked->status->isOpen()) {
                return $locked;
            }

            /** @var Driver $driver */
            $driver = $locked->driver()->firstOrFail();

            $entry = $locked->kind->writesSettlement()
                ? $this->ledger->recordSettlement(
                    $driver,
                    $locked->kind->ledgerSign() * $locked->amount_minor,
                    $by,
                    $this->describe($locked),
                )
                // A tip writes the **pair** a cash fare writes, not one signed
                // settlement (ADR-0034 §3): the driver's share as a credit,
                // and the gross they are holding as a debit. Routing it
                // through `recordSettlement()` would credit the whole tip and
                // lose the platform's cut in silence — the amount would look
                // right on the row and be wrong in the balance.
                //
                // `writesSettlement()` is on the enum rather than a
                // `=== TIP` here, so a fourth kind has to answer the question
                // rather than fall through to the settlement branch.
                : $this->confirmTip($locked, $driver, $by);

            $locked->forceFill([
                'status' => SettlementRequestStatus::CONFIRMED,
                'reviewed_by_user_id' => $by->id,
                'reviewed_at' => now(),
                'ledger_entry_id' => $entry->getKey(),
            ])->save();

            $this->tellTheDriver($locked, $driver, NotificationType::DRIVER_SETTLEMENT_CONFIRMED);

            return $locked;
        });
    }

    /**
     * The office says no, and says why.
     *
     * A reason is required rather than optional. "The office says no" with no
     * explanation is how a driver stops using a feature — and this is the
     * first surface on the platform where staff can refuse a driver something
     * about their own money.
     */
    public function decline(
        DriverSettlementRequest $request,
        User $by,
        string $reason,
    ): DriverSettlementRequest {
        return DB::transaction(function () use ($request, $by, $reason) {
            /** @var DriverSettlementRequest $locked */
            $locked = DriverSettlementRequest::query()
                ->whereKey($request->getKey())
                ->lockForUpdate()
                ->firstOrFail();

            if (! $locked->status->isOpen()) {
                return $locked;
            }

            $locked->forceFill([
                'status' => SettlementRequestStatus::DECLINED,
                'reviewed_by_user_id' => $by->id,
                'reviewed_at' => now(),
                'decline_reason' => $reason,
            ])->save();

            $this->tellTheDriver(
                $locked,
                $locked->driver()->first(),
                NotificationType::DRIVER_SETTLEMENT_DECLINED,
                $reason,
            );

            return $locked;
        });
    }

    /**
     * Tells the driver's own fleet office, and nobody else's.
     *
     * `OfficeRecipient::fleet()` carries the guard: the recipient list is
     * narrowed to `$driver->operator_id`, so an alert naming one fleet's
     * driver cannot reach a competitor's desk. That is the mail plan §6 rule,
     * and a recipient list is where it is easiest to break without anything
     * looking wrong.
     */
    private function tellTheOffice(
        Driver $driver,
        NotificationType $type,
        Permission $permission,
        string $url,
    ): void {
        $name = (string) ($driver->user->name ?? $driver->full_name ?? '');

        foreach (app(OfficeRecipient::class)->fleet($driver->operator_id, $permission) as $staff) {
            $staff->notify(new OfficeEventNotification(
                $type,
                facts: array_filter([__('mail.office.fact_driver') => $name]),
                url: $url,
                replacements: ['driver' => $name],
            ));
        }
    }

    /**
     * Tells the driver what the office decided about their money.
     *
     * ADR-0032 §3 already argued that a declined settlement with no reason is
     * how somebody stops using a feature. This carries the reason where there
     * is one, and the amount either way: "your settlement is confirmed" without
     * the figure is a message the reader has to go and check, which is the
     * opposite of what a notification is for.
     *
     * A driver row with no account is possible (the office can file for
     * somebody who has not been given a login), so the send is conditional
     * rather than assumed.
     */
    private function tellTheDriver(
        DriverSettlementRequest $request,
        ?Driver $driver,
        NotificationType $type,
        ?string $reason = null,
    ): void {
        $driver?->user?->notify(new DriverEventNotification(
            $type,
            [
                __('mail.driver.fact_amount') => MailMoney::format(
                    (int) $request->amount_minor,
                    (string) $request->currency,
                ),
                __('mail.driver.fact_when') => now()->isoFormat('D MMMM YYYY'),
            ],
            reason: $reason,
        ));
    }

    /**
     * Confirming a tip declaration (ADR-0034 §3).
     *
     * Returns the **credit** half of the pair, because that is the entry the
     * request points at: `ledger_entry_id` is what a driver follows from a
     * confirmed declaration to see what they were actually paid, and the cash
     * half is the counterpart rather than the answer.
     *
     * **A tip with no trip cannot be confirmed.** The declaration requires one
     * at the request layer, so this is a should-never-happen — but it is
     * checked rather than assumed, because the alternative is writing a pair
     * with a null `trip_id` and silently defeating the `(trip_id, kind)`
     * unique index that stops a tip being paid twice.
     */
    private function confirmTip(
        DriverSettlementRequest $request,
        Driver $driver,
        User $by,
    ): DriverLedgerEntry {
        /** @var Trip|null $trip */
        $trip = $request->trip_id === null ? null : Trip::query()
            ->withoutGlobalScope(TenantScope::class)
            ->whereKey($request->trip_id)
            ->first();

        if ($trip === null) {
            throw new SettlementRequestAlreadyOpenException(
                'This tip declaration has no trip behind it and cannot be confirmed.',
            );
        }

        [$credit] = $this->ledger->recordTip(
            $driver,
            $trip,
            $request->amount_minor,
            $request->currency,
            $by,
            $request->note,
        );

        return $credit;
    }

    /**
     * What the ledger entry will say.
     *
     * The driver's own note is carried into it where they wrote one, because
     * the circumstances of a handover — "paid Musoke at Nakawa depot" — are
     * exactly what makes an entry recognisable months later, and the ledger's
     * `description` is the field ADR-0029 §3 already uses to freeze context.
     */
    private function describe(DriverSettlementRequest $request): string
    {
        $head = $request->kind === SettlementRequestKind::REMITTANCE
            ? "Cash remitted by the driver (request #{$request->getKey()})"
            : "Paid out to the driver (request #{$request->getKey()})";

        $note = trim((string) $request->note);

        return $note === '' ? $head : "{$head}: {$note}";
    }
}
