<?php

namespace Modules\Dispatch\Services;

use RuntimeException;

/**
 * The vehicle is exclusively contracted to another client for this day
 * (ADR-0009 §2), so it may not be dispatched here. There is no override —
 * that is what exclusivity was bought.
 *
 * Surfaced as `409 VEHICLE_EXCLUSIVELY_ALLOCATED`, alongside the other
 * dispatch conflicts. ADR-0009 asks for 409 specifically, per AGENTS.md's
 * use of it for "vehicle already assigned"-shaped conflicts.
 *
 * The message says what to do next and does **not** name the other client,
 * for the same reason a cross-tenant read 404s rather than 403s: which
 * competitor holds a vehicle is not the asking client's business. ADR-0009
 * also warns that this must be a clear error rather than an empty vehicle
 * list, because a stranded booking with no explanation is the one outcome
 * exclusivity should not produce.
 */
class AllocationExclusiveException extends RuntimeException
{
    public function __construct(public readonly int $vehicleId)
    {
        parent::__construct(
            'This vehicle is contracted exclusively to another client for that date and cannot be '
            .'dispatched on this trip. Choose a vehicle from the ranked list for this booking, or '
            .'ask a Super Admin whether the contract should be ended.'
        );
    }
}
