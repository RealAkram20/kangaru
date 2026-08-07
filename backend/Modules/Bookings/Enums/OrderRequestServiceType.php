<?php

namespace Modules\Bookings\Enums;

/**
 * The three services a visitor can ask for, straight from the product triad
 * in `material/` (ADR-0012): book a ride, send something, rent a vehicle.
 */
enum OrderRequestServiceType: string
{
    case RIDE = 'ride';
    case DELIVERY = 'delivery';
    case SELF_DRIVE = 'self_drive';
}
