<?php

namespace Modules\Fleet\Policies;

use App\Enums\Permission;
use App\Models\User;
use Modules\Fleet\Models\Zone;

/**
 * Who may see and draw geofences (ADR-0021).
 *
 * Reading is wide — dispatch, billing and ordering all resolve points
 * against zones, and somebody who cannot see a zone cannot explain why a
 * price or a refusal happened. Drawing is narrow: a boundary decides what a
 * client is charged, so moving one is a commercial act.
 *
 * A client may read the platform's zones and their own, never another
 * client's; that is enforced by `Zone::scopeVisibleTo` in the listing and
 * repeated here for the single-record reads, because a forgotten `where` in
 * one place is how ADR-0001's worst bug happens.
 */
class ZonePolicy
{
    public function viewAny(User $user): bool
    {
        return $user->hasPermission(Permission::ZONES_VIEW);
    }

    public function view(User $user, Zone $zone): bool
    {
        return $this->viewAny($user) && $this->isVisibleTo($user, $zone);
    }

    public function create(User $user): bool
    {
        return $user->hasPermission(Permission::ZONES_MANAGE);
    }

    public function update(User $user, Zone $zone): bool
    {
        return $this->create($user) && $this->isVisibleTo($user, $zone);
    }

    public function delete(User $user, Zone $zone): bool
    {
        return $this->update($user, $zone);
    }

    /** A platform zone is everyone's; a client zone is only its client's. */
    private function isVisibleTo(User $user, Zone $zone): bool
    {
        if ($zone->tenant_id === null || $user->isPlatformLevel()) {
            return true;
        }

        return $zone->tenant_id === $user->tenant_id;
    }
}
