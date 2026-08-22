<?php

namespace App\Models;

// use Illuminate\Contracts\Auth\MustVerifyEmail;
use App\Casts\RoleSlug;
use App\Concerns\Auditable;
use App\Enums\AccessLevel;
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
 * @property AccessLevel $access_level Which level this account belongs to
 *                                     (ADR-0055 §4). Declared for the same reason `$mfa_secret`
 *                                     is below: the column is a `string` and static analysis takes the raw
 *                                     column type over the cast, which turns every `match` on this into
 *                                     "always false" — seventeen of them, in four files.
 * @property int|null $operator_id The fleet this person works for, null for a
 *                                 client's own staff and for Kangaru's. Which of those two a null
 *                                 means is `$access_level`'s question.
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
        // Beside `tenant_id` because they are the two halves of one
        // question (ADR-0055). `access_level` is deliberately **absent**:
        // it is derived on save from these two, and the one value that
        // cannot be derived — `kangaru` — must be assigned in code by
        // somebody who meant it, never arrive in a request payload.
        'operator_id',
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
            'access_level' => AccessLevel::class,
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
     * The ownership invariant, settled before every write (ADR-0055 §4).
     *
     * `access_level` is derived here rather than being another field every
     * caller has to remember, and deriving it is not a softening of the ADR:
     * the one value that would be dangerous to guess — `kangaru` — is the one
     * value this cannot produce. Two nulls do not become head office; they
     * throw.
     *
     * That is the difference the hazard turns on. Six accounts on the
     * development database are null-client rows today, **three of them
     * drivers**, and inference would have promoted every one of them with
     * nothing failing anywhere.
     *
     * The database holds the same rule as a `CHECK` constraint, so a raw query
     * or a seeder that never loads this class is caught too. This half exists
     * to fail with a sentence rather than an SQLSTATE.
     */
    protected static function booted(): void
    {
        static::saving(function (self $user): void {
            $user->access_level = self::levelFor($user);
        });
    }

    /**
     * @throws \RuntimeException when the two ownership columns do not describe
     *                           exactly one level
     */
    private static function levelFor(self $user): AccessLevel
    {
        $operatorId = $user->operator_id;
        $tenantId = $user->tenant_id;

        if ($operatorId !== null && $tenantId !== null) {
            throw new \RuntimeException(
                "User {$user->email} names both a fleet and a client. They are "
                .'independent axes (ADR-0055) and an account belongs to exactly '
                .'one of them: a fleet employs the person, a client employs the '
                .'person, and nobody is employed by both.'
            );
        }

        if ($tenantId !== null) {
            return AccessLevel::CLIENT;
        }

        if ($operatorId !== null) {
            return AccessLevel::FLEET;
        }

        // Two levels share this column shape, and both must be *declared*.
        // Neither can be reached by omission, which is the whole of §4.
        if (in_array($user->access_level, [AccessLevel::KANGARU, AccessLevel::APPLICANT], true)) {
            return $user->access_level;
        }

        throw new \RuntimeException(
            "User {$user->email} names neither a fleet nor a client. That shape "
            .'is Kangaru — head office — and it is never inferred: assign '
            .'access_level = AccessLevel::KANGARU explicitly if that is what '
            .'was meant, or give the account an operator_id. A fleet driver '
            .'silently becoming head office is the failure this guard exists '
            .'for (ADR-0055 §4).'
        );
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

    /**
     * The fleet company this person works for, if any (ADR-0055).
     *
     * Null for a client's own staff and for Kangaru's. Which of those two a
     * null means is `access_level`'s question, never this relation's — that
     * distinction is the whole reason the column exists.
     *
     * @return BelongsTo<Operator, $this>
     */
    public function operator(): BelongsTo
    {
        return $this->belongsTo(Operator::class);
    }

    public function isActive(): bool
    {
        return $this->status === UserStatus::ACTIVE;
    }

    /**
     * A fleet company's own staff — dispatchers, Finance, Operations, HR,
     * Super Admin — as opposed to a client's users (ADR-0005, ADR-0006).
     *
     * Keyed off the declared level rather than a role name, so a custom
     * fleet-level role behaves the same way without anybody remembering to
     * add it to a list (ADR-0004).
     *
     * **This used to read `tenant_id === null`, and that is now one answer to
     * two questions** (ADR-0055). A `kangaru` account has no client either, and
     * it must *not* inherit what this grants: head office reads Kangaru's own
     * rows and reaches a fleet's by acting as somebody in it (ADR-0056), never
     * by being mistaken for fleet staff. Keying on `FLEET` specifically is what
     * keeps the two apart, and it is behaviour-identical today because F0
     * deliberately creates no Kangaru accounts.
     *
     * The name is kept, against ADR-0055 §1's own advice about the word
     * "platform", for a reason worth stating: renaming it touches 35 call
     * sites in 26 files in the same pass that changes what it *means*, and a
     * reviewer cannot then tell the mechanical half from the load-bearing
     * half. The meaning moves here, alone, where the diff is four words. The
     * rename belongs to F2, which touches these call sites anyway.
     *
     * This answers *whose* records the user may reach, never *what* they may
     * do with them. Permission is `hasPermission()`, and the two compose:
     * platform-level plus `trips.view.all` is every client's trips; platform
     * level without `invoices.view` is still no client's money.
     */
    public function isPlatformLevel(): bool
    {
        return $this->access_level === AccessLevel::FLEET;
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
        // Was `isPlatformLevel() ? $query : where tenant_id = ...`, and the
        // unbounded branch is the hole ADR-0055 closes: a *second* fleet's
        // dispatcher would have read the first fleet's entire staff list.
        // Nothing leaks today because there is one fleet, which is exactly the
        // kind of gap that ships.
        //
        // The old comment warned never to write `where tenant_id = null`,
        // because a client actor whose own `tenant_id` were somehow null would
        // then match every platform account. That shape is now impossible
        // rather than merely discouraged — `users_access_level_matches_columns`
        // refuses to store a `client` row without a client.
        return match ($actor->access_level) {
            // Their own fleet's people, plus every client's — a fleet
            // administrator manages the clients they serve. F2 narrows the
            // second half to the clients this fleet actually contracts with;
            // today one fleet serves all of them, so this is behaviour for
            // behaviour what it replaced.
            AccessLevel::FLEET => $query->where(function (Builder $scoped) use ($actor): void {
                $scoped->where('users.operator_id', $actor->operator_id)
                    ->orWhereNotNull('users.tenant_id');
            }),
            // Head office administers head office. Reaching into a fleet or a
            // client is ADR-0056's act-as, which arrives as that person and is
            // scoped as them.
            AccessLevel::KANGARU => $query->where('users.access_level', AccessLevel::KANGARU),
            AccessLevel::CLIENT => $query->where('users.tenant_id', $actor->tenant_id),
            // An applicant reads their own application and nothing else.
            // Not even themselves here: this scope answers "which staff
            // list may they read", and the answer is none.
            AccessLevel::APPLICANT => $query->whereRaw('1 = 0'),
        };
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
