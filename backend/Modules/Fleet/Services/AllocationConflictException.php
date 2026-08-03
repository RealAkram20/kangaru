<?php

namespace Modules\Fleet\Services;

use RuntimeException;

/**
 * The allocation cannot be agreed because an exclusive contract stands in
 * the way — either the one being agreed is exclusive and the vehicle is
 * already spoken for, or the vehicle is already exclusively contracted to
 * somebody else for part of the period.
 *
 * Surfaced as `409 ALLOCATION_CONFLICT`. A 409 rather than a 422 for the
 * same reason dispatch conflicts are: the request was valid, the world
 * simply already contains something incompatible with it.
 *
 * The message names the period rather than the other client. A corporate
 * admin agreeing a contract has no business learning that a competitor
 * holds that vehicle — the same instinct that makes cross-tenant reads 404
 * rather than 403 (AGENTS.md API Standards).
 */
class AllocationConflictException extends RuntimeException
{
    public function __construct(
        public readonly int $vehicleId,
        public readonly bool $candidateIsExclusive,
    ) {
        parent::__construct(
            $candidateIsExclusive
                ? 'This vehicle already has an allocation covering part of that period, so it cannot '
                    .'be contracted exclusively. Choose another vehicle, or shorten the period so it '
                    .'does not overlap an existing contract.'
                : 'This vehicle is exclusively contracted to another client for part of that period. '
                    .'Choose another vehicle, or start the allocation after that contract ends.'
        );
    }
}
