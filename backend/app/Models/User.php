<?php

namespace App\Models;

// use Illuminate\Contracts\Auth\MustVerifyEmail;
use App\Casts\RoleSlug;
use App\Concerns\Auditable;
use App\Enums\Permission;
use App\Enums\UserRole;
use App\Enums\UserStatus;
use App\Support\Auth\MfaRequirement;
use Carbon\CarbonInterface;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;
use Modules\Administration\Models\Role;

/**
 * Deliberately NOT scoped by BelongsToTenant: login must locate a user by
 * email before any tenant is known. Tenant isolation for user-owned data is
 * enforced downstream, once IdentifyTenant middleware sets TenantContext
 * from this (now-authenticated) user's tenant_id.
 *
 * @property UserStatus $status Writable, unlike $role: UserAdminService
 *                              assigns it directly so the status change and its deactivated_at stamp
 *                              happen in one save and produce one audit entry.
 * @property CarbonInterface|null $deactivated_at
 * @property string|null $mfa_secret The TOTP shared secret, `encrypted`
 *                                   cast (ADR-0008). Declared because the column is `text` and static
 *                                   analysis would otherwise take the raw type over the cast.
 * @property CarbonInterface|null $mfa_confirmed_at Null until a code has been
 *                                                  verified against the secret. A stored-but-unconfirmed secret is a
 *                                                  half-finished enrolment, not an armed factor.
 * @property array<int, string>|null $mfa_recovery_codes Bcrypt hashes, inside an
 *                                                       `encrypted:array` cast. Never read back — only checked.
 * @property-read string|UserRole $role The role slug. Usually a string since
 *   ADR-0004 — but Eloquent's class-cast cache hands back the UserRole a
 *   model was assigned until it is re-read, so both are real. Compare via
 *   roleSlug(), never directly. `roleRecord` is the row it resolves to;
 *   `UserRole` remains a handle on the ten seeded slugs.
 */
