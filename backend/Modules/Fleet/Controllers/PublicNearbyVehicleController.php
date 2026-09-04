<?php

namespace Modules\Fleet\Controllers;

use App\Http\Controllers\Controller;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Modules\Drivers\Models\Driver;
use Modules\Fleet\Support\DriverPresence;
use Modules\Fleet\Support\DriverPresenceStore;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Vehicles\Models\Vehicle;

/**
 * The vehicles available near a point, for anyone to see (ADR-0005's
 * deferred "nearby-driver search", buildable since ADR-0024 §2 built
 * presence).
 *
 * The order page used to draw six vehicles at hardcoded offsets from
 * wherever its map was centred, and its own comment was honest about why:
 * "the public API exposes none". This is the endpoint that sentence was
 * waiting for. It answers one question — *are there really vehicles near
 * me* — for the walk-in order form and for a client's live map, and it is
 * deliberately shaped so that answering it leaks nothing else.
 *
 * ## What it serves, and what it never will
 *
 * Each entry is a **position and a silhouette**: an opaque key, the
 * vehicle's category, a sprite family, coordinates, and the age of the
 * report. No driver id, no name, no plate, no phone — the fleet register
 * stays behind `drivers.view` (docs/security-gate.md F2), and nothing on
 * this surface can be joined back to it.
 *
 * The `key` exists only so a map can move a marker instead of redrawing
 * it, and it **rotates every hour**: hash(driver, hour, app key). Within
 * an hour a poller sees the same vehicle glide; across hours the keys
 * shuffle, so watching this endpoint all day does not reconstruct any one
 * driver's shift. That is the whole design tension — smooth markers want a
 * stable identity, privacy wants none — and an hourly window is where the
 * two meet.
 *
 * ## Only what a customer could actually hail
 *
 * `dispatchable()` (on duty, position fresh within the presence TTL), with
 * a usable position, **minus anyone on an occupying trip**. A driver mid-
 * ride would be counted by the matcher's ranking as busy anyway; a map
 * that showed their car as "available near you" would promise capacity the
 * next order cannot have.
 */
class PublicNearbyVehicleController extends Controller
{
    /**
     * How far away a vehicle can be and still be "nearby", and how many to
     * name. 15km spans the Kampala metro a walk-in order can realistically
     * pull a driver across; twelve is more markers than the map has room
     * to say anything with. Both bound the response so the endpoint can
     * never be used to dump the whole fleet's positions in one call.
     */
    private const RADIUS_KM = 15.0;

    private const LIMIT = 12;

    /** Metres per degree of latitude — near enough at Kampala's latitude. */
    private const METRES_PER_DEGREE = 111_320;

    /**
     * Category → the sprite family the maps draw. Ambience, not a claim:
     * a tricycle rendered with the rider silhouette and a van with the
     * SUV's box are the nearest honest shapes in the four-sprite set.
     */
    private const KINDS = [
        'boda' => 'boda',
        'tricycle' => 'boda',
        'sedan' => 'sedan',
        'suv' => 'suv',
        'van' => 'suv',
        'minibus' => 'suv',
        'bus' => 'suv',
        'pickup' => 'pickup',
        'truck' => 'pickup',
    ];

    public function __construct(private readonly DriverPresenceStore $presence) {}

