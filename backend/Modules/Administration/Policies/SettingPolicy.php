<?php

namespace Modules\Administration\Policies;

use App\Enums\Permission;
use App\Models\User;
use Modules\Administration\Models\Setting;

/**
 * ADR-0014 §4: one permission for both directions. Reading settings
 * shows operational levers and infrastructure state, so it is gated as
 * tightly as writing them.
 */
class SettingPolicy
{
    public function viewAny(User $user): bool
    {
        return $user->hasPermission(Permission::SETTINGS_MANAGE);
    }

    public function update(User $user, ?Setting $setting = null): bool
    {
        return $this->viewAny($user);
    }
}
