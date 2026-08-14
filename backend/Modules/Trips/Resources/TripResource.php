<?php

namespace Modules\Trips\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Modules\Billing\Pricing\RateCardNotConfiguredException;
use Modules\Billing\Services\WalkInFareService;
use Modules\Bookings\Models\OrderRequest;
use Modules\Bookings\Support\OrderDetails;
use Modules\Drivers\Resources\DriverResource;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Trips\Support\ContactChannel;
use Modules\Vehicles\Resources\VehicleResource;

/**
 * @mixin Trip
 */
class TripResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            // Null on a walk-in trip (ADR-0024 §1), where `customer_id`
            // carries the ownership instead. Exactly one of the pair is ever
            // set, so a client can branch on either without asking both.
            'tenant_id' => $this->tenant_id,
            'customer_id' => $this->customer_id,
            // Which client this trip is for, by name. See BookingResource
            // for the reasoning — same rule, same ADR-0006 queue, and a
            // trips list opened by platform staff spans clients too.
            'client' => $this->whenLoaded('tenant', function () {
                // See BookingResource — same shape, same reason for the
                // local and the null branch.
                $client = $this->tenant;

                return $client === null ? null : ['id' => $client->id, 'name' => $client->name];
            }),
            // Null on an ad-hoc trip raised without a booking.
            'booking_id' => $this->booking_id,
            'vehicle_id' => $this->vehicle_id,
            'vehicle' => new VehicleResource($this->whenLoaded('vehicle')),
            'driver_id' => $this->driver_id,
            'driver' => new DriverResource($this->whenLoaded('driver')),
            'origin' => $this->origin,
            'destination' => $this->destination,
            // The same two places again, with coordinates where the platform
            // has them. `origin`/`destination` stay exactly as they were —
            // AGENTS.md allows additive changes but no removals, and every
            // client already reads them.
            'pickup' => $this->place(
                $this->origin,
                $this->order()?->pickup_latitude,
                $this->order()?->pickup_longitude,
            ),
            'dropoff' => $this->place(
                $this->destination,
                $this->order()?->dropoff_latitude,
                $this->order()?->dropoff_longitude,
            ),
            'status' => $this->status->value,
            // Served so the UI never has to carry its own copy of the
            // transition graph. TripStatus stays the single source of
            // truth (AGENTS.md: "Allowed transitions are defined in one
            // place"), and a client that duplicated the map would drift
            // from it the first time the lifecycle changed.
            //
            // This is what is *legal from this state*, not what this user
            // may do — TripPolicy still authorises each attempt.
            'allowed_transitions' => array_map(
                fn (TripStatus $status) => $status->value,
                $this->status->allowedTransitions(),
            ),
            // What the driver app's waiting ring fills against, in seconds
            // — served for the same reason `allowed_transitions` above is,
            // and `presence_heartbeat_seconds` before it: a number the app
            // hardcoded is a number that needs a store release to argue
            // with, on handsets nobody can reach.
            //
            // **Not a deadline, and nothing expires when it elapses.** See
            // `config/dispatch.php` — no waiting charge, no `no_show`, no
            // sweep. The app fills the ring to full and holds it there.
            'pickup_wait_target_seconds' => (int) config('dispatch.pickup_wait_target_seconds'),
            'odometer_start' => $this->odometer_start,
            'odometer_start_photo_path' => $this->odometer_start_photo_path,
            'odometer_end' => $this->odometer_end,
            'odometer_end_photo_path' => $this->odometer_end_photo_path,
            // Where to fetch the dashboard photos, rather than leaving a
            // client to build the path itself. Null when none was captured,
            // so "is there a photo" is one field rather than a string test.
            //
            // The `_path` fields above are kept alongside these: AGENTS.md
            // allows additive changes within a version but not removals, and
            // dropping them would break any client already reading them.
            'odometer_start_photo_url' => $this->odometer_start_photo_path === null
                ? null
                : route('trips.odometer-photo.show', ['trip' => $this->id, 'moment' => 'start']),
            'odometer_end_photo_url' => $this->odometer_end_photo_path === null
                ? null
                : route('trips.odometer-photo.show', ['trip' => $this->id, 'moment' => 'end']),
            'distance_km' => $this->distance_km,
            'gps_distance_km' => $this->gps_distance_km,
            'distance_variance_flagged' => $this->distance_variance_flagged,
            'cancellation_charge_applicable' => $this->cancellation_charge_applicable,
            'started_at' => $this->started_at,
            'completed_at' => $this->completed_at,
            // Bank acceptance criterion #6. Served explicitly rather than
            // left for each client to re-derive from the two timestamps.
            'duration_minutes' => $this->durationMinutes(),
            // What was actually charged, once anybody drove it (ADR-0026
            // §2). Null until `WalkInFareService::settle()` runs at
            // completion, and null forever on a corporate trip — a client's
            // work is invoiced, and there is no per-trip cash fare to show.
            'fare' => $this->settledFare(),
            // What it is *expected* to fetch, before that. A quote and a
            // settlement are different things and they are different fields
            // for that reason — see `estimatedFare()`.
            'estimated_fare' => $this->estimatedFare(),
            // How this job settles, for the driver who is carrying it.
            //
            // The same fact `DispatchOfferResource` puts on the offer card,
            // served again here because an offer is answered in fifteen
            // seconds and the drop-off can be an hour later: a driver who has
            // forgotten whether this one is cash should not have to remember.
            // A driver carrying no float needs it before they arrive, not at
            // the kerb.
            'payment' => $this->paymentFor(),
            // Who to ring, if anybody (ADR-0024 §7). Null far more often
            // than not — see below.
            'passenger_contact' => $this->passengerContactFor($request),
            'created_at' => $this->created_at,
            'updated_at' => $this->updated_at,
        ];
    }

    /**
     * The passenger's number, for the driver on this trip and nobody else.
     *
     * Three gates, and only the third is in this method:
     *
     * - **`ContactChannel` decides whether the trip is one where the parties
     *   may speak at all** — walk-in only, and only from `accepted` to
     *   `trip_completed`. That policy lives in one class because the
     *   customer's ride payload asks the same question, and a rule split
     *   across two resources is a rule applied to one and a half of them.
     * - **This method decides whether the *caller* is the driver.** A
     *   dispatcher listing trips holds `trips.view.all` and can already see
     *   the whole board; that does not make a passenger's mobile number part
     *   of a list view. It is served to the one person who needs to ring
     *   the passenger to find them at a busy pickup.
     * - The customer guard never reaches this resource at all.
     *
     * Note it is keyed off `driver->user_id`, the same ownership test
     * `TripPolicy::transition` uses. That relation is loaded on every path
     * that serves this resource; where it is not, `?->` yields null and the
     * field is withheld — which fails closed, and is the right direction for
     * a field like this one to fail in.
     *
     * @return array<string, string>|null
     */
    private function passengerContactFor(Request $request): ?array
    {
        $user = $request->user();

        if ($user === null || $this->driver?->user_id !== $user->id) {
            return null;
        }

        /** @var Trip $trip */
        $trip = $this->resource;

        return app(ContactChannel::class)->forPassenger($trip)?->toArray();
    }

    /**
     * One end of the journey, in prose and — where the platform has it — in
     * coordinates.
     *
     * The label always exists, because `trips.origin` is not nullable. The
     * coordinates come from the walk-in order behind the trip and are null
     * on every corporate trip, on any order a dispatcher keyed in over the
     * phone, and whenever the relation was not loaded.
     *
     * **A null pair renders as no map, never as a map centred on 0°,0°.**
     * That point is in the Atlantic off Ghana, which is also where a
     * latitude/longitude swap lands a Kampala vehicle — see `Coordinates` in
     * the driver app, and ADR-0020, which records this codebase hitting that
     * swap for real.
     *
     * @return array{label: string, latitude: float|null, longitude: float|null}
     */
    private function place(string $label, ?float $latitude, ?float $longitude): array
    {
        // Both or neither. A half-resolved position is worse than none: one
        // coordinate with the other missing is not a place, and a client that
        // defaulted the absent half to zero would draw the vehicle in the
        // Atlantic — the same failure ADR-0020 records this codebase hitting
        // through a latitude/longitude swap.
        $located = $latitude !== null && $longitude !== null;

        return [
            'label' => $label,
            'latitude' => $located ? $latitude : null,
            'longitude' => $located ? $longitude : null,
        ];
    }

    /**
     * How this job settles — the method, and which end pays.
     *
     * Read through `OrderDetails`, which is the **one** reader of
     * `order_requests.details` in this codebase. That column also carries
     * `sender_phone` and `recipient_phone`, so a resource that emitted it
     * wholesale would leak two personal numbers ADR-0024 §7 withholds, and
     * would look entirely innocent in review under a field called `details`.
     * The allow-list is why this is three lines rather than a spread.
     *
     * **Null means "this trip has no walk-in order behind it", and that is a
     * real answer rather than a gap.** A corporate trip is invoiced to the
     * client under ADR-0024 §7's closing paragraph — there is no per-trip
     * settlement for a driver to collect, so a payment row on one would be
     * inventing a transaction.
     *
     * It is also null wherever `orderRequest` was not eager-loaded, which is
     * every list endpoint — the same bound `estimated_fare` carries and for
     * the same reason. The driver app reads this only on `show`.
     *
     * Note the shape differs from `DispatchOfferResource::payment()`, which
     * always returns an object with possibly-null members. An offer always has
     * an order behind it; a trip may genuinely not, and collapsing those two
     * cases into "an object full of nulls" would tell a driver on a corporate
     * job that nobody had said how it settles.
     *
     * @return array<string, string|null>|null
     */
    private function paymentFor(): ?array
    {
        $order = $this->order();

        if ($order === null) {
            return null;
        }

        return OrderDetails::allowed($order, OrderDetails::PAYMENT_FIELDS);
    }

    /** The walk-in order behind this trip, only if it was eager-loaded. */
    private function order(): ?OrderRequest
    {
        return $this->relationLoaded('orderRequest') ? $this->orderRequest : null;
    }

    /**
     * The fare that was actually charged, or null.
     *
     * Carries the version that priced it, because ADR-0026 and AGENTS.md's
     * money rules both turn on a figure being re-derivable years later: a
     * total with no rate card behind it is a number nobody can defend when
     * somebody disputes it.
     *
     * @return array<string, mixed>|null
     */
    private function settledFare(): ?array
    {
        if ($this->fare_minor === null) {
            return null;
        }

        return [
            'total_minor' => $this->fare_minor,
            'currency' => $this->fare_currency,
            'rate_card_version_id' => $this->fare_rate_card_version_id,
            'computed_at' => $this->fare_computed_at?->toIso8601String(),
            // The counterpart of `WalkInFareEstimate::is_estimate`, and it
            // travels for the same reason: a client must not have to infer
            // which of the two figures it is holding from which key it
            // arrived under.
            'is_estimate' => false,
        ];
    }

    /**
     * What the trip is expected to fetch, before it is settled.
     *
     * The same quote `DispatchOfferResource` puts on the offer card, served
     * again here so the driver on the way to a pickup sees the figure they
     * accepted the job on — not a blank where a fare will eventually be.
     *
     * **Null unless `orderRequest` is loaded, and that is a deliberate
     * bound, not an oversight.** `WalkInFareService::quote()` costs two or
     * three queries through `RateCardResolver`, and `TripResource` also
     * renders list endpoints — a dispatch board of fifty trips would pay
     * fifty quotes for a figure nobody is reading there. So the controller
     * eager-loads the relation on `show` and not on `index`, and the field
     * follows. If a list ever genuinely needs it, the fix is to memoise the
     * tariff version per request inside Billing, not to drop this guard.
     *
     * Null too once the trip is settled: at that point `fare` holds the real
     * figure, and serving both would invite a screen to show an estimate
     * beside a bill.
     *
     * `RateCardNotConfiguredException` is caught rather than propagated for
     * the reason `DispatchOfferResource` gives — an unpriced category must
     * cost this trip a figure, not the whole request a 500. The loud failure
     * ADR-0026 wants belongs in `settle()`, where money changes hands.
     *
     * @return array<string, mixed>|null
     */
    private function estimatedFare(): ?array
    {
        if ($this->fare_minor !== null) {
            return null;
        }

        $order = $this->order();
        $category = $this->vehicle?->category;

        if ($order === null || ! is_string($category)) {
            return null;
        }

        try {
            return app(WalkInFareService::class)->quote(
                $category,
                $order->pickup_latitude,
                $order->pickup_longitude,
                $order->dropoff_latitude,
                $order->dropoff_longitude,
            )?->toArray();
        } catch (RateCardNotConfiguredException) {
            return null;
        }
    }
}
