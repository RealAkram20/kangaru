<?php

namespace Modules\Fleet\Models;

use App\Concerns\Auditable;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Modules\Drivers\Models\Driver;

/**
 * One weekly working window for one driver (ADR-0017 §3).
 *
 * @property int $driver_id
 * @property int $weekday 0 = Sunday … 6 = Saturday, matching Carbon
 * @property string $starts_at local wall-clock time, "HH:MM:SS"
 * @property string $ends_at may be < starts_at, meaning it runs past midnight
 */
class DriverShiftWindow extends Model
{
    use Auditable;

    protected $fillable = ['driver_id', 'weekday', 'starts_at', 'ends_at'];

    protected function casts(): array
    {
        return ['weekday' => 'integer'];
    }

    /**
     * @return BelongsTo<Driver, $this>
     */
    public function driver(): BelongsTo
    {
        return $this->belongsTo(Driver::class);
    }

    /**
     * Whether this window covers `$moment`.
     *
     * The overnight case is the one worth reading twice. A window of
     * 18:00→06:00 does not describe an empty set; it describes a night
     * shift, and it covers both the late hours of its own weekday and the
     * early hours of the next. So a Friday 18:00→06:00 window has to answer
     * true for Saturday at 01:00 — checked by asking whether the *previous*
     * day's window has wrapped into this moment.
     */
    public function covers(CarbonInterface $moment, string $timezone): bool
    {
        $local = CarbonImmutable::parse($moment)->setTimezone($timezone);
        $minutes = $local->hour * 60 + $local->minute;

        $start = $this->minutesOf($this->starts_at);
        $end = $this->minutesOf($this->ends_at);

        if ($start < $end) {
            return $local->dayOfWeek === $this->weekday && $minutes >= $start && $minutes < $end;
        }

        // Wraps midnight. Either we are in the tail of this weekday…
        if ($local->dayOfWeek === $this->weekday && $minutes >= $start) {
            return true;
        }

        // …or in the small hours of the day after it.
        return $local->dayOfWeek === ($this->weekday + 1) % 7 && $minutes < $end;
    }

    private function minutesOf(string $time): int
    {
        [$hours, $minutes] = array_map('intval', explode(':', $time));

        return $hours * 60 + $minutes;
    }
}
