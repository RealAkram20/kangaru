<?php

namespace Modules\Bookings\Controllers;

use App\Http\Controllers\Controller;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Modules\Billing\Pricing\RateCardNotConfiguredException;
use Modules\Billing\Services\WalkInFareService;
use Modules\Bookings\Enums\RideVehicleClass;

/**
 * What a ride would cost, per class, before it is ordered — `GET
 * /public/fare-quotes`.
 *
 * ## Why this exists
 *
 * The public order form showed a price beside every ride class, and every one
 * of them was a literal in the frontend ("from UGX 12,500"). The tariff
 * (ADR-0026) had been priced, versioned and audited on the server the whole
 * time; nothing asked it a question until a vehicle had already accepted the
 * job. So the passenger chose a class against numbers no rate card had
 * produced, and the driver was then quoted a different figure for the same
 * ride. One engine, one answer: this endpoint prices every class through the
 * same `WalkInFareService::quote()` the driver's screen uses, so the two
 * people in the car are told one number.
 *
 * ## What it is not
 *
 * Not a bill and not a promise: `is_estimate` travels on every figure, and the
 * quote is straight-line distance (ADR-0026 §2's rule for a quote), which the
 * `basis` sentence says in words. Not authenticated: it is read on the form
 * before anybody has an account (ADR-0015 §1 requires one to *order*, not to
 * *look*), and it reveals nothing but the public tariff, which is public.
 * Throttled per IP like every other public read, because a geocode-and-quote
 * loop is a cheap way to keep a server busy.
 *
 * ## Null is a normal answer
 *
 * A class the tariff does not price, or a tariff nobody has published yet,
 * comes back as `null` for that class and **200** — the form falls back to its
 * "from" figure and says so. A 4xx would turn an unpriced category into a form
 * nobody can order from.
 */
class PublicFareQuoteController extends Controller
{
    public function __construct(private readonly WalkInFareService $fares) {}

    public function index(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'pickup_latitude' => ['required', 'numeric', 'between:-90,90'],
            'pickup_longitude' => ['required', 'numeric', 'between:-180,180'],
            'dropoff_latitude' => ['required', 'numeric', 'between:-90,90'],
            'dropoff_longitude' => ['required', 'numeric', 'between:-180,180'],
        ]);

        $quotes = [];

        foreach (RideVehicleClass::cases() as $class) {
            try {
                $quotes[$class->value] = $this->fares->quote(
                    $class->vehicleCategory(),
                    (float) $validated['pickup_latitude'],
                    (float) $validated['pickup_longitude'],
                    (float) $validated['dropoff_latitude'],
                    (float) $validated['dropoff_longitude'],
                )?->toArray();
            } catch (RateCardNotConfiguredException) {
                $quotes[$class->value] = null;
            }
        }

        return ApiResponse::success(['quotes' => $quotes], 'Fare quotes.');
    }
}
