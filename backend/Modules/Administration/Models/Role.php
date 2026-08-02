<?php

namespace Modules\Administration\Models;

use App\Concerns\Auditable;
use App\Enums\Permission;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A named set of permissions (ADR-0004).
 *
 * Not tenant-scoped, deliberately: the catalogue is platform-wide and only
 * a Super Admin curates it. Deliberately NOT using `BelongsToTenant` for
 * that reason — a global scope here would hide every role from every
 * tenant user and break authorization for the whole platform.
 *
 * `Auditable`, because AGENTS.md requires an audit trail over
 * "roles/permissions" and this is now literally where those live. The JSON
 * permissions column is what makes that diff readable: one row, one grant.
 *
 * @property int $id
 * @property string $slug
 * @property string $name
 * @property string|null $description
 * @property bool $is_system
 * @property array<int, string> $permissions Cast to array; declared so
 *                                           static analysis does not fall back to the raw column type.
 */
class Role extends Model
{
    use Auditable;

    protected $fillable = ['slug', 'name', 'description', 'is_system', 'permissions'];

    protected function casts(): array
    {
        return [
            'permissions' => 'array',
            'is_system' => 'boolean',
        ];
    }

    public function getRouteKeyName(): string
    {
        return 'slug';
    }

    /**
     * @param  Builder<Role>  $query
     * @return Builder<Role>
     */
    public function scopeCustom(Builder $query): Builder
    {
        return $query->where('is_system', false);
    }

    /**
     * The permissions this role grants, as enum cases.
     *
     * Unknown strings are dropped rather than throwing. A permission
     * removed from the catalogue in a release would otherwise make every
     * role holding it fatal on load — taking the whole platform down to
     * punish a stale row. Dropping it degrades to "that ability no longer
     * exists", which is the truth.
     *
     * @return array<int, Permission>
     */
    public function permissionCases(): array
    {
        return array_values(array_filter(array_map(
            fn (string $value) => Permission::tryFrom($value),
            $this->permissions,
        )));
    }

    /**
     * Accounts holding this role, joined on the slug for the same reason
     * User::roleRecord() is: `users.role` stays the single source.
     *
     * @return HasMany<User, $this>
     */
    public function users(): HasMany
    {
        return $this->hasMany(User::class, 'role', 'slug');
    }

    public function grants(Permission $permission): bool
    {
        return in_array($permission->value, $this->permissions, true);
    }

    /**
     * Whether this role's grant is contained by `$other`.
     *
     * The escalation rule from ADR-0004: nobody may hand out a permission
     * they do not themselves hold. Asked of the role being assigned against
     * the assigner's own permissions.
     *
     * @param  array<int, string>  $held
     */
    public function isSubsetOf(array $held): bool
    {
        return array_diff($this->permissions, $held) === [];
    }
}
