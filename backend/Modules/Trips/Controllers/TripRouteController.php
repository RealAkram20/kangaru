<?php

namespace Modules\Trips\Controllers;

use App\Http\Controllers\Controller;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Modules\Trips\Models\Trip;
use Modules\Trips\Routing\RouteService;

/**
 * The road between the driver and where they are going (ADR-0031).
 *
 * ## Why the server draws this and not the handset
 *
 * The Directions key bills per request and never leaves the server (ADR-0031
 * §1). A key in a mobile bundle is extractable, and a leaked one is somebody
 * else's traffic on this operator's invoice with nothing to rotate that does
 * not also break the feature for every driver. Routing through one endpoint
 * also gives the cache somewhere to live and the spend somewhere to be
 * observed.
 *
 * ## Null is a normal answer
 *
 * No key, switch off, no network, a quota rejection, two points with no road
 * between them, or a trip taken over the phone with no pins — all of them come
 * back as `route: null` and **200**, not as an error. The app draws the dashed
 * direct line it drew before any of this existed. A 4xx here would turn a
 * missing polyline into a screen a driver cannot use with a passenger in the
 * car (ADR-0031 §3).
 */
class TripRouteController extends Controller
{
    public function __construct(private readonly RouteService $routes) {}

    public function show(Request $request, Trip $trip): JsonResponse
    {
        // The same gate as the timeline: a driver may read their own trip.
        $this->authorize('view', $trip);

        $validated = $request->validate([
            // Where to route *from*, when the app knows. Optional: a screen
            // opened before the handset has a fix still wants the pickup-to-
            // drop-off line, and a driver with location refused gets one too.
            'from_latitude' => ['nullable', 'numeric', 'between:-90,90', 'required_with:from_longitude'],
            'from_longitude' => ['nullable', 'numeric', 'between:-180,180', 'required_with:from_latitude'],
        ]);

        $order = $trip->orderRequest;

        // Both ends have to be real. `TripResource::place` already refuses to
        // serve half a position, and the same rule applies here: a route from
        // a coordinate the platform guessed is worse than no route.
        if ($order === null
            || $order->dropoff_latitude === null
            || $order->dropoff_longitude === null) {
            return ApiResponse::success(['route' => null], 'No route available for this trip.');
        }

        $fromLatitude = $validated['from_latitude'] ?? $order->pickup_latitude;
        $fromLongitude = $validated['from_longitude'] ?? $order->pickup_longitude;

        if ($fromLatitude === null || $fromLongitude === null) {
            return ApiResponse::success(['route' => null], 'No route available for this trip.');
        }

        $route = $this->routes->between(
            (float) $fromLatitude,
            (float) $fromLongitude,
            (float) $order->dropoff_latitude,
            (float) $order->dropoff_longitude,
        );

        return ApiResponse::success(
            ['route' => $route?->toArray()],
            $route === null ? 'No route available for this trip.' : 'Route retrieved.',
        );
    }
}
