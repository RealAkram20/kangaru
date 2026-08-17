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

    public function label(): string
    {
        return match ($this) {
            self::BOOKING_APPROVED => 'Booking approved',
            self::BOOKING_REJECTED => 'Booking rejected',
            self::REPORT_EXPORT_READY => 'Export ready',
            self::ORDER_REQUEST_RECEIVED => 'Walk-in order received',
            self::TRIP_OFFERED => 'New job',
            self::DRIVER_CLOSURE_ANSWERED => 'Account closure',
            self::DRIVER_SUPPORT_ANSWERED => 'Report answered',
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
            // In-app only: the desk lives in the dashboard, and a walk-in
            // request emailed to every dispatcher is inbox noise, not
            // dispatch. Config can widen it per deployment.
            self::ORDER_REQUEST_RECEIVED => [NotificationChannel::DATABASE],
            // Push *and* the in-app row. The row is what makes an offer
            // visible in the app's own inbox when a push never arrives —
            // ADR-0025 §3 makes push best-effort, and a driver who declined
            // the OS permission must still be told something.
            //
            // Never mail: an offer expires in fifteen seconds, and an email
            // about one would arrive as an apology.
            self::TRIP_OFFERED => [
                NotificationChannel::PUSH,
                NotificationChannel::DATABASE,
            ],
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
        };
    }
}
