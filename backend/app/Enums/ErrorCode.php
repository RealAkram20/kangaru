<?php

namespace App\Enums;

/**
 * Stable, machine-readable error codes per AGENTS.md API Standards — clients
 * branch on `code`, never on the human-readable `message`. Grows as new
 * modules ship; never remove or repurpose an existing case.
 */
enum ErrorCode: string
{
    case VALIDATION_FAILED = 'VALIDATION_FAILED';
    case INVALID_CREDENTIALS = 'INVALID_CREDENTIALS';

    // ADR-0008. Four codes rather than one, because the client does
    // something different for each: collect a code, restart the login,
    // re-prompt, or send the user to enrolment.
    case MFA_REQUIRED = 'MFA_REQUIRED';
    case MFA_ENROLMENT_REQUIRED = 'MFA_ENROLMENT_REQUIRED';
    case MFA_CHALLENGE_INVALID = 'MFA_CHALLENGE_INVALID';
    case MFA_CODE_INVALID = 'MFA_CODE_INVALID';
    case MFA_ALREADY_ENROLLED = 'MFA_ALREADY_ENROLLED';
    case UNAUTHENTICATED = 'UNAUTHENTICATED';
    case FORBIDDEN = 'FORBIDDEN';
    case NOT_FOUND = 'NOT_FOUND';
    case SERVER_ERROR = 'SERVER_ERROR';
    case INVALID_TRIP_TRANSITION = 'INVALID_TRIP_TRANSITION';
    case INVALID_BOOKING_TRANSITION = 'INVALID_BOOKING_TRANSITION';
    case INVALID_ORDER_REQUEST_TRANSITION = 'INVALID_ORDER_REQUEST_TRANSITION';
    case VEHICLE_UNAVAILABLE = 'VEHICLE_UNAVAILABLE';
    case DRIVER_UNAVAILABLE = 'DRIVER_UNAVAILABLE';
    case REPORT_TOO_LARGE = 'REPORT_TOO_LARGE';
    case EXPORT_NOT_READY = 'EXPORT_NOT_READY';
    case EXPORT_EXPIRED = 'EXPORT_EXPIRED';

    /**
     * An exclusive allocation cannot share a vehicle with another contract
     * over the same days (ADR-0009). A conflict rather than a validation
     * failure: the request was well-formed, the world already holds
     * something incompatible with it.
     */
    case ALLOCATION_CONFLICT = 'ALLOCATION_CONFLICT';

    /**
     * The vehicle is contracted exclusively to another client for the trip's
     * date (ADR-0009). No override exists — that is what exclusivity was
     * bought — so this is a conflict rather than a missing field.
     */
    case VEHICLE_EXCLUSIVELY_ALLOCATED = 'VEHICLE_EXCLUSIVELY_ALLOCATED';

    // Modules/Billing.
    case RATE_CARD_NOT_CONFIGURED = 'RATE_CARD_NOT_CONFIGURED';
    case TRIP_NOT_INVOICEABLE = 'TRIP_NOT_INVOICEABLE';

    /**
     * A walk-in customer's trip has no client to invoice (ADR-0024).
     *
     * Distinct from TRIP_NOT_INVOICEABLE, which means "not yet": that trip
     * becomes invoiceable when it reaches Trip Completed, and a client
     * showing the button greyed out is right to. This one means "not ever",
     * and a client that cannot tell the two apart will keep offering an
     * action that can only ever fail.
     */
    case TRIP_NOT_INVOICEABLE_WALK_IN = 'TRIP_NOT_INVOICEABLE_WALK_IN';

    /**
     * The trip's distance has not been resolved yet, and its rate card bills
     * on the measured trace (ADR-0045). "Not yet", like TRIP_NOT_INVOICEABLE:
     * the resolver runs after a grace period and re-runs on late pings, so
     * the right response is to wait or to force it from the console.
     */
    case TRIP_DISTANCE_UNRESOLVED = 'TRIP_DISTANCE_UNRESOLVED';

    /**
     * The trip's distance resolved to grade C — held — and
     * `tracking.held_blocks_billing` is on (ADR-0045 §2). Nothing bills from
     * it until a person with `trips.transition.finance` clears it with a
     * reason.
     */
    case TRIP_DISTANCE_HELD = 'TRIP_DISTANCE_HELD';

    /** Clearing a trip that is not held: nothing to clear (ADR-0045 §2). */
    case TRIP_DISTANCE_NOT_HELD = 'TRIP_DISTANCE_NOT_HELD';

    case TRIP_ALREADY_INVOICED = 'TRIP_ALREADY_INVOICED';
    case IDEMPOTENCY_KEY_REUSED = 'IDEMPOTENCY_KEY_REUSED';
    case CREDIT_NOTE_EXCEEDS_INVOICE = 'CREDIT_NOTE_EXCEEDS_INVOICE';

    /**
     * A role still held by accounts cannot be deleted (ADR-0004). Deleting
     * it would leave them resolving to no permissions, which fails closed —
     * a silent, total loss of access rather than an error anyone can read.
     */
    case ROLE_IN_USE = 'ROLE_IN_USE';

    /**
     * The owner switched public order intake off (ADR-0014 phase 2). A
     * deliberate pause, not a fault — 503 with this code so the order
     * form can say "not taking online orders right now" instead of
     * "something went wrong".
     */
    case ORDERING_PAUSED = 'ORDERING_PAUSED';

    /**
     * The SMTP server refused or never answered (ADR-0014 phase 3). The
     * message carries the transport's own words — a settings screen that
     * says "failed" without saying why is a support call, not a feature.
     */
    case MAIL_DELIVERY_FAILED = 'MAIL_DELIVERY_FAILED';

