<?php

namespace Modules\Notifications\Enums;

/**
 * The notifications this platform sends.
 *
 * AGENTS.md is prescriptive here and the restraint is the point: "Use
 * notifications only when meaningful: Booking Assigned, Trip Started, Trip
 * Completed, Invoice Ready, Vehicle Maintenance Due, Document Expiring.
 * Avoid notification fatigue." A type not on that list needs an argument,
 * not just a use case.
 *
 * Values double as AGENTS.md's structured business-event names
 * ("booking.created", "driver.assigned"), so the same string names the
 * notification, the log line and the row in `notifications.type`. Never
 * repurpose a case — delivered rows carry it.
 *
 * Only three are built. The rest of AGENTS.md's list is deferred with
 * reasons in Modules/Notifications/README.md; each is one case here, one
 * Notification class and one dispatch line at the point the thing happens.
 */
enum NotificationType: string
{
    case BOOKING_APPROVED = 'booking.approved';
    case BOOKING_REJECTED = 'booking.rejected';
    case REPORT_EXPORT_READY = 'report.export.ready';

    /**
     * The three moments after approval that the requester of a corporate
     * booking is told about (TripProgressNotification): a car and driver
     * exist, the driver is at the kerb, the trip is done — the last with
     * the six data points the client is billed by.
     */
    case TRIP_ASSIGNED = 'trip.assigned';
    case TRIP_DRIVER_ARRIVED = 'trip.driver_arrived';
    case TRIP_COMPLETED = 'trip.completed';
    case ORDER_REQUEST_RECEIVED = 'order_request.received';

    /**
     * A job put in front of one driver, with a clock on it (ADR-0024 §3).
     *
     * The one message in this platform that earns an interruption
     * (ADR-0025 §5): the recipient has seconds to act on it, and it is the
     * only reason the Driver's Application is installed. Everything else
     * here reaches somebody already sitting at a screen.
     */
    case TRIP_OFFERED = 'trip.offered';

    /**
     * That job is gone — stop ringing (ADR-0046 §4).
     *
     * **The only silent notification in this platform**, and the only one
     * whose entire purpose is to *undo* an interruption rather than cause
     * one. It shows nothing and says nothing; the app reads `offer_id` and
     * stops the ringtone.
     *
     * ## Why it is needed at all
     *
     * The handset already stops on its own: `Ringtone` arms a deadline from
     * the offer's own window, so the worst case without this is silence a
     * couple of seconds after the offer would have expired anyway. That is
     * correct but slow. With a forty-five second window it means a phone
     * ringing in a driver's pocket for the better part of a minute over a
     * ride the passenger has already cancelled — and a driver who pulls over
     * for that twice stops trusting the sound.
     *
     * So this is an **accelerator, not the mechanism** — the same shape
     * ADR-0024 §5 gives the expiry command it sits beside. The guarantee is
     * the clock on the device; this makes the common case immediate.
     */
    case TRIP_OFFER_WITHDRAWN = 'trip.offer_withdrawn';

    /**
     * What the office decided about closing a driver's account (ADR-0043 §4).
     *
     * **The first return path this platform has built for a driver-facing
     * decision**, and it earns the addition on this enum's own test: the
     * recipient has no other surface. A confirmed closure detaches their
     * sign-in, so the in-app row every other type relies on is not readable
     * by the one person it concerns.
     */
    case DRIVER_CLOSURE_ANSWERED = 'driver.closure.answered';

    /**
     * The office's answer to a report the driver wrote (ADR-0044 §4).
     *
     * The argument this enum asks for: **it is the only message here the
     * recipient explicitly asked for.** Everything else announces an event to
     * somebody who did not ask; this answers a question a driver wrote down,
     * and it is bounded at one per report by construction — there is no
     * threading and no reopening (ADR-0044 §5).
     */
    case DRIVER_SUPPORT_ANSWERED = 'driver.support.answered';

    /**
     * What the office decided about one of a driver's documents (ADR-0052).
     *
     * **The argument this enum demands, and it is AGENTS.md's own:** *Document
     * Expiring* is on the prescriptive list at the top of this file, and a
     * document being refused is the same obligation arriving sooner. A driver
     * whose licence the office could not accept is unverified and does not
     * know it.
     *
     * ADR-0033 §6 refused this in 2026-08 on consistency grounds — settlements
     * and ratings had no notification either, so adding one here would have
     * been an outlier. Two cases above (`DRIVER_CLOSURE_ANSWERED`,
     * `DRIVER_SUPPORT_ANSWERED`) have since made the opposite true: documents
     * were the last office decision a driver could only find by looking.
     */
    case DRIVER_DOCUMENT_REVIEWED = 'driver.document.reviewed';

