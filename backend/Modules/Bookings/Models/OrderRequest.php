<?php

namespace Modules\Bookings\Models;

use App\Concerns\Auditable;
use App\Models\Customer;
use App\Models\User;
use Database\Factories\OrderRequestFactory;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use Modules\Bookings\Enums\OrderRequestServiceType;
use Modules\Bookings\Enums\OrderRequestStatus;

/**
 * A walk-in visitor's ask, before any account, booking, or trip exists
 * (ADR-0012). Written by the public endpoint, worked by platform staff
 * holding `order_requests.manage`, and never visible to a tenant.
 *
 * **No `BelongsToTenant` on purpose** — the walk-in customer is the
 * platform's customer (ADR-0005), so this row has no tenant to belong to.
 * `Auditable` still applies; `AuditLog::record()` stores a null tenant_id
 * for a model without one, the same platform scope audit rows already
 * support.
 *
 * `status` is only ever changed by OrderRequestService, for the same reason
 * Booking::status and Trip::status are gated.
 *
 * @property int $id
 * @property string $reference
 * @property OrderRequestServiceType $service_type
 * @property OrderRequestStatus $status
 * @property string $contact_name
 * @property string $contact_phone
 * @property string|null $contact_email
 * @property string|null $pickup_location
 * @property string|null $dropoff_location
 * @property Carbon|null $scheduled_for
 * @property array<string, mixed>|null $details
 * @property string|null $notes
 * @property string|null $dispatcher_notes
 * @property int|null $handled_by_user_id
 * @property int|null $customer_id Null for an anonymous walk-in (ADR-0013
 *                                 §4). Stamped by the public endpoint when a customer token
 *                                 accompanies the request; never required.
 */
class OrderRequest extends Model
{
    /** @use HasFactory<OrderRequestFactory> */
    use Auditable, HasFactory;

    /**
     * @see Vehicle::newFactory() for why this is explicit.
     *
     * @return Factory<self>
     */
    protected static function newFactory(): Factory
    {
        return OrderRequestFactory::new();
    }

    protected $fillable = [
        'reference',
        'service_type',
        'status',
        'contact_name',
        'contact_phone',
        'contact_email',
        'pickup_location',
        // ADR-0020 §2: where the pickup and drop-off actually are, when the
        // caller's geocoder knew. Nullable — a phone order has neither.
        'pickup_latitude',
        'pickup_longitude',
        'dropoff_location',
        'dropoff_latitude',
        'dropoff_longitude',
        'scheduled_for',
        'details',
        'notes',
        'dispatcher_notes',
        'handled_by_user_id',
        'customer_id',
    ];

    protected function casts(): array
    {
        return [
            'service_type' => OrderRequestServiceType::class,
            // Cast, because MariaDB hands DECIMAL back as a *string* and the
            // API would otherwise emit "0.3476000" where the contract — and
            // every map library — expects a number. A mobile client parsing
            // a string coordinate is a bug waiting for a bad connection.
            // 7dp sits well inside float64's precision.
            'pickup_latitude' => 'float',
            'pickup_longitude' => 'float',
            'dropoff_latitude' => 'float',
            'dropoff_longitude' => 'float',
            'status' => OrderRequestStatus::class,
            'scheduled_for' => 'datetime',
            'details' => 'array',
        ];
    }

    /**
     * `KR-` + 6 characters a person can read down a phone line: uppercase,
     * with 0/O and 1/I excluded so "is that a zero or an oh" never happens.
     * Collision-checked because 28^6 is large but not a guarantee.
     */
    public static function mintReference(): string
    {
        do {
            $reference = 'KR-'.strtoupper(Str::random(6));
            $reference = strtr($reference, ['0' => '2', 'O' => '3', '1' => '4', 'I' => '5', 'L' => '6']);
        } while (self::query()->where('reference', $reference)->exists());

        return $reference;
    }

    /** @return BelongsTo<User, $this> */
    public function handledBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'handled_by_user_id');
    }

    /** @return BelongsTo<Customer, $this> */
    public function customer(): BelongsTo
    {
        return $this->belongsTo(Customer::class);
    }
}
