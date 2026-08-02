<?php

namespace App\Models;

// use Illuminate\Contracts\Auth\MustVerifyEmail;
use App\Concerns\Auditable;
use App\Enums\UserRole;
use App\Enums\UserStatus;
use Carbon\CarbonInterface;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

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
 * @property-read UserRole $role Explicit annotation so static analysis
 *   resolves the enum cast correctly through JsonResource's @mixin and
 *   through Policy method parameters, not just direct model access.
 */
class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use Auditable, HasApiTokens, HasFactory, Notifiable;

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
            'role' => UserRole::class,
            'status' => UserStatus::class,
            'deactivated_at' => 'datetime',
        ];
    }

    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class);
    }

    public function isActive(): bool
    {
        return $this->status === UserStatus::ACTIVE;
    }
}
