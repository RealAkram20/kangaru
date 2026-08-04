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
}
