<?php

namespace App\Exceptions;

use Illuminate\Database\Eloquent\Model;

/**
 * Thrown when something tries to update or delete an issued financial
 * record — an invoice, an invoice line, a credit note, a credit note line,
 * or a rate card version.
 *
 * AGENTS.md Integrity: "Financial mutations are append-only where possible:
 * corrections are credit notes or adjustments, never silent edits to issued
 * invoices." This exception is what makes "never" true rather than
 * conventional. It is a programming error, not a user-facing condition —
 * no HTTP route exposes an edit path for these records, so reaching this is
 * a bug in new code, and it surfaces as a 500 rather than a friendly 4xx on
 * purpose.
 *
 * Mirrors App\Exceptions\AuditLogImmutableException and
 * TripEventImmutableException, which guard the same property on the two
 * other append-only tables.
 */
class FinancialRecordImmutableException extends \RuntimeException
{
    public function __construct(Model $record, string $operation)
    {
        parent::__construct(sprintf(
            '%s #%s is an issued financial record and cannot be %s. '.
            'Corrections to an invoice are made by issuing a credit note; '.
            'changes to a rate card are made by creating a new version.',
            class_basename($record),
            (string) ($record->getKey() ?? 'new'),
            $operation,
        ));
    }
}
