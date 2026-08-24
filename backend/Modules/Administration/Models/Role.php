<?php

namespace Modules\Administration\Models;

use App\Concerns\Auditable;
use App\Enums\AccessLevel;
use App\Enums\Permission;
use App\Enums\RoleAudience;
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
 * @property RoleAudience $audience Which level of account this role was
 *                                  composed for. A property of the role, not a scope on it — the
 *                                  catalogue stays platform-wide (ADR-0004).
 * @property bool $requires_mfa Whether holders of this role must use a
 *                              second factor (ADR-0008). A per-role flag rather than two hardcoded
 *                              slugs, because a custom role holding `invoices.manage` moves money
 *                              exactly as Finance does and must be coverable without a release.
 * @property array<int, string> $permissions Cast to array; declared so
 *                                           static analysis does not fall back to the raw column type.
 */
class Role extends Model
{
    use Auditable;

    protected $fillable = ['slug', 'name', 'description', 'is_system', 'audience', 'permissions', 'requires_mfa'];

    protected function casts(): array
    {
        return [
            'permissions' => 'array',
            'is_system' => 'boolean',
            'requires_mfa' => 'boolean',
            'audience' => RoleAudience::class,
        ];
    }

    /**
     * The roles an account at this level may be offered.
     *
     * The **level** gate, and it is only half of the answer — ADR-0004's
     * escalation rule is the other half and is applied separately, because
     * the two ask different questions. This one asks whether a role belongs
     * in this person's world at all; that one asks whether this particular
     * administrator may hand it out. Answering the first with the second is
     * what left `corporate_admin` in a fleet owner's picker whenever the
     * permission subsets happened to line up.
     *
     * An applicant has no audience and therefore no roles, which is an empty
     * picker rather than an unfiltered one.
     *
     * @param  Builder<Role>  $query
     * @return Builder<Role>
     */
    public function scopeForLevel(Builder $query, AccessLevel $level): Builder
    {
        $audience = RoleAudience::forLevel($level);

        return $audience === null
            ? $query->whereRaw('1 = 0')
            : $query->where('audience', $audience->value);
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

    /**
     * Holders of this role who have **not** set a second factor up.
     *
     * Turning `requires_mfa` on puts exactly these people into the state
     * ADR-0008 decision 3 forces out of: signed in, holding a token, and
     * refused every route but five until they enrol. The console counts them
     * before saving so the switch names who it is about to affect rather than
     * firing later, on somebody else (ADR-0061 §4).
     *
     * `mfa_confirmed_at` rather than `mfa_secret`: enrolment is only real
     * once a code has been verified against it, which is what
     * `User::hasMfaEnabled()` says.
     *
     * @return HasMany<User, $this>
     */
    public function unenrolledUsers(): HasMany
    {
        return $this->users()->whereNull('mfa_confirmed_at');
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
