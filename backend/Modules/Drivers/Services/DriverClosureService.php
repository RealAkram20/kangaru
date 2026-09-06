<?php

namespace Modules\Drivers\Services;

use App\Enums\Permission;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Modules\Drivers\Enums\ClosureRequestStatus;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Models\DriverClosureRequest;
use Modules\Notifications\Enums\NotificationType;
use Modules\Notifications\Mail\OfficeRecipient;
use Modules\Notifications\Notifications\DriverClosureAnsweredNotification;
use Modules\Notifications\Notifications\OfficeEventNotification;

/**
 * Closing a driver's account, on their own request (ADR-0043).
 *
 * **Closing is not deleting**, and this class is where that distinction is
 * enforced rather than merely documented: nothing here touches a trip, a ledger
 * entry, an invoice or an audit row.
 */
class DriverClosureService
{
    public function __construct(private readonly DriverAccountService $accounts) {}

    /**
     * A driver asking.
     *
     * **One open request per driver.** Two pending requests are not two
     * closures, they are one driver asking twice, and a queue full of
     * duplicates is a queue the office stops reading (ADR-0032's rule, and its
     * reasoning).
     *
     * Locked rather than merely checked: a driver double-tapping on a bad
     * connection is exactly how two arrive a millisecond apart.
     *
     * @throws ClosureRequestAlreadyOpenException
     */
    public function request(Driver $driver, ?string $reason): DriverClosureRequest
    {
        $request = DB::transaction(function () use ($driver, $reason) {
            $open = DriverClosureRequest::query()
                ->where('driver_id', $driver->getKey())
                ->where('status', ClosureRequestStatus::PENDING)
                ->lockForUpdate()
                ->first();

            if ($open !== null) {
                throw ClosureRequestAlreadyOpenException::forDriver($driver);
            }

            return DriverClosureRequest::create([
                'driver_id' => $driver->getKey(),
                'status' => ClosureRequestStatus::PENDING,
                'reason' => $reason,
            ]);
        });

        // Somebody has asked to stop driving. Nothing happens until the office
        // answers, so the office is told rather than left to notice.
        //
        // The driver's reason is deliberately not in the email. It is on the
        // screen behind `drivers.manage`, and an office inbox is read on a
        // shared machine at a depot desk.
        $this->tellTheOffice($driver, NotificationType::FLEET_CLOSURE_REQUESTED, '/closure-requests');

        return $request;
    }

    /**
     * Tells the driver's own fleet office, and nobody else's.
     *
     * `OfficeRecipient::fleet()` carries the guard: the list is narrowed to
     * `$driver->operator_id`, so an alert naming one fleet's driver cannot
     * reach a competitor's desk.
     */
    private function tellTheOffice(Driver $driver, NotificationType $type, string $url): void
    {
        $name = (string) ($driver->user->name ?? '');

        foreach (app(OfficeRecipient::class)->fleet($driver->operator_id, Permission::DRIVERS_MANAGE) as $staff) {
            $staff->notify(new OfficeEventNotification(
                $type,
                facts: array_filter([__('mail.office.fact_driver') => $name]),
                url: $url,
                replacements: ['driver' => $name],
            ));
        }
    }

    /**
     * The driver changing their mind.
     *
     * ADR-0032 left this out of settlement requests and recorded that its
     * absence was more annoying than it looked. Deciding not to close your
     * account is not an unusual thing to do, and without it the
     * one-open-per-driver rule makes the decision unfixable without ringing
     * the office.
     */
    public function withdraw(DriverClosureRequest $request): DriverClosureRequest
    {
        return $this->settle($request, ClosureRequestStatus::WITHDRAWN, null, null);
    }

