<?php

namespace Modules\Support\Models;

use App\Concerns\Auditable;
use App\Models\User;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Modules\Drivers\Models\Driver;
use Modules\Support\Enums\SupportRequestStatus;
use Modules\Support\Enums\SupportRequestTopic;
use Modules\Trips\Models\Trip;

/**
 * A driver's written report, and the office's answer (ADR-0044).
 *
 * `Auditable` because answering one is a staff act on somebody else's record
 * that the office may be asked to account for — *"who told the driver their
 * fare was correct, and when"* is exactly the question a disputed payment
 * produces a month later. Every `Auditable` model must also appear in
 * `AppServiceProvider`'s morph map; one missing from it throws on every insert.
 *
 * @property int $id
 * @property int $driver_id
 * @property SupportRequestTopic $topic
 * @property SupportRequestStatus $status
 * @property int|null $trip_id
 * @property string $body
 * @property string|null $answer
 * @property int|null $answered_by_user_id
 * @property CarbonInterface|null $answered_at
 * @property CarbonInterface $created_at
 * @property CarbonInterface $updated_at
 * @property-read Driver|null $driver
 */
class SupportRequest extends Model
{
    use Auditable;

    protected $fillable = [
        'driver_id',
        'topic',
        'status',
        'trip_id',
        'body',
        'answer',
        'answered_by_user_id',
        'answered_at',
    ];

    protected function casts(): array
    {
        return [
            'topic' => SupportRequestTopic::class,
            'status' => SupportRequestStatus::class,
            'answered_at' => 'datetime',
        ];
    }

    /** @return BelongsTo<Driver, $this> */
    public function driver(): BelongsTo
    {
        return $this->belongsTo(Driver::class);
    }

    /** @return BelongsTo<Trip, $this> */
    public function trip(): BelongsTo
    {
        return $this->belongsTo(Trip::class);
    }

    /** @return BelongsTo<User, $this> */
    public function answeredBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'answered_by_user_id');
    }

    /**
     * Still owed an answer.
     *
     * @param  Builder<SupportRequest>  $query
     * @return Builder<SupportRequest>
     */
    public function scopeOpen(Builder $query): Builder
    {
        return $query->where('status', SupportRequestStatus::OPEN->value);
    }
}
