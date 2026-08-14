<?php

namespace Modules\Trips\Models;

use App\Concerns\Auditable;
use App\Models\Customer;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Modules\Drivers\Models\Driver;

/**
 * What a passenger thought of one ride (ADR-0030).
 *
 * Written once and never edited (§2): an editable rating is a lever over a
 * driver, and this market gives a passenger enough of those already.
 *
 * @property int $id
 * @property int $trip_id
 * @property int $customer_id
 * @property int $driver_id
 * @property int $stars
 * @property string|null $comment
 */
class TripRating extends Model
{
    use Auditable;

    protected $fillable = ['trip_id', 'customer_id', 'driver_id', 'stars', 'comment'];

    protected function casts(): array
    {
        return ['stars' => 'integer'];
    }

    /**
     * @return BelongsTo<Trip, $this>
     */
    public function trip(): BelongsTo
    {
        return $this->belongsTo(Trip::class);
    }

    /**
     * @return BelongsTo<Driver, $this>
     */
    public function driver(): BelongsTo
    {
        return $this->belongsTo(Driver::class);
    }

    /**
     * @return BelongsTo<Customer, $this>
     */
    public function customer(): BelongsTo
    {
        return $this->belongsTo(Customer::class);
    }
}
