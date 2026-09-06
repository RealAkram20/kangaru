<?php

namespace Modules\Dispatch\Listeners;

use Illuminate\Support\Facades\Log;
use Modules\Bookings\Events\BookingApproved;
use Modules\Dispatch\Services\DispatchOfferService;

/**
 * Puts an approved booking in front of a driver, instead of on a board.
 *
 * ## What was missing
 *
 * Nothing carried a booking into dispatch. `BookingService::approve()` raised
 * this event and the only listener told the requester; the desk then opened
 * Dispatch and chose a vehicle and a driver by hand. The automatic machinery
 * existed and was running — it simply had no entry point for a booking, and
 * so only ever *advanced* offers a human had already started.
 *
 * ## Why a listener, and why in this module
 *
 * `TripCompleted`'s docblock states the rule: an event rather than a call, so
 * the raising module need not know who acts on it, and it names this very
 * event as the precedent — `BookingApproved` exists so `Modules\Bookings`
 * need not know that anybody sends notifications. It must not learn that
 * anybody dispatches either. `Modules\Dispatch` already depends on
 * `Modules\Bookings`, so the listener living here keeps the arrow pointing
 * one way.
 *
 * ## Why the offer wave and not `autoAssign`
 *
 * Not because of ringing — since ADR-0068 the desk's own assignment rings
 * too, `DispatchService::assign` handing a driver with a handset to
 * `offerBookingToChosen()` and only assigning a phone-less driver outright.
 * The difference is what is being decided.
 *
 * `POST /bookings/{id}/auto-assignment` commits *one* choice, the top
 * suggestion, unattended — the matcher deciding. That is what
 * `dispatch.automatic_enabled` guards, and it is off for a reason its own
 * config note gives: a matcher acting alone on accounts with commercial
 * agreements behind them is a risk taken on somebody else's behalf. A wave
 * commits nothing. It asks the ranked drivers in turn, a decline rolls to the
 * next by itself, and the job becomes a trip only when somebody answers. The
 * weaker act is the right one to take unattended, and it must not require
 * turning on the stronger one.
 *
 * Because the offer carries `vehicle_id`, an accept writes a fully assigned
 * trip: both halves the desk was doing by hand.
 *
 * ## Why failure is swallowed
 *
 * The same reason `OrderRequestService::offerToDrivers()` swallows its own,
 * and one more that is specific to here. The approval has already committed —
 * this runs after the transaction, as `announce()` does — so a throw would
 * answer the approver with a failure for a decision that *did* happen, and
 * leave them re-approving a booking that is already approved. Every failure
 * mode degrades to precisely the behaviour of the day before this shipped: a
 * booking on the board and a dispatcher who assigns it.
 */
class OfferApprovedBookingToDrivers
{
    public function __construct(private readonly DispatchOfferService $offers) {}

    public function handle(BookingApproved $event): void
    {
        if (! config('dispatch.booking_auto_offer')) {
            return;
        }

        $booking = $event->booking;

        /*
         * A booking for later is not offered now — the walk-in path's rule,
         * word for word, because it is the same decision. Deciding *how
         * early* to start looking for a driver for tomorrow's 06:00 airport
         * run is a scheduler's job, deferred by name in ADR-0024, and
         * guessing at it here would hold an offer open for six hours or wake
         * a matcher in the middle of the night.
         *
         * `isFuture()` rather than `isImmediate()`: a booking whose slot has
         * already passed — raised for 14:00 and approved at 14:20 — is
         * wanted *now*, and the null-scheduled test would send it to the
         * board along with next Tuesday's.
         */
        if ($booking->scheduled_for !== null && $booking->scheduled_for->isFuture()) {
            return;
        }

        try {
            $this->offers->dispatchBooking($booking);
        } catch (\Throwable $e) {
            Log::warning('dispatch.booking_offer_failed', [
                'booking_id' => $booking->id,
                'error' => $e->getMessage(),
            ]);
        }
    }
}
