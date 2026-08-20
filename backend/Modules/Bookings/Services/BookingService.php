<?php

namespace Modules\Bookings\Services;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Modules\Administration\Services\SettingsService;
use Modules\Bookings\Enums\BookingStatus;
use Modules\Bookings\Events\BookingApproved;
use Modules\Bookings\Events\BookingRejected;
use Modules\Bookings\Models\Booking;

/**
 * Owns the booking's own lifecycle — creation and the approve/reject/cancel
 * decisions. The move to Assigned is deliberately NOT here: that is
 * Modules\Dispatch's job, because it must happen in the same locked
 * transaction that creates the Trip.
 */
class BookingService
{
    public function __construct(private readonly SettingsService $settings) {}

    /**
     * @param  array<string, mixed>  $attributes  already validated by the caller
     */
    public function create(array $attributes, User $requester): Booking
    {
        $booking = Booking::create([
            ...$attributes,
            'requested_by_user_id' => $requester->id,
            'status' => BookingStatus::PENDING,
        ]);

        // ADR-0014 phase 2: the owner may switch the approval step off.
        // Auto-approval reuses the same transition as a human approver —
        // same lock, same audit rows, same BookingApproved event — so
        // nothing downstream can tell the difference except approved_by
        // being the requester. That is normally the "approving your own
        // workload" conflict the seeded roles forbid; switching this
        // setting off is the owner explicitly waiving that control, and
        // the audit trail records both the waiver (the settings change)
        // and every booking it waved through.
        //
        // The client's own version of the same waiver, per person: a
        // Corporate Admin may mark someone as booking without approval
        // (`users.books_without_approval`; see App\Enums\ClientCapability).
        // Same transition, same audit rows; the flag itself sits on the
        // audited user record, so who was waved through and who waived it
        // are both on file.
        if ($this->settings->get('booking', 'approval_required') !== true || $requester->booksWithoutApproval()) {
            return $this->approve($booking, $requester);
        }

        return $booking;
    }

    public function approve(Booking $booking, User $actor): Booking
    {
        return $this->decide($booking, BookingStatus::APPROVED, $actor, null);
    }

    public function reject(Booking $booking, User $actor, string $reason): Booking
    {
        return $this->decide($booking, BookingStatus::REJECTED, $actor, $reason);
    }

    public function cancel(Booking $booking, User $actor, string $reason): Booking
    {
        return $this->decide($booking, BookingStatus::CANCELLED, $actor, $reason);
    }

    /**
     * Re-reads the booking under a row lock before checking the transition:
     * without it, two admins could both read `pending` and both write a
     * decision, and the loser's reason would silently overwrite the
     * winner's on an audit-visible record.
     *
     * @throws InvalidBookingTransitionException
     */
    private function decide(Booking $booking, BookingStatus $to, User $actor, ?string $reason): Booking
    {
        $decided = DB::transaction(function () use ($booking, $to, $actor, $reason) {
            /** @var Booking $locked */
            $locked = Booking::whereKey($booking->id)->lockForUpdate()->firstOrFail();

            if (! $locked->status->canTransitionTo($to)) {
                throw new InvalidBookingTransitionException($locked->status, $to);
            }

            $locked->status = $to;
            $locked->decision_reason = $reason;

            if ($to === BookingStatus::APPROVED) {
                $locked->approved_by_user_id = $actor->id;
                $locked->approved_at = now();
            }

            $locked->save();

            return $locked->load(['requestedBy', 'approvedBy']);
        });

        // Dispatched after the transaction commits, never inside it.
        //
        // A queued notification job picked up by a worker before the
        // committing transaction lands would read the booking at its old
        // status — or not find it at all. Telling somebody their booking
        // was approved before the approval is durable is worse than telling
        // them late: a rollback afterwards leaves a message about a
        // decision that never happened, and a notification cannot be
        // unsent.
        $this->announce($decided, $to);

        return $decided;
    }

    /**
     * Cancellation raises nothing. It is usually the requester's own act,
     * and telling somebody what they just did is exactly the fatigue
     * AGENTS.md warns against.
     */
    private function announce(Booking $booking, BookingStatus $to): void
    {
        match ($to) {
            BookingStatus::APPROVED => BookingApproved::dispatch($booking),
            BookingStatus::REJECTED => BookingRejected::dispatch($booking),
            default => null,
        };
    }
}
