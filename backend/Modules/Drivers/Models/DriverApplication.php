<?php

namespace Modules\Drivers\Models;

use App\Concerns\Auditable;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;
use Modules\Drivers\Contracts\HoldsDocuments;
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
 * @property int|null $user_id
 * @property int|null $reviewed_by_user_id
 * @property Carbon|null $reviewed_at
 * @property string|null $rejection_reason
 * @property int|null $driver_id
 * @property string|null $referral_code
 * @property string|null $upload_token_hash SHA-256 of the claim ticket (ADR-0048 §4).
 * @property Carbon|null $upload_token_expires_at
 */
class DriverApplication extends Model implements HoldsDocuments
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
        // What the applicant typed, unresolved (ADR-0037 §5). Checked at
        // approval, never at submission — see `StoreDriverApplicationRequest`.
        'referral_code',
        /**
         * The claim ticket an applicant uploads documents with (ADR-0048 §4).
         *
         * Fillable because `DriverApplicationService` mints it in the same
         * `create()` as the rest of the row; `$hidden` below is what keeps it
         * off every response, the same guard the password gets.
         */
        'upload_token_hash',
        'upload_token_expires_at',
    ];

    /**
     * Never serialised, by the model rather than by every resource that
     * touches it. A `DriverApplicationResource` that forgot to omit it
     * would publish a live bcrypt hash to the console.
     */
    protected $hidden = ['password', 'upload_token_hash'];

    protected function casts(): array
    {
        return [
            'status' => DriverApplicationStatus::class,
            'terms_accepted_at' => 'datetime',
            'reviewed_at' => 'datetime',
            'upload_token_expires_at' => 'datetime',
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
     * Where an applicant's uploads live until somebody decides about them.
     *
     * A sibling of `drivers/`, not a child of it, because nothing here is a
     * driver yet and a directory that says otherwise would be the first place
     * somebody looks for a fleet member who does not exist.
     *
     * **Approval does not move these files** (ADR-0048 §5). The row is
     * re-pointed at the new driver and the path stays, so an approved
     * driver's earliest documents live under `driver-applications/` forever.
     * That is deliberate: re-pointing a row is atomic, moving bytes across a
     * disk is not, and a half-moved document is a licence the office cannot
     * open. The path is an opaque key, never shown to anybody.
     */
    public function documentDirectory(): string
    {
        return sprintf('driver-applications/%d/documents', $this->getKey());
    }

    public function documentOwnerLabel(): string
    {
        return sprintf('driver application %d', $this->getKey());
    }

    /**
     * The documents uploaded with this application, if any.
     *
     * @return HasMany<DriverDocument, $this>
     */
    public function documents(): HasMany
    {
        return $this->hasMany(DriverDocument::class);
    }

    /**
     * Whether the claim ticket is still good.
     *
     * Both halves matter and both are checked here rather than at the call
     * site: a hash with no expiry is a ticket that never dies, and an expiry
     * with no hash is a row whose ticket was already spent at a decision.
     */
    public function acceptsUploads(): bool
    {
        return $this->upload_token_hash !== null
            && $this->upload_token_expires_at !== null
            && $this->upload_token_expires_at->isFuture();
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function reviewedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reviewed_by_user_id');
    }

    /**
     * The sign-in this application minted, if it minted one.
     *
     * **Deliberately not `$fillable`.** It is written by
     * `DriverApplicationService` with `forceFill`, and by nothing else: an
     * attribute that decides which account an approval adopts must not be
     * reachable from a request body, however well the form request is
     * validated today.
     *
     * Null is ordinary rather than exceptional. ADR-0027 §5 requires the
     * public endpoint to answer identically whether or not the email is
     * known, so an application on a taken address carries no account and is
     * refused at approval in front of a human — as does every application
     * submitted before accounts moved to submission time.
     *
     * @return BelongsTo<User, $this>
     */
    public function account(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
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
