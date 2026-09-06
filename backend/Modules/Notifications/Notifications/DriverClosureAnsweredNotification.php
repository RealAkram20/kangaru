<?php

namespace Modules\Notifications\Notifications;

use Modules\Drivers\Enums\ClosureRequestStatus;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Models\DriverClosureRequest;
use Modules\Notifications\Enums\NotificationType;

/**
 * Tells a driver what the office decided about closing their account
 * (ADR-0043 §4).
 *
 * **This is the first return path this platform has ever built for a
 * driver-facing decision**, and it exists because the recipient has no other
 * surface: a confirmed closure detaches their sign-in, so there is no in-app
 * inbox left to read. That is the argument `NotificationType`'s docblock asks
 * for — "a type not on AGENTS.md's list needs an argument, not just a use
 * case" — and it is not an argument any other gap in the completeness census
 * could make.
 *
 * Addressed to the `Driver` record's email through `Notification::route`,
 * because by the time this sends there is no notifiable `User` left.
 */
class DriverClosureAnsweredNotification extends KangaruNotification
{
    public function __construct(
        private readonly ClosureRequestStatus $status,
        private readonly string $driverName,
        private readonly ?string $declineReason,
    ) {}

    public static function for(DriverClosureRequest $request, Driver $driver): self
    {
        return new self($request->status, $driver->name, $request->decline_reason);
    }

    public function type(): NotificationType
    {
        return NotificationType::DRIVER_CLOSURE_ANSWERED;
    }

    public function subject(): string
    {
        return $this->status === ClosureRequestStatus::CONFIRMED
            ? 'Your KangaruRide account has been closed'
            : 'Your account was not closed';
    }

    public function body(): string
    {
        if ($this->status === ClosureRequestStatus::CONFIRMED) {
            /*
             * Says what was kept, and why, rather than only what stopped.
             *
             * A driver who asked to be deleted and is told "closed" without
             * this will reasonably assume everything is gone — and it is not:
             * ADR-0043 keeps trips, pay records and invoices because
             * `master-plan.md` §6 stakes the product on their staying
             * reproducible. Being straight about it now is better than being
             * asked about it later.
             */
            return "{$this->driverName}, your account is now closed and you can no longer sign in. "
                .'Your trip and pay records are kept as the law requires for accounting, and your '
                .'personal details are removed once that period ends. '
                .'If the office still owes you money, they will be in touch to settle it.';
        }

        // The null branch is unreachable through the API — the decline endpoint
        // requires a reason — but this reads a nullable column, and "because:"
        // followed by nothing is worse to send than a plainly incomplete
        // sentence. Same call `BookingRejectedNotification` made.
        $because = $this->declineReason === null || trim($this->declineReason) === ''
            ? 'No reason was recorded. Please contact the office.'
            : "Reason given: {$this->declineReason}";

        return "{$this->driverName}, the office has not closed your account. {$because} "
            .'You can still sign in, and you can ask again once that is sorted out.';
    }

    public function url(): ?string
    {
        // Nowhere to send them. A confirmed closure has just taken away their
        // ability to sign in, so a link into the app would be a door with no
        // key — and the decline is answered by opening the app they still have.
        return null;
    }

    /**
     * @return array<string, mixed>
     */
    public function context(): array
    {
        return [
            'status' => $this->status->value,
            'decline_reason' => $this->declineReason,
        ];
    }
}
