<?php

namespace App\Models;

use Database\Factories\CustomerFactory;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Laravel\Sanctum\HasApiTokens;
use Modules\Bookings\Models\OrderRequest;
use Modules\Customers\Enums\CustomerGender;
use Modules\Customers\Enums\CustomerStatus;

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
 * @property string $first_name
 * @property string $last_name
 * @property CustomerGender|null $gender Null means never asked, which is
 *                                       not the same answer as PREFER_NOT_TO_SAY (ADR-0015 §2).
 * @property-read string $name Composed from the pair; see {@see name()}.
 * @property CustomerStatus $status ADR-0018 — a suspended account keeps its
 *                                  history and loses its sessions.
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
        'first_name',
        'last_name',
        'gender',
        'phone',
        'email',
        'password',
        'google_id',
        // ADR-0018. Mass-assignable because the admin service writes it
        // through `update()`; nothing customer-facing can reach it — the
        // registration and profile requests whitelist their own fields.
        'status',
        'suspended_at',
        'suspension_reason',
        'suspended_by_user_id',
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
            'gender' => CustomerGender::class,
            'status' => CustomerStatus::class,
            'suspended_at' => 'immutable_datetime',
        ];
    }

    /**
     * Everything this customer has ever asked for (ADR-0018 §4).
     *
     * The only activity a customer currently has: ADR-0012's `converted`
     * status does not yet create a Trip, so there is no trip history to
     * join to. When walk-in fulfilment lands, the timeline gains a second
     * source rather than changing shape.
     *
     * @return HasMany<OrderRequest, $this>
     */
    public function orderRequests(): HasMany
    {
        return $this->hasMany(OrderRequest::class);
    }

    /**
     * The full name, composed rather than stored (ADR-0015). Every reader
     * that predates the name split — the dispatcher queue through
     * OrderRequestResource, order notifications — asks for `name` and
     * still gets one, so the split stayed invisible to them.
     *
     * @return Attribute<string, never>
     */
    protected function name(): Attribute
    {
        return Attribute::get(
            fn (): string => trim($this->first_name.' '.$this->last_name),
        );
    }
}
