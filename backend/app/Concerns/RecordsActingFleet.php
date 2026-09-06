<?php

namespace App\Concerns;

use App\Models\Operator;
use App\Support\Access\AccessContext;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Stamps the fleet that did the work, and nothing else (ADR-0055).
 *
 * The smaller half of `BelongsToOperator`, split out for a reason PHP forces
 * rather than a reason of taste: `BelongsToOperator` also defines
 * `scopeForActor()`, and so does `BelongsToTenant`. A model using both would
 * be a fatal trait collision, and `trips`, `bookings`, `invoices` and
 * `credit_notes` are all tenant-scoped already.
 *
 * The two questions are genuinely different anyway. On a driver or a vehicle
 * the fleet answers *who owns this*. On a trip it answers **who ran it** — a
 * fact about the work, recorded once and never used to decide what anybody may
 * read. Reading a trip is still `BelongsToTenant`'s job, because a trip's
 * confidential half belongs to the client (ADR-0005), and F2 is where the fleet
 * axis starts filtering it.
 *
 * ## Why this exists at all before anything reads the column
 *
 * F0 added `operator_id` to these tables and backfilled it, deliberately ahead
 * of any code that fills it in, because the backfill is only trivial while
 * every row is Shanitah's. That left a gap: **rows created since F0 carry
 * null**, so the column was true of history and silently wrong about the
 * present.
 *
 * Invoice numbering is the first thing that needs the answer — a counter keyed
 * on a fleet cannot be keyed on a null — and it is the thing that made the gap
 * visible. `operator_id` on `document_number_sequences` is NOT NULL precisely
 * so it cannot be papered over.
 *
 * @property int|null $operator_id
 */
trait RecordsActingFleet
{
    public static function bootRecordsActingFleet(): void
    {
        static::creating(function ($model): void {
            if ($model->operator_id === null) {
                $model->operator_id = app(AccessContext::class)->operatorId();
            }
        });
    }

    /**
     * The fleet that ran this. Null on a walk-in nobody has accepted yet —
     * Kangaru's, unclaimed (ADR-0055 §7) — which is why the column stays
     * nullable on `trips` and `bookings` where it is NOT NULL elsewhere.
     *
     * @return BelongsTo<Operator, $this>
     */
    public function operator(): BelongsTo
    {
        return $this->belongsTo(Operator::class);
    }
}
