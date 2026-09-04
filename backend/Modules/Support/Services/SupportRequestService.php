<?php

namespace Modules\Support\Services;

use App\Enums\Permission;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Modules\Drivers\Models\Driver;
use Modules\Notifications\Enums\NotificationType;
use Modules\Notifications\Mail\OfficeRecipient;
use Modules\Notifications\Notifications\OfficeEventNotification;
use Modules\Notifications\Notifications\SupportRequestAnsweredNotification;
use Modules\Support\Enums\SupportRequestStatus;
use Modules\Support\Enums\SupportRequestTopic;
use Modules\Support\Models\SupportRequest;
use Modules\Trips\Models\Trip;

/**
 * Raising a report, and answering one (ADR-0044).
 *
 * A service rather than two controller bodies, because **answering has three
 * effects that must not come apart**: the answer is written, the status moves,
 * and the driver is told. A controller doing that inline is one early return
 * away from a report marked answered that nobody was told about, which is the
 * exact silence ADR-0044 exists to end.
 */
class SupportRequestService
{
    /**
     * A driver's report, as written.
     *
     * **Nothing is rejected for being a duplicate**, unlike settlement and
     * closure requests, which allow one open row each. Those are asks about a
     * single state — you are either owed money or you are not — and a second
     * one is the same ask twice. A report is an account of a *thing that
     * happened*, and a driver may have two bad afternoons in a week. Refusing
     * the second would be the platform telling somebody their problem is a
     * duplicate of their other problem.
     */
    public function raise(
        Driver $driver,
        SupportRequestTopic $topic,
        string $body,
        ?Trip $trip = null,
    ): SupportRequest {
        $request = SupportRequest::create([
            'driver_id' => $driver->getKey(),
            'topic' => $topic,
            'status' => SupportRequestStatus::OPEN,
            'trip_id' => $trip?->getKey(),
            'body' => $body,
        ]);

        /*
         * The office is told (mail plan F6).
         *
         * The driver's own words are **not** in the email. A support request
         * is somebody reporting a problem, sometimes about a passenger and
         * sometimes about a colleague, and the body belongs behind
         * `drivers.manage` on a screen rather than in an inbox on a shared
         * depot machine.
         *
         * Narrowed to the driver's own fleet by `OfficeRecipient::fleet()`.
         */
        $this->tellTheOffice($driver, NotificationType::FLEET_SUPPORT_REQUESTED, '/support-requests');

        return $request;
    }

    /**
     * Tells the driver's own fleet office, and nobody else's.
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
     * The office's reply.
     *
     * Idempotent under a double-tap: a request that is already answered is
     * returned untouched rather than overwritten, so a clerk who presses twice
     * does not replace their own answer and does not send a second push. The
     * caller gets the row back either way and cannot tell the difference,
     * which is the point.
     */
    public function answer(SupportRequest $request, User $staff, string $answer): SupportRequest
    {
        if ($request->status === SupportRequestStatus::ANSWERED) {
            return $request;
        }

        DB::transaction(function () use ($request, $staff, $answer): void {
            $request->forceFill([
                'answer' => $answer,
                'answered_by_user_id' => $staff->getKey(),
                'answered_at' => now(),
                'status' => SupportRequestStatus::ANSWERED,
            ])->save();
        });

        $this->tell($request);

        return $request->refresh();
    }

    /**
     * Telling the driver, outside the transaction and never fatally.
     *
     * A notification that throws must not roll back an answer a clerk has
     * written and believes they have sent — the answer is the durable fact and
     * the message is best-effort delivery of it, the same order
     * `DispatchOfferService::ring()` puts them in.
     *
     * A driver with no sign-in account (ADR-0016) is a real state and not an
     * error: they can be given work by a dispatcher but nothing can reach
     * them. It is logged rather than raised, because the answer is still on
     * the record and readable the moment they have an account.
     */
    private function tell(SupportRequest $request): void
    {
        try {
            $user = $request->driver?->user;

            if ($user === null) {
                Log::warning('support.answer_unreachable', [
                    'support_request_id' => $request->id,
                    'driver_id' => $request->driver_id,
                ]);

                return;
            }

            $user->notify(SupportRequestAnsweredNotification::for($request));
        } catch (\Throwable $e) {
            Log::warning('support.answer_notification_failed', [
                'support_request_id' => $request->id,
                'error' => $e->getMessage(),
            ]);
        }
    }
}