    /**
     * The office agreeing.
     *
     * Four things happen, and the omissions matter as much as the list:
     *
     * 1. The request is marked confirmed, with who and when.
     * 2. The driver goes `inactive`, so dispatch stops offering them work.
     * 3. **The sign-in is detached through `DriverAccountService::close()`** —
     *    the one service ADR-0016 allows to do it, never by deleting a `User`
     *    row here. It also revokes their tokens, so a handset already signed in
     *    stops working rather than continuing on a stale credential.
     * 4. `closed_at` is stamped. **That is the clock the retention sweep runs
     *    on** (ADR-0043 §3) — the sweep is W1-e's work and is not built; this
     *    is the event it needs.
     *
     * **Nothing here deletes anything.** No trip, no ledger entry, no invoice,
     * no audit row, and not the payout destination either — the office may
     * still owe a final payment, and ADR-0042 §6 leaves that to retention.
     */
    public function confirm(DriverClosureRequest $request, User $reviewer): DriverClosureRequest
    {
        return DB::transaction(function () use ($request, $reviewer) {
            $locked = $this->lockOpen($request);

            $driver = Driver::query()->whereKey($locked->driver_id)->lockForUpdate()->firstOrFail();

            $driver->forceFill(['status' => 'inactive'])->save();
            $this->accounts->close($driver);

            $locked->forceFill([
                'status' => ClosureRequestStatus::CONFIRMED,
                'reviewed_by_user_id' => $reviewer->getKey(),
                'reviewed_at' => now(),
                'closed_at' => now(),
            ])->save();

            $this->tell($locked, $driver);

            return $locked;
        });
    }

    /**
     * The office saying no, with a reason.
     *
     * The reason is required by the form request, and it is the whole value of
     * a decline: "settle your balance first" is an answer a driver can act on,
     * where a bare refusal is how somebody stops using a feature.
     */
    public function decline(
        DriverClosureRequest $request,
        User $reviewer,
        string $reason,
    ): DriverClosureRequest {
        return $this->settle($request, ClosureRequestStatus::DECLINED, $reviewer, $reason);
    }

    private function settle(
        DriverClosureRequest $request,
        ClosureRequestStatus $status,
        ?User $reviewer,
        ?string $reason,
    ): DriverClosureRequest {
        return DB::transaction(function () use ($request, $status, $reviewer, $reason) {
            $locked = $this->lockOpen($request);

            $locked->forceFill([
                'status' => $status,
                'reviewed_by_user_id' => $reviewer?->getKey(),
                'reviewed_at' => $reviewer === null ? null : now(),
                'decline_reason' => $reason,
            ])->save();

            // A withdrawal is the driver telling themselves; mailing them about
            // a thing they just did on their own handset is noise.
            if ($status === ClosureRequestStatus::DECLINED) {
                $driver = Driver::query()->whereKey($locked->driver_id)->firstOrFail();
                $this->tell($locked, $driver);
            }

            return $locked;
        });
    }

    /**
     * Re-reads under a lock and refuses a second decision.
     *
     * **This is what makes confirming idempotent.** Two reviewers working the
     * same queue would otherwise both pass a plain status check, and the second
     * would close an already-closed account — detaching a login that is already
     * gone and stamping a second, later `closed_at` that moves the retention
     * clock.
     *
     * @throws ClosureRequestAlreadyDecidedException
     */
    private function lockOpen(DriverClosureRequest $request): DriverClosureRequest
    {
        $locked = DriverClosureRequest::query()
            ->whereKey($request->getKey())
            ->lockForUpdate()
            ->firstOrFail();

        if (! $locked->status->isOpen()) {
            throw ClosureRequestAlreadyDecidedException::forRequest($locked);
        }

        return $locked;
    }

    /**
     * The return path (ADR-0043 §4).
     *
     * **By mail, and it has to be.** A confirmed closure has just detached the
     * driver's sign-in, so there is no in-app inbox left for them to read — the
     * same shape the completeness census found on the rejected applicant, where
     * the actor loses the only surface that could tell them.
     *
     * Addressed to the `Driver` record's own email rather than the account's,
     * because by this point in `confirm()` the account is already detached.
     * `Notification::route` rather than `$user->notify` for exactly that
     * reason: there is no longer a notifiable user to send to.
     */
    private function tell(DriverClosureRequest $request, Driver $driver): void
    {
        if ($driver->email === null || trim($driver->email) === '') {
            return;
        }

        Notification::route('mail', $driver->email)
            ->notify(DriverClosureAnsweredNotification::for($request, $driver));
    }
}
