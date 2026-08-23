<?php

namespace Modules\Clients\Requests;

use App\Models\User;

/**
 * The tenant a uniqueness rule is scoped to, narrowed once.
 *
 * All four place and route requests need the same thing, and
 * `$this->user()` is typed `User|Customer|null` — a customer authenticates
 * on their own guard (ADR-0013) and has no `tenant_id`, so reaching for one
 * is a type error rather than a null. The `instanceof` is the narrowing
 * `BookingIndexRequest` already uses; this is that, in one place, because
 * AGENTS.md's rule about the second copy applies to four.
 *
 * Returning null is safe: the policy has already refused anyone who is not
 * a tenant-bound user by the time these rules run, so a null here would
 * scope the uniqueness check to nothing and the request would be refused
 * before it mattered.
 */
trait ScopesUniquenessToActorTenant
{
    private function actorTenantId(): ?int
    {
        $actor = $this->user();

        return $actor instanceof User ? $actor->tenant_id : null;
    }
}
