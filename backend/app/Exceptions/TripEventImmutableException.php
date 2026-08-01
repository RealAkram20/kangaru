<?php

namespace App\Exceptions;

use RuntimeException;

/**
 * Thrown when anything attempts to update or delete a TripEvent row. The
 * trip timeline is append-only by design (AGENTS.md: waiting-time billing
 * is computed from trip_events, never from a mutable column) — nothing
 * should ever mutate or remove an entry, even accidentally.
 */
class TripEventImmutableException extends RuntimeException
{
    public function __construct()
    {
        parent::__construct('Trip event entries are append-only and cannot be modified or deleted.');
    }
}
