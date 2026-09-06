<?php

namespace Modules\Drivers\Models;

use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One week's target bonus, awarded (ADR-0034 §4, §5).
 *
 * **This model exists to make double-payment impossible**, not to be read.
 * The money itself is a `bonus` entry in `driver_ledger_entries` like every
 * other credit; what the ledger cannot answer on its own is *"has this driver
 * already been paid for the week of 10 August?"* — its rows carry a
 * description and a timestamp, and matching on either is a guard that works
 * until somebody rewords the sentence.
 *
 * The unique index on `(driver_id, week_start)` makes a second award an
 * integrity error rather than a silent second payment, which matters because
 * the awarding command genuinely can fire twice: a cron overlapping a deploy,
 * a manual re-run after a failure, two app servers sharing a schedule.
 *
 * It also freezes what the rule saw. `trip_target` and `amount_minor` are
 * admin-settable, so an award explained only by "the current target" is one
 * nobody can defend a year later — ADR-0029 §3's rule about writing the
 * commission rate into an entry, applied to a second kind of rate.
 *
 * @property int $id
 * @property int $driver_id
 * @property CarbonInterface $week_start The Monday, in the fleet's timezone.
 * @property int $trips_completed
 * @property int $trip_target
 * @property int $amount_minor
 * @property string $currency
 * @property int|null $ledger_entry_id
 * @property-read Driver|null $driver
 */
class DriverWeeklyBonus extends Model
{
    protected $fillable = [
        'driver_id',
        'week_start',
        'trips_completed',
        'trip_target',
        'amount_minor',
        'currency',
        'ledger_entry_id',
    ];

    protected function casts(): array
    {
        return [
            // A date, never a timestamp. `settings.regional.timezone` decides
            // where a week begins, and storing an instant would make the same
            // Kampala week key differently depending on the server's clock —
            // `config/app.php` is UTC.
            'week_start' => 'date',
            'trips_completed' => 'integer',
            'trip_target' => 'integer',
            'amount_minor' => 'integer',
        ];
    }

    /** @return BelongsTo<Driver, $this> */
    public function driver(): BelongsTo
    {
        return $this->belongsTo(Driver::class);
    }
}
