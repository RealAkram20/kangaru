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
    case UNAUTHENTICATED = 'UNAUTHENTICATED';
    case FORBIDDEN = 'FORBIDDEN';
    case NOT_FOUND = 'NOT_FOUND';
    case SERVER_ERROR = 'SERVER_ERROR';
    case INVALID_TRIP_TRANSITION = 'INVALID_TRIP_TRANSITION';
    case INVALID_BOOKING_TRANSITION = 'INVALID_BOOKING_TRANSITION';
    case VEHICLE_UNAVAILABLE = 'VEHICLE_UNAVAILABLE';
    case DRIVER_UNAVAILABLE = 'DRIVER_UNAVAILABLE';
    case REPORT_TOO_LARGE = 'REPORT_TOO_LARGE';
    case EXPORT_NOT_READY = 'EXPORT_NOT_READY';
    case EXPORT_EXPIRED = 'EXPORT_EXPIRED';

    // Modules/Billing.
    case RATE_CARD_NOT_CONFIGURED = 'RATE_CARD_NOT_CONFIGURED';
    case TRIP_NOT_INVOICEABLE = 'TRIP_NOT_INVOICEABLE';
    case TRIP_ALREADY_INVOICED = 'TRIP_ALREADY_INVOICED';
    case IDEMPOTENCY_KEY_REUSED = 'IDEMPOTENCY_KEY_REUSED';
    case CREDIT_NOTE_EXCEEDS_INVOICE = 'CREDIT_NOTE_EXCEEDS_INVOICE';
}
