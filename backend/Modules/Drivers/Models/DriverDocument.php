<?php

namespace Modules\Drivers\Models;

use App\Concerns\Auditable;
use App\Models\User;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;
use Modules\Drivers\Contracts\HoldsDocuments;
use Modules\Drivers\Enums\DriverDocumentStatus;
use Modules\Drivers\Enums\DriverDocumentType;

/**
 * One of a driver's papers, and what the office made of it (ADR-0033).
 *
 * `Auditable` because verifying a licence is a compliance act somebody may
 * later be asked to account for — who looked, when, and from which IP. It is
 * the second surface on this platform where a staff decision changes what a
 * driver may do (ADR-0032 was the first) and the first concerning a legal
 * document.
 *
 * **This model gates nothing.** ADR-0033 §6 keeps enforcement out of scope on
 * purpose; `complianceState()` below is the seam a future rule consults, so
 * that there is never a second notion of "is this driver compliant".
 *
 * @property int $id
 * @property int|null $driver_id
 * @property int|null $driver_application_id
 * @property DriverDocumentType $type
 * @property DriverDocumentStatus $status
 * @property string $file_path
 * @property bool $encrypted
 * @property string|null $original_name
 * @property string $mime_type
 * @property int $size_bytes
 * @property CarbonInterface|null $expires_at
 * @property CarbonInterface $uploaded_at
 * @property int|null $reviewed_by_user_id
 * @property CarbonInterface|null $reviewed_at
 * @property string|null $rejection_reason
 * @property CarbonInterface $created_at
 * @property CarbonInterface $updated_at
 * @property-read Driver|null $driver
 * @property-read DriverApplication|null $driverApplication
 * @property-read User|null $reviewedBy
 */
class DriverDocument extends Model
{
    use Auditable;

    protected $fillable = [
        /**
         * **Exactly one of these two is set. Never both, never neither**
         * (ADR-0048 §3).
         *
         * A row belongs to a driver, or to an applicant who has not been
         * approved yet. The database cannot express "exactly one of"
         * portably, so `owner()` below and `DriverDocumentService` are where
         * the invariant is actually kept — which is why it is written here
         * where somebody adding a third writer will read it.
         */
        'driver_id',
        'driver_application_id',
        'type',
        'status',
        'file_path',
        'encrypted',
        'original_name',
        'mime_type',
        'size_bytes',
        'expires_at',
        'uploaded_at',
        'reviewed_by_user_id',
        'reviewed_at',
        'rejection_reason',
    ];

    /**
     * Never serialised, by the model rather than by every resource that
     * touches it. `file_path` addresses a private disk holding somebody's
     * national ID, and a resource that forgot to omit it would publish the
     * key to it — the same reasoning `DriverApplication` applies to its
     * password column.
     *
     * @var list<string>
     */
    protected $hidden = ['file_path'];

    protected function casts(): array
    {
        return [
            'type' => DriverDocumentType::class,
            'status' => DriverDocumentStatus::class,
            'size_bytes' => 'integer',
            'encrypted' => 'boolean',
            // A date, not a datetime: a licence expires on a day, and midnight
            // in the app's UTC is 03:00 in Kampala.
            'expires_at' => 'date',
            'uploaded_at' => 'datetime',
            'reviewed_at' => 'datetime',
        ];
    }

    /** @return BelongsTo<Driver, $this> */
    public function driver(): BelongsTo
    {
        return $this->belongsTo(Driver::class);
    }

    /**
     * The applicant this belongs to, while it belongs to an applicant.
     *
     * Null for every document on an approved driver: approval re-points the
     * row and clears this (ADR-0048 §5), so a non-null value here always
     * means "nobody has been approved for this yet".
     *
     * @return BelongsTo<DriverApplication, $this>
     */
    public function driverApplication(): BelongsTo
    {
        return $this->belongsTo(DriverApplication::class);
    }

    /** @return BelongsTo<User, $this> */
    public function reviewedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reviewed_by_user_id');
    }

    /**
     * The thing this document is filed against — a driver, or an applicant.
     *
     * Returns null only if the invariant above has been broken, which is a
     * state no writer in this module can produce. Callers that need a
     * directory or an audit subject go through here rather than testing
     * `driver_id` for null and guessing at the other case.
     */
    public function owner(): ?HoldsDocuments
    {
        return $this->driver ?? $this->driverApplication;
    }

    /**
     * Still waiting on somebody in the office.
     *
     * @param  Builder<DriverDocument>  $query
     * @return Builder<DriverDocument>
     */
    public function scopeOpen(Builder $query): Builder
    {
        return $query->where('status', DriverDocumentStatus::PENDING->value);
    }

    /**
     * Whether the document's own date has passed, in the operator's timezone.
     *
     * Derived, never stored — ADR-0033 §3. The timezone is passed in rather
     * than read here so that a list of documents makes one settings lookup
     * instead of one per row, and so this stays a pure comparison.
     *
     * `startOfDay` on both sides: a licence expiring *today* is valid today.
     * Comparing a date column against `now()` would expire it at midnight and
     * make the last day of a licence a day the driver could not work.
     */
    public function hasExpired(string $timezone): bool
    {
        if ($this->expires_at === null) {
            return false;
        }

        return $this->expires_at->startOfDay()->lt(Carbon::now($timezone)->startOfDay());
    }

    /**
     * The one state anything outside this module should read.
     *
     * Four values, and the fourth is the derived one: `pending`, `verified`,
     * `rejected`, `expired`. **Expiry outranks verification** — a verified
     * licence that lapsed last month is not a verified licence, and reporting
     * it as one is the exact lie ADR-0033 exists to stop.
     */
    public function complianceState(string $timezone): string
    {
        if ($this->status === DriverDocumentStatus::VERIFIED && $this->hasExpired($timezone)) {
            return 'expired';
        }

        return $this->status->value;
    }
}
