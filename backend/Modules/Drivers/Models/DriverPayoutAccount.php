<?php

namespace Modules\Drivers\Models;

use App\Concerns\Auditable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Modules\Drivers\Enums\PayoutAccountKind;

/**
 * Where a driver's money is sent (ADR-0042).
 *
 * **Not a balance and not an instruction.** Storing a destination changes
 * nothing about whether somebody is paid; ADR-0032's request-and-confirm flow
 * is still the only thing that writes a ledger entry.
 *
 * `Auditable`, and that matters more here than on most models: a changed
 * account number is the single most valuable edit an attacker could make to a
 * driver's record, and the log is what makes "the money went somewhere else
 * last month" answerable rather than arguable.
 *
 * @property int $id
 * @property int $driver_id
 * @property PayoutAccountKind $kind
 * @property string $institution
 * @property string $account_number decrypted on read by the cast
 * @property string $account_holder decrypted on read by the cast
 * @property string $last_four
 */
class DriverPayoutAccount extends Model
{
    use Auditable;

    protected $fillable = [
        'driver_id',
        'kind',
        'institution',
        'account_number',
        'account_holder',
    ];

    /**
     * `last_four` is **not fillable**, deliberately.
     *
     * It is derived from `account_number` and written by the boot hook below.
     * A caller able to set it could store a tail that does not belong to the
     * number it claims to summarise — and the tail is the only part the driver
     * ever sees to check, so a wrong one is a silent lie on the one screen
     * built to catch a mistake.
     */
    protected static function booted(): void
    {
        static::saving(function (self $account): void {
            $account->last_four = self::tailOf($account->account_number);
        });
    }

    protected function casts(): array
    {
        return [
            'kind' => PayoutAccountKind::class,
            /*
             * ADR-0042 §3. The same treatment `users.mfa_secret` gets, and for
             * a stronger reason: unlike a trip history, a bank account number
             * and an account holder's name have value to somebody who never
             * touches this app.
             *
             * The consequence is accepted and stated in the ADR — an encrypted
             * column cannot be indexed or searched. Nothing needs to; a
             * destination is only ever read by `driver_id`.
             */
            'account_number' => 'encrypted',
            'account_holder' => 'encrypted',
        ];
    }

    /**
     * @return BelongsTo<Driver, $this>
     */
    public function driver(): BelongsTo
    {
        return $this->belongsTo(Driver::class);
    }

    /**
     * The number as the driver is allowed to see it — a mask and the tail.
     *
     * Public and on the model rather than in the resource, because the office
     * resource needs the *whole* number and the driver's needs this: two
     * readers, one rule about what the masked form looks like, and no chance of
     * them drifting into two different masks for one account.
     */
    public function maskedNumber(): string
    {
        return '•••• '.$this->last_four;
    }

    /**
     * The last four characters of a number, or fewer if it is shorter.
     *
     * Takes characters, not digits: a mobile-money number may be stored with a
     * `+256` prefix and spaces, and stripping to digits here would produce a
     * tail that does not match what the driver typed and is checking against.
     */
    public static function tailOf(string $number): string
    {
        return mb_substr($number, -4);
    }
}