    public function label(): string
    {
        return match ($this) {
            self::BOOKING_APPROVED => 'Booking approved',
            self::BOOKING_REJECTED => 'Booking rejected',
            self::REPORT_EXPORT_READY => 'Export ready',
            self::TRIP_ASSIGNED => 'Vehicle assigned',
            self::TRIP_DRIVER_ARRIVED => 'Driver arrived',
            self::TRIP_COMPLETED => 'Trip completed',
            self::ORDER_REQUEST_RECEIVED => 'Walk-in order received',
            self::TRIP_OFFERED => 'New job',
            self::TRIP_OFFER_WITHDRAWN => 'Job withdrawn',
            self::DRIVER_CLOSURE_ANSWERED => 'Account closure',
            self::DRIVER_SUPPORT_ANSWERED => 'Report answered',
            self::DRIVER_DOCUMENT_REVIEWED => 'Document checked',
        };
    }

    /**
     * The channels this type uses when configuration says nothing.
     *
     * Read through config (`config/notifications.php`), never directly —
     * AGENTS.md Configuration Driven, and because which channel carries
     * which message is an operational decision a deployment gets to make.
     * An export finishing is worth an in-app badge but not an email; a
     * rejected booking is worth both, because the person who asked for
     * transport may not be looking at the platform.
     *
     * @return array<int, NotificationChannel>
     */
    public function defaultChannels(): array
    {
        return match ($this) {
            self::BOOKING_APPROVED, self::BOOKING_REJECTED => [
                NotificationChannel::DATABASE,
                NotificationChannel::MAIL,
            ],
            self::REPORT_EXPORT_READY => [NotificationChannel::DATABASE],
            // In-app and mail, like a booking decision: the requester may
            // not have the console open when their car arrives.
            self::TRIP_ASSIGNED, self::TRIP_DRIVER_ARRIVED, self::TRIP_COMPLETED => [
                NotificationChannel::DATABASE,
                NotificationChannel::MAIL,
            ],
            // In-app only: the desk lives in the dashboard, and a walk-in
            // request emailed to every dispatcher is inbox noise, not
            // dispatch. Config can widen it per deployment.
            self::ORDER_REQUEST_RECEIVED => [NotificationChannel::DATABASE],
            // Push *and* the in-app row. The row is what makes an offer
            // visible in the app's own inbox when a push never arrives —
            // ADR-0025 §3 makes push best-effort, and a driver who declined
            // the OS permission must still be told something.
            //
            // Never mail: an offer expires in under a minute
            // (`dispatch.offer_ttl_seconds`), and an email about one would
            // arrive as an apology.
            self::TRIP_OFFERED => [
                NotificationChannel::PUSH,
                NotificationChannel::DATABASE,
            ],
            /*
             * **Push alone, and the absence of `DATABASE` is the point.**
             *
             * Every other type here writes an in-app row because a driver
             * should be able to find out what happened after the fact. This
             * one has nothing to tell them: it exists to stop a sound, and a
             * row saying "a job you never answered was withdrawn" is an inbox
             * entry for a non-event — the notification fatigue AGENTS.md
             * warns about, generated automatically, once per cancelled ride.
             *
             * Never mail, for the reason `TRIP_OFFERED` is never mailed, only
             * more so.
             */
            self::TRIP_OFFER_WITHDRAWN => [NotificationChannel::PUSH],
            /*
             * **Mail only, and the omissions are the point.** A confirmed
             * closure has just detached this driver's sign-in, so a `DATABASE`
             * row would be written into an inbox nobody can open and a `PUSH`
             * would go to a device that can no longer authenticate. Email is
             * the one channel that still reaches somebody whose account has
             * stopped working.
             */
            self::DRIVER_CLOSURE_ANSWERED => [NotificationChannel::MAIL],
            /*
             * **The in-app row and a push, never mail.** The row is where the
             * driver goes looking and survives a refused OS permission; the
             * push is justified by the recipient having asked the question
             * themselves, which no other type here can say.
             *
             * Mail is wrong for the reason it was right one case above: that
             * driver's account had just stopped working, and this one's has
             * not. A driver with a working app does not need an email about a
             * message already waiting in it.
             */
            self::DRIVER_SUPPORT_ANSWERED => [
                NotificationChannel::DATABASE,
                NotificationChannel::PUSH,
            ],
            /*
             * **All three, and it is the only type here that takes all
             * three** (ADR-0052 §3).
             *
             * The in-app row is the record, and it is the one channel that
             * cannot fail: push is best-effort by ADR-0025 §3 and a driver may
             * have declined the OS permission outright.
             *
             * The push is what makes a *rejection* reach somebody the same
             * day. That is the whole feature — a driver who does not know
             * their licence was refused believes they are compliant, and every
             * day until they next open the app is a day the office waits.
             *
             * Mail is here for the reason the closure answer takes it: it is
             * the only channel that survives the app being uninstalled, off,
             * or signed out — and it is the only one that can carry the
             * office's rejection reason in words, which neither of the other
             * two may (see the notification class).
             *
             * The fatigue AGENTS.md warns about is bounded by construction:
             * six documents, one message per human decision, and nothing here
             * fires on a schedule.
             */
            self::DRIVER_DOCUMENT_REVIEWED => [
                NotificationChannel::DATABASE,
                NotificationChannel::PUSH,
                NotificationChannel::MAIL,
            ],
        };
    }
}
