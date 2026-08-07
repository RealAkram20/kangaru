<?php

namespace Modules\Fleet\Models;

use App\Concerns\Auditable;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Database\Factories\AvailabilityBlockFactory;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;
use Modules\Fleet\Enums\AvailabilityKind;
use Modules\Fleet\Enums\AvailabilityResource;
use Modules\Fleet\Enums\AvailabilityStatus;

/**
 * A period a driver or vehicle is not available (ADR-0017).
 *
 * Not `BelongsToTenant`, like `Driver` and `Vehicle` themselves: the fleet
 * is the platform's (ADR-0005), so a driver's leave is Shanitah's fact and
 * not any client's.
 *
 * @property AvailabilityResource $resource_type
 * @property int $resource_id
 * @property AvailabilityKind $kind
 * @property AvailabilityStatus $status
 * @property string|null $answer_note
 * @property CarbonImmutable|null $answered_at
 * @property CarbonImmutable $starts_at
 * @property CarbonImmutable|null $ends_at
 */
class AvailabilityBlock extends Model
{
    /** @use HasFactory<AvailabilityBlockFactory> */
    use Auditable, HasFactory, SoftDeletes;

    /**
     * @return Factory<self>
     */
    protected static function newFactory(): Factory
    {
        return AvailabilityBlockFactory::new();
    }

    protected $fillable = [
        'resource_type',
        'resource_id',
        'kind',
        'status',
        'starts_at',
        'ends_at',
        'reason',
        'created_by_user_id',
        // The answer trail. Omitted at first, and mass assignment dropped
        // every one silently — a declined request kept its note nowhere,
        // which is precisely the record ADR-0017 §6 keeps a declined row
        // around to preserve.
        'answered_by_user_id',
        'answered_at',
        'answer_note',
    ];

    protected function casts(): array
    {
        return [
            'resource_type' => AvailabilityResource::class,
            'kind' => AvailabilityKind::class,
            'status' => AvailabilityStatus::class,
            'starts_at' => 'immutable_datetime',
            'ends_at' => 'immutable_datetime',
            'answered_at' => 'immutable_datetime',
        ];
    }

    /**
     * Only agreed time off withholds anything from dispatch (ADR-0017 §6).
     *
     * Every availability read goes through this scope. A driver who could
     * take themselves off the roster by *asking* would have leave nobody
     * approved, and the fleet would discover it at 6am when the van did not
     * move.
     *
     * @param  Builder<self>  $query
     * @return Builder<self>
     */
    public function scopeBinding(Builder $query): Builder
    {
        return $query->where('status', AvailabilityStatus::APPROVED);
    }

    public function isAnswered(): bool
    {
        return $this->status !== AvailabilityStatus::REQUESTED;
    }

    /**
     * @param  Builder<self>  $query
     * @return Builder<self>
     */
    public function scopeForResource(Builder $query, AvailabilityResource $type, int $id): Builder
    {
        return $query->where('resource_type', $type)->where('resource_id', $id);
    }

    /**
     * Blocks that overlap the half-open window `[$from, $to)`.
     *
     * Half-open on purpose, and it is the whole correctness of the feature.
     * A block ending at 14:00 and a trip starting at 14:00 do not overlap —
     * a vehicle out of the workshop at two is available at two. Closed
     * intervals would refuse every back-to-back booking in the fleet, which
     * is how an availability feature gets switched off a week after launch.
     *
     * `ends_at IS NULL` is open-ended and therefore overlaps anything that
     * has not finished before it started.
     *
     * @param  Builder<self>  $query
     * @return Builder<self>
     */
    public function scopeOverlapping(Builder $query, CarbonInterface $from, CarbonInterface $to): Builder
    {
        return $query
            ->where('starts_at', '<', $to)
            ->where(fn (Builder $q) => $q->whereNull('ends_at')->orWhere('ends_at', '>', $from));
    }
}