    /**
     * The sign-in account cannot be attached to this driver (ADR-0016):
     * the profile already has one, or the account being linked is already
     * some other driver's. 409 rather than 422 — the request is
     * well-formed, it is the world that disagrees with it, and the caller
     * fixes it by detaching first rather than by editing a field.
     */
    case DRIVER_ACCOUNT_CONFLICT = 'DRIVER_ACCOUNT_CONFLICT';

    /**
     * Somebody already approved or rejected this driver application
     * (ADR-0027 §4). 409 for the same reason as the two codes either side
     * of it: the request is well formed and the world has moved, and the
     * reviewer fixes it by refreshing rather than by editing a field.
     *
     * Worth more here than elsewhere, because the thing a lost race would
     * otherwise produce is a second account and a second driver profile for
     * one person.
     */
    case DRIVER_APPLICATION_CLOSED = 'DRIVER_APPLICATION_CLOSED';

    /**
     * The sign-in method the caller asked for is switched off, or its
     * prerequisites are not configured (ADR-0028 §1). 409 rather than 404:
     * the endpoint exists, the platform's owner has it turned off, and the
     * caller's fix is the settings screen rather than a different URL.
     */
    case AUTH_METHOD_DISABLED = 'AUTH_METHOD_DISABLED';

    /**
     * The Google/Facebook proof did not verify — wrong audience, expired,
     * or the provider refused it (ADR-0028 §3). Never distinguishes which,
     * to the caller: the detail goes to the log, where it helps an
     * operator instead of an attacker.
     */
    case SOCIAL_TOKEN_INVALID = 'SOCIAL_TOKEN_INVALID';

    /**
     * Somebody already approved or declined this request for time off
     * (ADR-0017 §6). 409, not 422: the request is well formed and the
     * caller fixes it by looking at the answer that exists, not by editing
     * a field. Silently re-deciding leave is how a driver and a depot end
     * up holding two different answers.
     */
    case AVAILABILITY_ALREADY_ANSWERED = 'AVAILABILITY_ALREADY_ANSWERED';

    /**
     * The automatic dispatch flag is off (ADR-0020). 409 rather than 403:
     * the caller is entitled to dispatch this booking, the platform is
     * simply not doing it for them yet — and the fix is a setting, not a
     * permission.
     */
    case AUTOMATIC_DISPATCH_DISABLED = 'AUTOMATIC_DISPATCH_DISABLED';

    /**
     * No vehicle and driver are both free with enough seats (ADR-0020).
     * Distinct from VEHICLE_UNAVAILABLE, which names one that was tried:
     * this says the matcher found nothing to try, which is a staffing
     * answer rather than a retry-with-something-else one.
     */
    case NO_DISPATCH_CANDIDATE = 'NO_DISPATCH_CANDIDATE';

    /**
     * The signed-in account is not linked to a driver profile (ADR-0016),
     * so the Driver's Application has no roster to show it. 403 with a code
     * rather than a 404, because the feature exists — this account simply
     * is not a driver, which is a support question and not a bug.
     */
    case NOT_A_DRIVER = 'NOT_A_DRIVER';

    /**
     * A position heartbeat arrived from a driver who is not on duty
     * (ADR-0024 §2).
     *
     * Refused rather than silently dropped, and that is the point of it
     * having a code: the app stops sending heartbeats at sign-off, so one
     * arriving means the app and the platform disagree about whether a
     * shift is running. Ignoring it would leave the app showing a driver as
     * online while dispatch had already written them off — a disagreement
     * neither side would ever discover.
     */
    case NOT_ON_DUTY = 'NOT_ON_DUTY';

    /**
     * The offered job can no longer be answered (ADR-0024 §3).
     *
     * One code for three causes — the clock ran out, another driver was
     * faster, or the desk fulfilled the order by hand — because from the
     * driver's side they are the same event: the job is gone. Splitting them
     * would put the platform's internal bookkeeping on a screen somebody is
     * reading while driving.
     */
    case OFFER_NO_LONGER_OPEN = 'OFFER_NO_LONGER_OPEN';

    /**
     * The offer names no vehicle, so accepting it could not produce a trip
     * (ADR-0024 §3). A driver on duty before the depot issued them keys.
     */
    case OFFER_HAS_NO_VEHICLE = 'OFFER_HAS_NO_VEHICLE';

    /**
     * The token was issued to a client app whose surface does not include
     * this route (ADR-0022). 403 rather than 404: the endpoint exists and
     * the person may well be entitled to it — their *app* is not. A client
     * that gets this has either drifted from the agreed surface or is being
     * replayed somewhere it should not be.
     */
    case TOKEN_SCOPE_EXCEEDED = 'TOKEN_SCOPE_EXCEEDED';

    /**
     * The driver already has a settlement request of this kind waiting
     * (ADR-0032 §4).
     *
     * 409 rather than 422: nothing about the request they sent is malformed —
     * it is the world that refuses it, and their own wallet screen already
     * shows the open one. A driver fixes this by waiting or by cancelling,
     * not by editing a field.
     *
     * The rule exists because two pending payout requests are not two
     * payouts. They are one driver asking twice, and a queue full of
     * duplicates is a queue the office stops reading.
     */
    case SETTLEMENT_REQUEST_ALREADY_OPEN = 'SETTLEMENT_REQUEST_ALREADY_OPEN';
    /** ADR-0043. One open closure request per driver; withdraw it to change it. */
    case CLOSURE_REQUEST_ALREADY_OPEN = 'CLOSURE_REQUEST_ALREADY_OPEN';
    /** ADR-0043. A second reviewer answering a queue row a colleague just answered. */
    case CLOSURE_REQUEST_ALREADY_DECIDED = 'CLOSURE_REQUEST_ALREADY_DECIDED';
}
