<?php

namespace App\Models;

use Database\Factories\CustomerFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Laravel\Sanctum\HasApiTokens;

/**
 * A walk-in customer (ADR-0013 §1) — the platform's own retail client,
 * and the second principal type in the system.
 *
 * Deliberately as unlike {@see User} as possible in what it carries:
 * no role, no permission, no tenant, no MFA. Everything a customer may
 * do is "their own rows", scoped by the `customer` guard's token rather
 * than by policies that could drift (ADR-0013 §2). If a future feature
 * needs a customer to hold an ability, that is a sign it belongs on the
 * staff side of the split, not a reason to add a permission column here.
 *
 * Not `Auditable`: the audit trail records staff acting on business data
 * (AGENTS.md), and a customer editing their own name is neither. Their
 * order requests stay audited through OrderRequestService as before.
 *
 * @property string|null $password Nullable, unlike users.password: a
 *                                 Google-only customer has none (ADR-0013 §3). The registration service
 *                                 guarantees at least one credential exists; the model does not.
 * @property string|null $google_id Google's stable `sub` claim.
 */
class Customer extends Authenticatable
{
    /** @use HasFactory<CustomerFactory> */
    use HasApiTokens, HasFactory;

    /**
     * The attributes that are mass assignable.
     *
     * @var list<string>
     */
    protected $fillable = [
        'name',
        'phone',
        'email',
        'password',
        'google_id',
    ];

    /**
     * The attributes that should be hidden for serialization.
     *
     * @var list<string>
     */
    protected $hidden = [
        'password',
        'google_id',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'password' => 'hashed',
        ];
    }
}
