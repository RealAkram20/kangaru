<?php

namespace Modules\Dispatch\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Modules\Billing\Pricing\RateCardNotConfiguredException;
use Modules\Billing\Services\WalkInFareService;
use Modules\Bookings\Models\OrderRequest;
use Modules\Bookings\Support\OrderDetails;
use Modules\Dispatch\Models\DispatchOffer;
use Modules\Dispatch\Support\GreatCircle;

/**
 * A job as the driver being offered it sees it (ADR-0024 §3).
 *
 * ## What it deliberately omits
 *
 * **The passenger's name and phone number.** ADR-0024 §7 releases those only
 * once the driver has accepted, and this resource is what is rendered
 * *before* they decide. A number handed to a driver who then declines is a
 * number given away for nothing — and this payload is also what a push
 * notification is built from, which puts it on a lock screen readable by
 * whoever is holding the phone.
 *
 * The pickup address is here, because a driver cannot judge a job without
 * knowing where it starts. That is the trade ADR-0025 §5 records making
 * explicitly.
 *
 * **`order_requests.details` is never emitted wholesale**, and that is the
 * sharpest edge in this file. On a delivery that column holds
 * `sender_phone` and `recipient_phone` — two more numbers §7 withholds, and
 * ones no reviewer would spot going out under a field called `details`.
 * `OrderDetails`'s two allow-lists are what stands between that column
 * and this payload, and they are
 * allow-lists rather than deny-lists precisely so that a new key added to
 * the public order form defaults to *not shipping* to a lock screen.
 *
 * @mixin DispatchOffer
 */
class DispatchOfferResource extends JsonResource
{
    /**
     * The allow-lists moved to `OrderDetails` when `TripResource` needed the
     * payment method too — a driver who accepted an hour ago has forgotten
     * whether this one is cash.
     *
     * They are constants on that class rather than copied here, because the
     * property this allow-list exists to have is that the complete set of
     * keys able to escape `order_requests.details` is greppable in one
     * search. Two copies is one copy that gets a key added to it.
     *
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $order = $this->orderRequest;

        return [
            'id' => $this->id,
            'status' => $this->status->value,

            // Seconds, not just the timestamp. Both are served: the
            // timestamp so a client can run its own countdown against its
            // own clock, and this so the first render is right even on a
            // handset whose clock is minutes out — which is common enough
            // on cheap Android hardware to matter, and would otherwise show
            // a driver a job that had already expired, or one with 40
            // seconds left on a 15-second offer.
            'expires_at' => $this->expires_at->toIso8601String(),
            'expires_in_seconds' => max(0, (int) now()->diffInSeconds($this->expires_at, false)),

            'pickup' => [
                'label' => $order?->pickup_location,
                'latitude' => $order?->pickup_latitude,
                'longitude' => $order?->pickup_longitude,
            ],
            'dropoff' => [
                'label' => $order?->dropoff_location,
                'latitude' => $order?->dropoff_latitude,
                'longitude' => $order?->dropoff_longitude,
            ],
            'service_type' => $order?->service_type->value,
            'reference' => $order?->reference,

            // How far the driver is from the pickup, and the sentences
            // behind the ranking. Served because ADR-0020 §4 requires a
            // ranking somebody can audit — and because "0.4 km away" is the
            // single most useful thing on the screen when deciding.
            'pickup_distance_km' => $this->pickup_distance_km,

            // How far the *job* is, which is the other half of the same
            // question and was missing: 0.4 km away is a good offer if the
            // ride is 9 km and a poor one if it is 700 m. Stored nowhere,
            // because it is a function of two columns — the matcher had no
            // use for it, and the driver does.
            'trip_distance_km' => $this->tripDistanceKm($order),

            'reasons' => $this->reasons ?? [],

            // What is being sent, on a delivery. Null on a ride, rather
            // than an empty object: the field's absence of content is the
            // fact, and a client that has to distinguish "no parcel" from
            // "parcel of unknown size" would get it wrong.
            'package' => $this->package($order),

            // How the job settles. Unlike `package` this is served on every
            // service, because a ride is paid for too — and unlike `package`
            // it is never null as a block, so a client renders one row whose
            // shape does not change between a parcel and a ride.
            'payment' => $this->payment($order),

            // What the ride is estimated to fetch (ADR-0026 §2). Null far
            // more often than the others — see `estimatedFare()`.
            'estimated_fare' => $this->estimatedFare($order),

            'vehicle_id' => $this->vehicle_id,
            'vehicle_registration' => $this->whenLoaded('vehicle', fn () => $this->vehicle?->registration_number),
        ];
    }

    /**
     * Straight-line kilometres from pickup to drop-off, or null.
     *
     * The same great circle the matcher ranks on (ADR-0020 §3) and the same
     * one the tariff estimates from (ADR-0026 §2), so the three numbers a
     * driver sees on one screen cannot disagree with each other.
     *
     * **Not an ETA, and it is not permitted to become one.** ADR-0020 §3
     * refused to derive minutes from a straight line by name; real roads are
     * longer than the crow's flight, so this under-reads, and a client that
     * divides it by an assumed speed has invented the number the platform
     * declined to invent.
     *
     * Null whenever either end lacks coordinates — an order taken over the
     * phone has none — which renders as no figure at all rather than a zero.
     */
    private function tripDistanceKm(?OrderRequest $order): ?float
    {
        if ($order?->pickup_latitude === null || $order->pickup_longitude === null
            || $order->dropoff_latitude === null || $order->dropoff_longitude === null) {
            return null;
        }

        return round(GreatCircle::kilometres(
            $order->pickup_latitude,
            $order->pickup_longitude,
            $order->dropoff_latitude,
            $order->dropoff_longitude,
        ), 2);
    }

