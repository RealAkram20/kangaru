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
}
