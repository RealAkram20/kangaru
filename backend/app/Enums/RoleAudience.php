<?php

namespace App\Enums;

/**
 * Who a role was composed for.
 *
 * ## Why a role needs this at all
 *
 * ADR-0004 keeps **one** curated catalogue that every organisation picks from,
 * and this does not divide it. A role is still platform-wide, still authored
 * by head office, still stored in one table with no owner. What this records
 * is a property *of the role* — the kind of account it was written for — not a
 * scope on who may read it.
 *
 * The distinction matters because the two are easy to conflate and ADR-0004
 * refused the second: a role owned by a fleet would be invisible to every
 * other fleet and editable by none of them, which is the per-organisation
 * catalogue that ADR was written against.
 *
 * ## What went wrong without it
 *
 * Before this, the only thing keeping `corporate_admin` out of a fleet
 * owner's role picker was ADR-0004's escalation rule — you may not grant
 * permissions you do not hold — which filtered it out **by coincidence of
 * which permissions each set happened to contain.**
 *
 * A coincidence is not a boundary. The moment head office composes the roles
 * it was asked for — "Fleet HR", "Client Approver" — the sets stop being
 * conveniently disjoint, and a fleet owner is offered a role written for a
 * bank's booking desk wherever the subset test happens to allow it.
 *
 * So the level gets its own gate, beside the permission one, exactly as
 * ADR-0059 §1 already argues for the menu: *"May a Dispatcher see the
 * dispatch board?"* is a role question; *"Does a dispatch board exist in this
 * person's world at all?"* is a level question, and answering the second with
 * a permission list means never forgetting an entry, forever.
 *
 * ## No default, and no null
 *
 * A role belonging to no audience would appear in nobody's picker while
 * looking perfectly healthy in the catalogue — the same fail-quiet shape
 * ADR-0055 §4 refuses for `access_level`. The column is not nullable and the
 * migration names all ten existing roles explicitly rather than defaulting
 * them.
 */
enum RoleAudience: string
{
    /** Head office's own staff. */
    case KANGARU = 'kangaru';

    /** A fleet company's people — its office staff and its drivers. */
    case FLEET = 'fleet';

    /** A corporate client's own people. */
    case CLIENT = 'client';

    /**
     * The audience an account at this level may be given a role from.
     *
     * Exhaustive on `AccessLevel`, so a fifth level cannot be added without
     * this being considered — the property four other files already lean on.
     *
     * An applicant gets `null`, which is an empty picker rather than a
     * permissive one. Their reach is keyed off their own application id and
     * nothing else (ADR-0055, amendment), so there is no role to offer them
     * and "no audience" must not read as "any audience".
     */
    public static function forLevel(AccessLevel $level): ?self
    {
        return match ($level) {
            AccessLevel::KANGARU => self::KANGARU,
            AccessLevel::FLEET => self::FLEET,
            AccessLevel::CLIENT => self::CLIENT,
            AccessLevel::APPLICANT => null,
        };
    }

    /**
     * What the console calls this audience.
     *
     * The words are the owner's, per ADR-0055 §1: in code the client axis is
     * `tenant_id`, but on every screen and in every conversation it is
     * "client" and "fleet" — never "tenant".
     */
    public function label(): string
    {
        return match ($this) {
            self::KANGARU => 'Kangaru',
            self::FLEET => 'Fleet',
            self::CLIENT => 'Client',
        };
    }

    /**
     * The catalogue the console renders as a picker.
     *
     * Served rather than hardcoded, for the reason `RolesPage` already keeps
     * no copy of the permission catalogue: a list the screen builds itself is
     * a list that drifts.
     *
     * @return array<int, array{value: string, label: string}>
     */
    public static function catalogue(): array
    {
        return array_map(
            fn (self $audience) => ['value' => $audience->value, 'label' => $audience->label()],
            self::cases(),
        );
    }
}