    /**
     * What is in the parcel, and how big it is — nothing else.
     *
     * The rule and the keys both live in `OrderDetails::packageFor()` now that
     * `TripResource` asks the same question: the driver sees the parcel on this
     * card and again on the trip record afterwards. Three lines copied into a
     * second resource is precisely the drift that class exists to stop.
     *
     * @return array<string, string|null>|null
     */
    private function package(?OrderRequest $order): ?array
    {
        return OrderDetails::packageFor($order);
    }

    /**
     * How the job settles, on every service — see `OrderDetails::PAYMENT_FIELDS`.
     *
     * An object with null members rather than a null object, which is the
     * opposite of `package()` and deliberate. A ride genuinely has no parcel,
     * so `package` being absent *is* the fact; every job is paid for, so an
     * absent method means only that nobody said, and a client that had to
     * distinguish "not a payable job" from "nobody said" would get it wrong.
     *
     * @return array<string, string|null>
     */
    private function payment(?OrderRequest $order): array
    {
        return OrderDetails::allowed($order, OrderDetails::PAYMENT_FIELDS);
    }

    /**
     * What this job is estimated to fetch (ADR-0026 §2).
     *
     * A *fare*, deliberately not "earnings". There is no commission model in
     * this platform — settlement is deferred by ADR-0026 §3 — so the day a
     * platform cut is introduced, a field named for the driver's take would
     * become a lie in every already-shipped build. The client labels it as a
     * fare for the same reason.
     *
     * Null in four ordinary situations, all of which render as no figure
     * rather than as a zero — a zero reads as a free ride:
     *
     * - the offer carries no vehicle, so no category, so no rate;
     * - either end of the journey has no coordinates;
     * - no public tariff has been published yet;
     * - this vehicle's category has not been priced on it.
     *
     * The last two arrive as `RateCardNotConfiguredException`, and they are
     * caught rather than allowed to propagate **because this is a list
     * endpoint a driver polls every few seconds**. An unpriced boda must cost
     * that driver a figure on one card, not their whole offer list to a 500
     * — the loud failure ADR-0026 wants belongs at completion, where money
     * actually changes hands, and `WalkInFareService::settle()` still throws
     * there.
     *
     * Costs two queries per offer, and a driver holds one open offer at a
     * time under ADR-0024 §4's sequential waves. If wave size is ever raised
     * far enough that this shows up in the poll's latency, the fix is to
     * resolve the tariff version once per request, not to drop the figure.
     *
     * @return array<string, mixed>|null
     */
    private function estimatedFare(?OrderRequest $order): ?array
    {
        $category = $this->vehicle?->category;

        if ($order === null || $category === null) {
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
