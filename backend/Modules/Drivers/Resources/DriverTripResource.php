<?php

namespace Modules\Drivers\Resources;

use Carbon\CarbonInterface;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Modules\Trips\Models\Trip;

/**
 * One row of a driver's own trip history.
 *
 * Deliberately **not** `TripResource`, and the difference is the point. That
 * resource answers "everything the platform knows about this trip" for a
 * console that may be a dispatcher, a client or the driver; this answers the
 * six things one row of a scrollable history needs, for the one person whose
 * token it is. Three consequences follow:
 *
 * - **No passenger contact, ever.** ADR-0024 §7 releases a name and number to
 *   the driver only while a trip is live, and a history is the opposite of
 *   live — a permanent, scrollable list of everyone a driver has carried is
 *   precisely the directory that rule exists to prevent. `TripResource` gates
 *   the field on the caller being the driver, which is true here; the field
 *   is simply absent instead.
 * - **No fare quote.** `TripResource::estimatedFare()` costs queries through
 *   Billing per row, which is why it is bounded to `show()`. A history page is
 *   twenty-five rows.
 * - **The money is the driver's own share**, not the gross. See `earned_minor`.
 *
 * @mixin Trip
 */
class DriverTripResource extends JsonResource
{
    /**
     * @param  Trip  $resource
     * @param  array<int, string>  $serviceTypes  trip id => `ride` | `delivery` | `self_drive`
     * @param  array<int, array{amount_minor: int, currency: string}>  $earnings  trip id => the driver's share
     * @param  string  $timezone  the fleet's zone, for the local day and time keys
     */
    public function __construct(
        $resource,
        private readonly array $serviceTypes,
        private readonly array $earnings,
        private readonly string $timezone,
    ) {
        parent::__construct($resource);
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $happenedAt = $this->happenedAt();
        $local = $happenedAt->setTimezone($this->timezone);
        $earned = $this->earnings[(int) $this->id] ?? null;

        return [
            'id' => $this->id,
            // The raw value, not a label. `statusLabel()` in the driver app
            // already names every status and is the one place they are
            // spelled for a driver; serving a second wording here would give
            // the app two vocabularies for one fact.
            'status' => $this->status->value,
            // `ride`, `delivery`, `self_drive`, or null when the trip has no
            // order request behind it — a walk-in a dispatcher fulfilled by
            // hand. Null renders as a plain "Trip" rather than as a guess.
            'service_type' => $this->serviceTypes[(int) $this->id] ?? null,
            'origin' => $this->origin,
            'destination' => $this->destination,
            'happened_at' => $happenedAt->toIso8601String(),
            /*
             * The day and time this row is filed under, **already resolved in
             * the fleet's timezone**.
             *
             * Computed here rather than on the handset, and that is not
             * convenience. `config/app.php` is UTC, so a Kampala day computed
             * from a raw instant rolls over at 03:00 local — the bug the
             * earnings work found and fixed in two places. On a screen whose
             * headings are literally "Today" and "Yesterday", that puts an
             * evening's trips under the wrong heading, and does it plausibly
             * enough that nobody reports it.
             *
             * Hermes' `Intl` support also varies by platform and build (see
             * `wallet/presentation.ts`), so the same trip could file under
             * different days on two handsets in one fleet.
             */
            'local_day' => $local->format('Y-m-d'),
            'local_time' => $local->format('H:i'),
            /*
             * **What the driver earned, not what the passenger paid.**
             *
             * Read back from the `fare_earned` ledger entry that ADR-0029 §3
             * wrote at completion, so the rate in force *then* is what shows
             * years later. Never recomputed from
             * `billing.driver_commission_percent`, which is a runtime setting
             * that would silently restate old work.
             *
             * The deciding argument for this field over the gross fare was
             * reconciliation: a driver adding this list up must land on the
             * same figure `/me/earnings` shows them, and that endpoint totals
             * `fare_earned`. Two screens about one driver's pay disagreeing is
             * the worst defect either can carry.
             *
             * **Null, never zero**, on a cancelled or no-show trip, on a
             * corporate trip (invoiced to the client — there is no per-trip
             * driver share), and in the window between completion and the
             * ledger listener running. `UGX 0` would read as an unpaid job.
             */
            'earned_minor' => $earned['amount_minor'] ?? null,
            'currency' => $earned['currency'] ?? null,
        ];
    }

    /**
     * When this trip is filed under.
     *
     * `completed_at` where there is one, and `created_at` otherwise — which
     * is the cancelled and no-show case. **Not `updated_at`**, deliberately:
     * that column moves whenever anything touches the row, so a trip could
     * quietly migrate from one day heading to another months later, and a
     * history that reorders itself is not a history.
     */
    private function happenedAt(): CarbonInterface
    {
        /** @var Trip $trip */
        $trip = $this->resource;

        return $trip->completed_at ?? $trip->created_at ?? now();
    }
}
