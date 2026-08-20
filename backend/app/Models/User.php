<?php

namespace App\Models;

// use Illuminate\Contracts\Auth\MustVerifyEmail;
use App\Casts\RoleSlug;
use App\Concerns\Auditable;
use App\Enums\ClientCapability;
use App\Enums\Permission;
use App\Enums\UserRole;
use App\Enums\UserStatus;
use Carbon\CarbonInterface;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;
use Modules\Administration\Models\Role;
use Modules\Clients\Models\ClientRoute;

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
        // The work number a driver is given when this person travels. See
        // the `phone` migration for why it is nullable on the column and
        // required by `StoreUserRequest` all the same.
        'phone',
        'password',
        'tenant_id',
        'role',
        'capabilities',
        'books_without_approval',
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
            'capabilities' => 'array',
            'books_without_approval' => 'boolean',
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
        return (bool) $this->roleRecord?->requires_mfa;
    }

    /** Enrolment is only real once a code has been verified against it. */
    public function hasMfaEnabled(): bool
    {
        return $this->mfa_secret !== null && $this->mfa_confirmed_at !== null;
    }

    /**
     * The state ADR-0008 decision 3 forces out of: a user who must use a
     * second factor and has not set one up.
     */
    public function mustEnrolInMfa(): bool
    {
        return $this->requiresMfa() && ! $this->hasMfaEnabled();
    }

    /** @return BelongsTo<Tenant, $this> */
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
     * The client's routes this person rides (ADR-0045 §8).
     *
     * The other half of `ClientRoute::members()`, and the same warning
     * applies: **this is a roster, not a permission.** Nothing authorises
     * off it. It exists so a colleague's routes can be set where the
     * colleague is created — the roster is a fact about a person, and
     * making an administrator open four routes to add one new starter to
     * each was the reason the relation went unused from the route's side.
     *
     * @return BelongsToMany<ClientRoute, $this>
     */
    public function clientRoutes(): BelongsToMany
    {
        // Ordered here rather than at each call site, for the reason
        // `ClientRoute::stops()` gives: `route_ids` is compared and
        // round-tripped by the staff screen, and a roster that comes back
        // in pivot-insertion order looks like a different roster every
        // time somebody is added.
        return $this->belongsToMany(ClientRoute::class, 'client_route_members')
            ->orderBy('client_routes.id')
            ->withTimestamps();
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
        $fromRole = $role instanceof Role ? $role->permissions : [];

        // Plus what a client's administrator switched on for this person
        // (App\Enums\ClientCapability). Only slugs the enum knows, and only
        // the permissions those bundles name — an unknown slug or a stray
        // permission in the column grants nothing. No role means no
        // capabilities either: the union widens a role, it does not stand
        // in for one.
        $fromCapabilities = [];
        if ($role instanceof Role) {
            foreach ($this->capabilities() as $capability) {
                foreach ($capability->permissions() as $permission) {
                    $fromCapabilities[] = $permission->value;
                }
            }
        }

        return $this->resolvedPermissions = array_values(array_unique([...$fromRole, ...$fromCapabilities]));
    }

    /**
     * The capabilities switched on for this user, as enum cases. Slugs the
     * enum does not know are dropped silently — fail closed, never fatal.
     *
     * @return array<int, ClientCapability>
     */
    public function capabilities(): array
    {
        // `getAttribute`, not `$this->capabilities`: the column and this
        // method share a name, and reading the property leaves it ambiguous
        // to a reader (and to static analysis) which of the two is meant.
        // This says plainly that the stored column is what is being read.
        $slugs = $this->getAttribute('capabilities');
        $cases = [];
        foreach (is_array($slugs) ? $slugs : [] as $slug) {
            $case = is_string($slug) ? ClientCapability::tryFrom($slug) : null;
            if ($case !== null) {
                $cases[$case->value] = $case;
            }
        }

        return array_values($cases);
    }

    /** Whether a booking this user creates is approved on their behalf. */
    public function booksWithoutApproval(): bool
    {
        return (bool) $this->books_without_approval;
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
