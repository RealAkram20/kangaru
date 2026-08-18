<?php

namespace Modules\Drivers\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Modules\Drivers\Models\DriverLedgerEntry;

/**
 * One row of a driver's wallet statement (ADR-0029).
 *
 * @mixin DriverLedgerEntry
 */
class DriverLedgerEntryResource extends JsonResource
{
    /**
     * @param  DriverLedgerEntry  $resource
     * @param  array<int, string>  $serviceTypes  trip id => `ride` | `delivery` | `self_drive`
     */
    public function __construct(
        $resource,
        private readonly array $serviceTypes = [],
    ) {
        parent::__construct($resource);
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'kind' => $this->kind->value,
            // The enum's own words, served rather than re-spelled in the app.
            // `LedgerEntryKind::label()` already exists and is the one place
            // these are named; a second vocabulary in the handset would drift
            // from it the first time a kind was renamed.
            'kind_label' => $this->kind->label(),
            // **Signed, and the sign is the whole meaning.** Positive means
            // the platform owes the driver, negative means the driver owes
            // the platform (ADR-0029 §2). A client that took the magnitude
            // and inferred direction from `kind` would get `settlement`
            // wrong, which is the one kind that legitimately runs both ways.
            'amount_minor' => (int) $this->amount_minor,
            'currency' => $this->currency,
            // Server-written prose, and it is load-bearing rather than
            // decorative: ADR-0029 §3 records the commission rate in force at
            // completion *in this string*, which is what lets a driver read
            // an old row and see the rate that actually applied to it.
            'description' => $this->description,
            'trip_id' => $this->trip_id,
            // What kind of job produced it — `ride`, `delivery`, `self_drive`
            // — so the statement can say "Ride earnings" rather than the
            // enum's generic "Fare earned".
            //
            // Null on anything with no trip behind it (a settlement), and on
            // a trip with no order request (a walk-in a dispatcher fulfilled
            // by hand). The app falls back to `kind_label`, which is always
            // true.
            'service_type' => $this->serviceType(),
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }

    /**
     * The service type behind this entry, from a map the controller built.
     *
     * ## Why this is not an eager-loaded relation
     *
     * The obvious `->with('trip.orderRequest')` **returns nothing here**, and
     * silently. `Trip` is `BelongsToTenant`, and `TenantScope` deliberately
     * *fails closed*: with no tenant bound to the request it appends
     * `1 = 0` rather than leaking across tenants. A driver on a walk-in ride
     * has no tenant context — the trip is customer-owned — so the relation
     * resolves to null and every row loses its label with no error anywhere.
     * That is the scope working exactly as designed; it is the wrong tool for
     * this question.
     *
     * So the controller reads `order_requests` through the query builder,
     * unscoped and keyed by trip, exactly as `DriverEarningsService` already
     * does for the same join.
     *
     * **Nothing from `order_requests.details` is touched, and that is the
     * point.** That column carries `sender_phone` and `recipient_phone`,
     * which ADR-0024 §7 withholds, and `Bookings\Support\OrderDetails` is its
     * single allow-listed reader. `service_type` is a real column beside it,
     * not a key inside it — so this never goes near the JSON.
     */
    private function serviceType(): ?string
    {
        $tripId = $this->trip_id;

        if ($tripId === null) {
            return null;
        }

        return $this->serviceTypes[$tripId] ?? null;
    }
}