    public function index(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'latitude' => ['required', 'numeric', 'between:-90,90'],
            'longitude' => ['required', 'numeric', 'between:-180,180'],
        ]);

        $latitude = (float) $validated['latitude'];
        $longitude = (float) $validated['longitude'];

        $pool = $this->presence->dispatchable()
            ->filter(fn (DriverPresence $p) => $p->hasUsablePosition());

        if ($pool->isEmpty()) {
            return ApiResponse::success([]);
        }

        $driverIds = $pool->map(fn (DriverPresence $p) => $p->driverId)->values()->all();

        // Busy drivers are not capacity. One indexed read for the pool, not
        // one per driver — same shape as OnDutyDriverController.
        //
        // `withoutGlobalScopes()`, deliberately and narrowly: there is no
        // tenant bound on a public route, so TenantScope would fail closed
        // and this check would find nobody busy — every mid-ride driver
        // would show as available. Reading across tenants is safe here
        // because the answer is only ever used to *remove* rows from the
        // response; no trip data leaves this method.
        $busy = Trip::query()
            ->withoutGlobalScopes()
            ->whereIn('driver_id', $driverIds)
            ->whereIn('status', TripStatus::occupyingValues())
            ->pluck('driver_id')
            ->flip();

        $available = $pool->reject(fn (DriverPresence $p) => $busy->has($p->driverId))->values();

        if ($available->isEmpty()) {
            return ApiResponse::success([]);
        }

        $categories = $this->categoriesFor($available);

        $rows = $available
            ->map(fn (DriverPresence $p) => [
                'presence' => $p,
                'distanceKm' => $this->distanceKm($latitude, $longitude, (float) $p->latitude, (float) $p->longitude),
            ])
            ->filter(fn (array $row) => $row['distanceKm'] <= self::RADIUS_KM)
            ->sortBy('distanceKm')
            ->take(self::LIMIT)
            ->values()
            ->map(function (array $row) use ($categories) {
                /** @var DriverPresence $p */
                $p = $row['presence'];
                $category = $categories[$p->driverId] ?? null;

                return [
                    'key' => $this->keyFor($p->driverId),
                    'category' => $category,
                    'kind' => self::KINDS[$category] ?? 'sedan',
                    'latitude' => $p->latitude,
                    'longitude' => $p->longitude,
                    'age_seconds' => $p->ageSeconds(),
                ];
            });

        return ApiResponse::success($rows->all());
    }

    /**
     * The marker identity: stable for an hour, opaque forever.
     *
     * Keyed with the app key so it cannot be recomputed from outside, and
     * with the hour so it cannot be followed across one. Truncated because
     * a marker id needs uniqueness across at most a few dozen rows, not
     * collision resistance against an adversary.
     */
    private function keyFor(int $driverId): string
    {
        return substr(hash('sha256', $driverId.'|'.now()->format('YmdH').'|'.config('app.key')), 0, 12);
    }

    /**
     * Each available driver's vehicle category — the shift's vehicle first,
     * the profile's as fallback, exactly the precedence the matcher uses.
     *
     * @param  Collection<int, DriverPresence>  $available
     * @return array<int, string|null> driver id → category
     */
    private function categoriesFor(Collection $available): array
    {
        $driverIds = $available->map(fn (DriverPresence $p) => $p->driverId)->all();

        $profileVehicles = Driver::query()
            ->whereIn('id', $driverIds)
            ->pluck('vehicle_id', 'id');

        $vehicleIds = $available
            ->map(fn (DriverPresence $p) => $p->vehicleId ?? $profileVehicles->get($p->driverId))
            ->filter()
            ->unique()
            ->values()
            ->all();

        $categories = $vehicleIds === []
            ? collect()
            : Vehicle::query()->whereIn('id', $vehicleIds)->pluck('category', 'id');

        return $available
            ->mapWithKeys(function (DriverPresence $p) use ($profileVehicles, $categories) {
                $vehicleId = $p->vehicleId ?? $profileVehicles->get($p->driverId);

                return [$p->driverId => $vehicleId === null ? null : $categories->get($vehicleId)];
            })
            ->all();
    }

    /**
     * Equirectangular distance — the same approximation the front end's
     * `captainPosition` documents: Kampala sits within half a degree of the
     * equator, where the cosine correction is 0.99996, far below what
     * "within 15km" is claiming.
     */
    private function distanceKm(float $lat1, float $lng1, float $lat2, float $lng2): float
    {
        $dLat = ($lat2 - $lat1) * self::METRES_PER_DEGREE;
        $dLng = ($lng2 - $lng1) * self::METRES_PER_DEGREE * cos(deg2rad(($lat1 + $lat2) / 2));

        return sqrt($dLat * $dLat + $dLng * $dLng) / 1000;
    }
}
