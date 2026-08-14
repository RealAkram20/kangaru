<?php

namespace Modules\Drivers\Models;

use App\Concerns\Auditable;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;
use Modules\Drivers\Enums\DriverApplicationStatus;

/**
 * A rider asking to drive for KangaruRide (ADR-0027).
 *
 * Not an account and not a driver. Until somebody approves it this row is
 * the applicant's entire footprint on the platform — no login, no profile,
 * nothing any policy consults.
 *
 * `Auditable`, because approving one mints a principal and rejecting one
 * ends somebody's application; both are decisions the office may later be
 * asked to account for.
 *
 * @property int $id
 * @property string $name
 * @property string $phone
 * @property string $email
 * @property string|null $password
 * @property DriverApplicationStatus $status
 * @property Carbon $terms_accepted_at
 * @property int|null $reviewed_by_user_id
 * @property Carbon|null $reviewed_at
 * @property string|null $rejection_reason
 * @property int|null $driver_id
 */
class DriverApplication extends Model
{
    use Auditable;

    protected $fillable = [
        'name',
        'phone',
        'email',
        'password',
        'status',
        'terms_accepted_at',
        'reviewed_by_user_id',
        'reviewed_at',
        'rejection_reason',
        'driver_id',
    ];

    /**
     * Never serialised, by the model rather than by every resource that
     * touches it. A `DriverApplicationResource` that forgot to omit it
     * would publish a live bcrypt hash to the console.
     */
    protected $hidden = ['password'];

    protected function casts(): array
    {
        return [
            'status' => DriverApplicationStatus::class,
            'terms_accepted_at' => 'datetime',
            'reviewed_at' => 'datetime',
            // Deliberately NOT `hashed`.
            //
            // This column is written once, from a plaintext the applicant
            // typed, and read once, to be handed to `User` — whose own
            // `hashed` cast passes an existing bcrypt string through
            // untouched (`Hash::isHashed`). A `hashed` cast here as well
            // would be harmless on write and confusing on read, since the
            // value leaving this model is already a hash and must stay one.
        ];
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function reviewedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reviewed_by_user_id');
    }

    /**
     * The profile created when this was approved, if it was.
     *
     * @return BelongsTo<Driver, $this>
     */
    public function driver(): BelongsTo
    {
        return $this->belongsTo(Driver::class);
    }
}