class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use Auditable, HasApiTokens, HasFactory, Notifiable;

    /**
     * Memoised permission set for this request. Not an attribute — it must
     * never be mass-assigned, serialised or persisted.
     *
     * @var array<int, string>|null
     */
    private ?array $resolvedPermissions = null;

    /**
     * The attributes that are mass assignable.
     *
     * @var list<string>
     */
    protected $fillable = [
        'name',
        'email',
        'password',
        'tenant_id',
        'role',
        'status',
        'deactivated_at',
    ];

    /**
     * The attributes that should be hidden for serialization.
     *
     * @var list<string>
     */
    protected $hidden = [
        'password',
        'remember_token',
        // ADR-0008 decision 7, and this list is doing more work than
        // hiding fields from JSON.
        //
        // `AuditLog::diffForUpdate()` strips `$model->getHidden()` from the
        // changed keys, and the `created`/`deleted` branches build their
        // payload from `attributesToArray()`, which applies `$hidden` too.
        // So one entry here keeps a TOTP secret out of all three audit
        // branches as well as out of every serialisation.
        //
        // That matters more than usual because `audit_logs` is append-only:
        // a secret written into a `changes` column is not deletable, and
        // the failure would be silent. `MfaSecretIsNeverAuditedTest` asserts
        // it rather than trusting this comment.
        'mfa_secret',
        'mfa_recovery_codes',
    ];

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'role' => RoleSlug::class,
            'status' => UserStatus::class,
            'deactivated_at' => 'datetime',
            // App-level encryption, the treatment AGENTS.md requires for
            // driver documents (ADR-0008 decision 6). A TOTP secret in
            // plaintext is a second factor anybody holding a database dump
            // can compute, which would leave the login protected and the
            // control worthless.
            'mfa_secret' => 'encrypted',
            // Encrypted *and* individually hashed inside — see
            // MfaService::generateRecoveryCodes(). Nothing ever reads a
            // recovery code back, only checks one.
            'mfa_recovery_codes' => 'encrypted:array',
            'mfa_confirmed_at' => 'datetime',
        ];
    }

    /**
     * Whether this user's role demands a second factor (ADR-0008).
     *
     * Read from the role **row**, not from a constant naming two enum
     * cases. Since ADR-0004 a role is data and custom roles exist; one
     * holding `invoices.manage` moves money exactly as Finance does, so a
     * Super Admin has to be able to require MFA on it without a release.
     *
     * Defaults to false when the role resolves to nothing — a user whose
     * role slug no longer exists in the catalogue holds no permissions
     * either, so there is nothing for a second factor to protect.
     */
    public function requiresMfa(): bool
    {
        return MfaRequirement::inForce() && (bool) $this->roleRecord?->requires_mfa;
    }

    /**
     * Enrolment is only real once a code has been verified against it.
     *
     * Reports the *fact* and is deliberately not gated by
     * `MfaRequirement::inForce()`: a user with a confirmed secret has one
     * whether or not this environment is asking for it, and a profile screen
     * that claimed otherwise would be lying about what protects the account
     * the moment the switch goes back on.
     */
    public function hasMfaEnabled(): bool
    {
        return $this->mfa_secret !== null && $this->mfa_confirmed_at !== null;
    }

    /**
     * Whether this sign-in must be completed with a code.
     *
     * The pair of `hasMfaEnabled()`: that one is "does this account have a
     * factor", this one is "are we going to ask for it". They differ only
     * with the switch off (config/mfa.php), and keeping them apart is what
     * lets a developer sign in without the platform forgetting that the
     * account is enrolled.
     *
     * ADR-0010 decision 1 still holds: it is the **factor** that decides,
     * not the role. A user who enrolled voluntarily is still asked.
     */
    public function mustPresentMfa(): bool
    {
        return MfaRequirement::inForce() && $this->hasMfaEnabled();
    }

    /**
     * The state ADR-0008 decision 3 forces out of: a user who must use a
     * second factor and has not set one up.
     */
    public function mustEnrolInMfa(): bool
    {
        return $this->requiresMfa() && ! $this->hasMfaEnabled();
    }

    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class);
    }

    public function isActive(): bool
    {
        return $this->status === UserStatus::ACTIVE;
    }

    /**
     * Shanitah's own staff — dispatchers, Finance, Operations, HR, Super
     * Admin — as opposed to a client's users (ADR-0005, ADR-0006).
     *
     * Keyed off having no tenant rather than a role name, so a custom
     * platform-level role behaves the same way without anybody remembering
     * to add it to a list (ADR-0004).
     *
     * This answers *whose* records the user may reach, never *what* they may
     * do with them. Permission is `hasPermission()`, and the two compose:
     * platform-level plus `trips.view.all` is every client's trips; platform
     * level without `invoices.view` is still no client's money.
     */
    public function isPlatformLevel(): bool
    {
        return $this->tenant_id === null;
    }

    /**
     * `BelongsToTenant::scopeForActor` for the one model that does not have
     * it (ADR-0006).
     *
     * `User` deliberately carries no global tenant scope — login has to find
     * an account by email before any tenant is known — so the same rule has
     * to be expressed the other way round: add the `where` for a tenant
     * actor rather than drop a scope for a platform one. Same name on
     * purpose. A staff list is names, emails and roles, and it was one of
     * the five places the predicate was written out by hand.
     *
     * @param  Builder<User>  $query
     * @return Builder<User>
     */
    public function scopeForActor(Builder $query, User $actor): Builder
    {
        // Never `where tenant_id = null`: a tenant actor whose own tenant_id
        // were somehow null must match nothing, not every platform account.
        return $actor->isPlatformLevel()
            ? $query
            : $query->where('tenant_id', $actor->tenant_id);
    }

    /**
     * The role slug, whatever form the attribute is currently in.
     *
     * Reading `$user->role` is not reliably a string. A model that has just
     * been assigned `UserRole::SUPER_ADMIN` keeps that enum in Eloquent's
     * class-cast cache until it is re-read from the database — and
     * `actingAs()` hands controllers exactly such an instance, so a
     * comparison like `$role->slug === $user->role` is true in production
     * and false in a test. That was observed, not predicted.
     *
     * Every comparison against a slug goes through here.
     */
    public function roleSlug(): string
    {
        $role = $this->role;

        return $role instanceof UserRole ? $role->value : (string) $role;
    }

    /** @return BelongsTo<Role, $this> */
    public function roleRecord(): BelongsTo
    {
        // Joined on the slug rather than an id, so `users.role` — which
        // seeders, factories and every existing test set — remains the
        // single source of a user's role. ADR-0004's zero-downtime note:
        // additive first, never a rename in one step.
        return $this->belongsTo(Role::class, 'role', 'slug');
    }

    /**
     * Every permission this user holds, memoised for the request.
     *
     * Authorization asks this many times per request — a policy call per
     * resource in a list — so it must not be a query each time. Held on the
     * instance rather than in the cache: a role edited mid-request should
     * take effect on the next one, and a tenant-prefixed cache key for
     * something this security-sensitive is a staleness bug waiting to
     * happen.
     *
     * @return array<int, string>
     */
    public function permissions(): array
    {
        if ($this->resolvedPermissions !== null) {
            return $this->resolvedPermissions;
        }

        $role = $this->roleRecord;

        return $this->resolvedPermissions = $role instanceof Role ? $role->permissions : [];
    }

    /**
     * The question every policy now asks (ADR-0004).
     *
     * A user whose role slug matches no row holds nothing. That fails
     * closed, which is the only safe direction: a typo in `users.role`
     * takes abilities away rather than handing them out.
     */
    public function hasPermission(Permission $permission): bool
    {
        return in_array($permission->value, $this->permissions(), true);
    }

    /**
     * True only if every one of them is held. Used by the escalation rule —
     * nobody may grant what they do not have.
     *
     * @param  array<int, string>  $permissions
     */
    public function holdsAll(array $permissions): bool
    {
        return array_diff($permissions, $this->permissions()) === [];
    }
}
