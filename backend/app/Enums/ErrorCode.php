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
     * The token was issued to a client app whose surface does not include
     * this route (ADR-0022). 403 rather than 404: the endpoint exists and
     * the person may well be entitled to it — their *app* is not. A client
     * that gets this has either drifted from the agreed surface or is being
     * replayed somewhere it should not be.
     */
    case TOKEN_SCOPE_EXCEEDED = 'TOKEN_SCOPE_EXCEEDED';
}
