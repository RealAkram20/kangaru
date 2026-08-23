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

    /**
     * One of an *applicant's* documents was refused (ADR-0057 §3).
     *
     * **Mail only, and not by preference.** The recipient holds no account and
     * no registered device by construction (ADR-0027 §1), so there is no row
     * to write a database notification against and nothing to push to. This is
     * delivered to an address with `Notification::route('mail', ...)`, and the
     * database channel would fail on a notifiable that is not a model.
     *
     * The message carries a **fresh claim ticket**, which is the whole reason
     * it exists: a refusal the applicant cannot answer costs them the job
     * while they wait for a call. ADR-0057 §3 records why that is not the
     * enumeration oracle ADR-0027 §5 refuses — the trigger is a signed-in
     * reviewer, not a stranger.
     */
    case DRIVER_APPLICATION_DOCUMENT_REJECTED = 'driver_application.document.rejected';

    /**
     * Kangaru support held this person's account for a while (ADR-0056 §5).
     *
     * **The half of the disclosure the person actually reads.** Their audit
     * trail already records it, and a trail nobody is told to look at deters
     * nothing — ADR-0056 exists because an admin resetting a password is *"the
     * one act an audit trail cannot tell apart from impersonation"*, and the
     * answer to that is only complete when the person on the other end knows
     * it happened.
     *
     * Sent to **individuals**, which the ADR names as drivers and walk-in
     * customers. A client's transport officer and a fleet's dispatcher act in
     * a corporate capacity and their organisation reads the same event in its
     * own audit log; a driver's account is their livelihood and they have no
     * compliance office reading anything on their behalf.
     *
     * Mail as well as the in-app row, and the reason is the whole point: a
     * notice about somebody else using your account has to reach you
     * **without** you signing in to the thing they were using.
     */
    /*
     | The client family (mail plan M5). One class,
     | `ClientEventNotification`, and a case each.
     |
     | Two audiences inside one client, and the split is the point. Operations
     | mail goes to the account that raised the booking; **finance mail goes to
     | `operator_clients.billing_email`**, because a transport officer who
     | books cars and the person who pays the bill are different people, and
     | sending invoices to the first is how they go unpaid.
     */
    case CLIENT_INVOICE_ISSUED = 'client.invoice.issued';
    case CLIENT_CREDIT_NOTE_ISSUED = 'client.credit_note.issued';

    /** ADR-0060 §4: a fleet has asked to serve this client, and only the client may answer. */
    case CLIENT_CONTRACT_REQUESTED = 'client.contract.requested';
    case CLIENT_CONTRACT_APPROVED = 'client.contract.approved';
    case CLIENT_CONTRACT_ENDED = 'client.contract.ended';

    /*
     | The driver family (mail plan M4). One class,
     | `DriverEventNotification`, and a case each.
     |
     | AGENTS.md names "Document Expiring" on its own short list of
     | notifications worth having, and it was the one item on that list with
     | nothing behind it: `driver_documents.expires_at` has been a column since
     | ADR-0052 and **nothing has ever read it on a schedule**, so a licence
     | could lapse with the office and the driver both finding out when a
     | traffic officer did.
     */
    case DRIVER_APPLICATION_RECEIVED = 'driver_application.received';
    case DRIVER_APPLICATION_APPROVED = 'driver_application.approved';
    case DRIVER_APPLICATION_REJECTED = 'driver_application.rejected';

    /** Warned at 30 days and again at 7. See `SendExpiringDocumentReminders`. */
    case DRIVER_DOCUMENT_EXPIRING = 'driver.document.expiring';

    /** The day it lapses, because that is the day they stop being compliant. */
    case DRIVER_DOCUMENT_EXPIRED = 'driver.document.expired';

    case DRIVER_SETTLEMENT_CONFIRMED = 'driver.settlement.confirmed';
    case DRIVER_SETTLEMENT_DECLINED = 'driver.settlement.declined';

    case DRIVER_WALK_IN_CONTRACT_APPROVED = 'driver.walk_in_contract.approved';
    case DRIVER_WALK_IN_CONTRACT_REFUSED = 'driver.walk_in_contract.refused';

    case DRIVER_WEEKLY_BONUS_AWARDED = 'driver.weekly_bonus.awarded';

    /*
     | The security family (mail plan M3). One notification class,
     | `SecurityEventNotification`, and a case each.
     |
     | Every one exists for the same reason: **the person who did it is not
     | always the person who owns the account.** A password change, an MFA
     | removal, a payout account edit and an address change are each a
     | legitimate action a user takes, and each the first move of somebody who
     | has taken an account. The email is a tripwire for the owner, not a
     | receipt for whoever clicked.
     |
     | Cases rather than one `account.security` value because this string is
     | also AGENTS.md's business-event name and the `notifications.type`
     | column: collapsing them would leave the audit log unable to say which
     | of nine things happened.
     */
    case ACCOUNT_PASSWORD_CHANGED = 'account.password_changed';

    /**
     * A sign-in from a browser this account has not used before (ADR-0028's
     * neighbourhood, mail plan A5).
     *
     * Keyed on the user agent alone and never on the IP. A Ugandan mobile
     * address changes several times a day, so an IP-keyed device would email
     * a driver every morning, and a warning that arrives daily is a warning
     * nobody reads on the day it matters.
     */
    case ACCOUNT_SIGNED_IN_NEW_DEVICE = 'account.signed_in_new_device';

    case ACCOUNT_MFA_ENABLED = 'account.mfa_enabled';
    case ACCOUNT_MFA_DISABLED = 'account.mfa_disabled';

    /** ADR-0010: the count nobody consulted, now said out loud before it runs out. */
    case ACCOUNT_RECOVERY_CODES_LOW = 'account.recovery_codes_low';

    case ACCOUNT_SUSPENDED = 'account.suspended';
    case ACCOUNT_REACTIVATED = 'account.reactivated';

    /**
     * Sent to the old address as well as the new one.
     *
     * Somebody who has taken an account and changed its address would
     * otherwise have silenced the one warning that reaches the real owner, by
     * redirecting it to themselves.
     */
    case ACCOUNT_EMAIL_CHANGED = 'account.email_changed';

    /** Where a driver's money goes. Same reasoning, higher stakes. */
    case DRIVER_PAYOUT_ACCOUNT_CHANGED = 'driver.payout_account.changed';

    /**
     * Somebody has an account and no way into it yet (mail plan M2).
     *
     * The first email this platform ever sends a new corporate client admin
     * or a new fleet owner, and until it existed those two were **accounts
     * nobody could sign into**: onboarding minted `Str::password(32)` and
     * discarded it, and both call sites carried a comment promising an
     * invitation that was never built.
     *
     * Because it is somebody's first contact, it is also the email most
     * likely to be read as a phishing attempt. That is why the footer names
     * the account and the reason, and why the body names who created it.
     */
    case ACCOUNT_INVITED = 'account.invited';

    /** The link lapses tomorrow and nobody has used it (mail plan A2). */
    case ACCOUNT_INVITATION_EXPIRING = 'account.invitation_expiring';

    case ACCOUNT_ACCESSED_BY_SUPPORT = 'account.accessed_by_support';

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
            self::DRIVER_APPLICATION_DOCUMENT_REJECTED => 'Document needs resending',
            self::CLIENT_INVOICE_ISSUED => 'Invoice issued',
            self::CLIENT_CREDIT_NOTE_ISSUED => 'Credit note issued',
            self::CLIENT_CONTRACT_REQUESTED => 'A fleet asked to serve you',
            self::CLIENT_CONTRACT_APPROVED => 'Fleet approved',
            self::CLIENT_CONTRACT_ENDED => 'Contract ended',
            self::DRIVER_APPLICATION_RECEIVED => 'Application received',
            self::DRIVER_APPLICATION_APPROVED => 'Application approved',
            self::DRIVER_APPLICATION_REJECTED => 'Application not approved',
            self::DRIVER_DOCUMENT_EXPIRING => 'Document expiring',
            self::DRIVER_DOCUMENT_EXPIRED => 'Document expired',
            self::DRIVER_SETTLEMENT_CONFIRMED => 'Settlement confirmed',
            self::DRIVER_SETTLEMENT_DECLINED => 'Settlement declined',
            self::DRIVER_WALK_IN_CONTRACT_APPROVED => 'Walk-in contract approved',
            self::DRIVER_WALK_IN_CONTRACT_REFUSED => 'Walk-in contract refused',
            self::DRIVER_WEEKLY_BONUS_AWARDED => 'Weekly bonus',
            self::ACCOUNT_PASSWORD_CHANGED => 'Password changed',
            self::ACCOUNT_SIGNED_IN_NEW_DEVICE => 'New sign in',
            self::ACCOUNT_MFA_ENABLED => 'Two factor on',
            self::ACCOUNT_MFA_DISABLED => 'Two factor off',
            self::ACCOUNT_RECOVERY_CODES_LOW => 'Recovery codes low',
            self::ACCOUNT_SUSPENDED => 'Account suspended',
            self::ACCOUNT_REACTIVATED => 'Account active again',
            self::ACCOUNT_EMAIL_CHANGED => 'Sign-in email changed',
            self::DRIVER_PAYOUT_ACCOUNT_CHANGED => 'Payout account changed',
            self::ACCOUNT_INVITED => 'Invitation to sign in',
            self::ACCOUNT_INVITATION_EXPIRING => 'Invitation expiring',
            self::ACCOUNT_ACCESSED_BY_SUPPORT => 'Support opened your account',
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
            // Mail alone. See the case's own note: an applicant has no account
            // to notify and no device to push to.
            self::DRIVER_APPLICATION_DOCUMENT_REJECTED => [NotificationChannel::MAIL],
            /*
             * Mail and the in-app row for the whole client family. No push:
             * a corporate administrator works at a desk, and none of this is
             * urgent in the interrupting sense.
             *
             * The two finance ones are the only emails on the platform that
             * may go to an address with no account behind it at all — see
             * `ClientEventNotification`.
             */
            self::CLIENT_INVOICE_ISSUED,
            self::CLIENT_CREDIT_NOTE_ISSUED,
            self::CLIENT_CONTRACT_REQUESTED,
            self::CLIENT_CONTRACT_APPROVED,
            self::CLIENT_CONTRACT_ENDED => [
                NotificationChannel::DATABASE,
                NotificationChannel::MAIL,
            ],
            /*
             * An applicant has no account yet and no handset, so mail is the
             * only channel that reaches them. Same shape as
             * `DRIVER_APPLICATION_DOCUMENT_REJECTED` beside it, for the same
             * reason.
             */
            self::DRIVER_APPLICATION_RECEIVED,
            self::DRIVER_APPLICATION_REJECTED => [NotificationChannel::MAIL],
            /*
             * Approval is the one that earns a push as well: the applicant
             * has an account from this moment and the app is what they do next.
             */
            self::DRIVER_APPLICATION_APPROVED => [
                NotificationChannel::DATABASE,
                NotificationChannel::MAIL,
                NotificationChannel::PUSH,
            ],
            /*
             * All three for an expiry, and this is the one type on the list
             * where the *email* is the load-bearing channel rather than the
             * courtesy. A driver whose licence lapses stops being able to work
             * legally, and the app they would see the row in is the app they
             * may have uninstalled. The push is what makes the seven-day
             * warning reach somebody the same day.
             */
            self::DRIVER_DOCUMENT_EXPIRING,
            self::DRIVER_DOCUMENT_EXPIRED => [
                NotificationChannel::DATABASE,
                NotificationChannel::PUSH,
                NotificationChannel::MAIL,
            ],
            /*
             * Money the driver asked about, so the in-app row is where they go
             * looking and the mail is what reaches them off-shift. No push:
             * ADR-0032 §3 already argues that a settlement answer is not an
             * interruption, it is an answer.
             */
            self::DRIVER_SETTLEMENT_CONFIRMED,
            self::DRIVER_SETTLEMENT_DECLINED,
            self::DRIVER_WALK_IN_CONTRACT_APPROVED,
            self::DRIVER_WALK_IN_CONTRACT_REFUSED,
            self::DRIVER_WEEKLY_BONUS_AWARDED => [
                NotificationChannel::DATABASE,
                NotificationChannel::MAIL,
            ],
            /*
             * Mail and the in-app row, for the whole security family except
             * the two below.
             *
             * No push. These are not urgent in the interrupting sense: the
             * thing has already happened and the reader's response is to make
             * a phone call, not to tap. A lock-screen alert saying somebody
             * changed your payout account is also a lock-screen alert
             * announcing to whoever is holding the phone that this account is
             * worth taking.
             */
            self::ACCOUNT_PASSWORD_CHANGED,
            self::ACCOUNT_SIGNED_IN_NEW_DEVICE,
            self::ACCOUNT_MFA_ENABLED,
            self::ACCOUNT_MFA_DISABLED,
            self::ACCOUNT_RECOVERY_CODES_LOW,
            self::ACCOUNT_REACTIVATED,
            self::ACCOUNT_EMAIL_CHANGED,
            self::DRIVER_PAYOUT_ACCOUNT_CHANGED => [
                NotificationChannel::DATABASE,
                NotificationChannel::MAIL,
            ],
            /*
             * **Mail alone.** A suspended account cannot be signed into, so an
             * in-app row would be filed in an inbox nobody can open. Same
             * shape as `DRIVER_CLOSURE_ANSWERED`, and the same argument.
             */
            self::ACCOUNT_SUSPENDED => [NotificationChannel::MAIL],
            /*
             * **Mail alone**, and for the plainest reason on this list: the
             * recipient cannot sign in. That is the entire subject of the
             * message. An in-app row would be filed in an inbox they have no
             * way to open, and there is no handset to push to because the
             * account has never been used.
             *
             * Same shape as `DRIVER_CLOSURE_ANSWERED`, arrived at from the
             * other end of an account's life.
             */
            self::ACCOUNT_INVITED, self::ACCOUNT_INVITATION_EXPIRING => [NotificationChannel::MAIL],
            // Both, deliberately. The in-app row is the record they can go
            // back to; the mail is what reaches them without signing in to the
            // account somebody else was just holding.
            self::ACCOUNT_ACCESSED_BY_SUPPORT => [
                NotificationChannel::DATABASE,
                NotificationChannel::MAIL,
            ],
            self::DRIVER_DOCUMENT_REVIEWED => [
                NotificationChannel::DATABASE,
                NotificationChannel::PUSH,
                NotificationChannel::MAIL,
            ],
        };
    }

    /**
     * Whether a recipient may switch this email off.
     *
     * Required means **security or money**: something that changes how an
     * account is reached, or something somebody owes or is owed. A person who
     * has silenced their password reset has silenced their only way back in,
     * and a client who has silenced their invoices has not stopped owing the
     * money.
     *
     * Everything else is optional, and the default is optional on purpose.
     * AGENTS.md asks for an argument before a notification type exists at
     * all; a type that additionally claims nobody may decline it needs a
     * second one. Adding a case here is that argument being made.
     *
     * `MailPreference::allows()` reads this at send time rather than trusting
     * a stored row, so a type that *becomes* required cannot stay silenced by
     * a preference somebody set while it was optional.
     */
    public function mailIsRequired(): bool
    {
        return match ($this) {
            /*
             * A refusal is required and an approval is not, which looks
             * asymmetric and is not. An approved booking is confirmed again
             * by the car arriving. A rejected one is confirmed by nothing:
             * the only signal is the absence of transport at 8am, by which
             * time the meeting is missed.
             */
            self::BOOKING_REJECTED => true,

            /*
             * A closure answer reaches an account that has just stopped
             * working, so there is no in-app row to fall back on. Switching
             * off the only channel would mean nobody is told their account
             * closed.
             */
            self::DRIVER_CLOSURE_ANSWERED => true,

            /*
             * Both document decisions gate whether somebody may drive, and a
             * rejected document that goes unread is a driver who turns up to
             * a shift they cannot work.
             */
            self::DRIVER_DOCUMENT_REVIEWED,
            self::DRIVER_APPLICATION_DOCUMENT_REJECTED => true,

            /*
             * Somebody else held this account. ADR-0056 makes that legitimate
             * and visible; a switch that hid it would make it legitimate and
             * invisible, which is the thing the notification exists to
             * prevent.
             */
            /*
             * Money owed, and a decision only this client may take.
             *
             * An invoice switched off is a bill nobody was told about, and a
             * credit note switched off is money returned that nobody knows
             * arrived. ADR-0060 §5 makes the contract request the client's own
             * to answer and nobody else's, so silencing it would leave a fleet
             * waiting on an answer the client never knew was wanted.
             */
            self::CLIENT_INVOICE_ISSUED,
            self::CLIENT_CREDIT_NOTE_ISSUED,
            self::CLIENT_CONTRACT_REQUESTED => true,

            /*
             * An expiring or expired document is the one driver email that is
             * not a courtesy: it decides whether somebody may legally work.
             * A driver who switched it off and then drove on a lapsed licence
             * would have been failed by the switch, not served by it.
             *
             * The settlement answers are money the driver is owed or has been
             * refused, which is the other half of the required test.
             */
            self::DRIVER_DOCUMENT_EXPIRING,
            self::DRIVER_DOCUMENT_EXPIRED,
            self::DRIVER_SETTLEMENT_CONFIRMED,
            self::DRIVER_SETTLEMENT_DECLINED,
            self::DRIVER_APPLICATION_APPROVED,
            self::DRIVER_APPLICATION_REJECTED => true,

            /*
             * The whole security family, and this is the clearest case on the
             * list. A person who has silenced these has silenced the only
             * warning they will ever get that somebody else is holding their
             * account, and the preference itself could only have been set by
             * somebody signed in as them.
             */
            self::ACCOUNT_PASSWORD_CHANGED,
            self::ACCOUNT_SIGNED_IN_NEW_DEVICE,
            self::ACCOUNT_MFA_ENABLED,
            self::ACCOUNT_MFA_DISABLED,
            self::ACCOUNT_RECOVERY_CODES_LOW,
            self::ACCOUNT_SUSPENDED,
            self::ACCOUNT_REACTIVATED,
            self::ACCOUNT_EMAIL_CHANGED,
            self::DRIVER_PAYOUT_ACCOUNT_CHANGED => true,

            /*
             * There is no other way in. A preference that switched this off
             * would leave somebody holding an account they can never open,
             * and they would have had to be signed in to set the preference,
             * which they cannot be.
             */
            self::ACCOUNT_INVITED,
            self::ACCOUNT_INVITATION_EXPIRING => true,

            self::ACCOUNT_ACCESSED_BY_SUPPORT => true,

            default => false,
        };
    }
}
