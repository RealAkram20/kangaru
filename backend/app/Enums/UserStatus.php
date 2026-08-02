<?php

namespace App\Enums;

/**
 * Whether an account may be used.
 *
 * Two cases, not three. `Modules/Drivers` uses active/suspended/inactive
 * because a driver can be off the road for reasons that are not
 * disciplinary; an account is either usable or it is not, and inventing a
 * middle state nothing checks would be a status that lies.
 *
 * Accounts are **suspended, never deleted**. A user who has raised a
 * booking, issued an invoice or approved a rate card is referenced by rows
 * that must outlive them — `invoices.issued_by_user_id` is
 * `restrictOnDelete` precisely so an issued invoice can never lose the
 * person who issued it. Deletion is therefore not merely discouraged here,
 * it is refused by the database.
 *
 * AGENTS.md Compliance also requires "ex-employee accounts anonymized 90
 * days after deactivation", which needs a deactivation to count from. That
 * anonymisation job is not built — see Modules/Administration/README.md.
 */
enum UserStatus: string
{
    case ACTIVE = 'active';
    case SUSPENDED = 'suspended';

    public function label(): string
    {
        return match ($this) {
            self::ACTIVE => 'Active',
            self::SUSPENDED => 'Suspended',
        };
    }

    /** Whether an account in this state may authenticate. */
    public function canSignIn(): bool
    {
        return $this === self::ACTIVE;
    }
}
