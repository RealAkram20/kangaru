<?php

namespace App\Exceptions;

use RuntimeException;

/**
 * Thrown when anything attempts to update or delete an AuditLog row.
 * The audit trail is append-only by design — nothing should ever mutate
 * or remove an entry, even accidentally via a generic Eloquent call.
 */
class AuditLogImmutableException extends RuntimeException
{
    public function __construct()
    {
        parent::__construct('Audit log entries are append-only and cannot be modified or deleted.');
    }
}
