<?php

namespace Modules\Fleet\Controllers;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Modules\Drivers\Models\Driver;
use Modules\Fleet\Resources\OnDutyDriverResource;
use Modules\Fleet\Support\DriverPresence;
use Modules\Fleet\Support\DriverPresenceStore;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Vehicles\Models\Vehicle;

/**
 * Who is on duty, and where — the office's read of presence (ADR-0024 §2).
 *
 * `GET /live-positions` answers "where are the vehicles on a trip", and
 * that is half of what a dispatcher's map is for. The other half is the
 * pool: the drivers who have signed on and are waiting for work, which is
 * exactly the set the matcher ranks and until now only the matcher could
 * see. A dispatcher deciding whether a walk-in will be picked up wants to
 * look at the map and count green dots; this is where the green dots come
 * from.
 *
 * ## Whose it is
 *
 * `DriverPolicy::viewAny` — `drivers.view`, the same read the fleet register
 * needs, held by the roles that operate the fleet and withheld from a
 * client's people (docs/security-gate.md F2). The drivers are Shanitah's,
 * never a client's; a bank's transport officer has no business knowing
 * which riders are idle in Ntinda, and their live map is the trips they
 * may see, which `/live-positions` already scopes.
 *
 * ## On duty, not dispatchable
 *
 * `DriverPresenceStore::onDuty()` rather than `dispatchable()`, and the
 * difference is the point. The matcher hides a driver whose position has
 * gone stale, because it must not rank them from a place they left. The
 * map wants that driver most of all — greyed, "not reporting 12m" — so
 * that somebody phones them. A driver with no position at all (location
 * refused on the handset) is listed with no coordinates; the page says so
 * rather than inventing a place.
 */
class OnDutyDriverController extends Controller
{
    public function __construct(private readonly DriverPresenceStore $presence) {}

    public function index(Request $request): JsonResponse
    {
        $this->authorize('viewAny', Driver::class);

        $presences = $this->presence->onDuty();

        if ($presences->isEmpty()) {
            return ApiResponse::success([], 'Nobody is on duty.');
        }

        $driverIds = $presences->map(fn (DriverPresence $p) => $p->driverId)->all();

        // Name and vehicle, allow-listed in the resource. Loaded in two
        // queries for the whole pool, not one per driver.
        $drivers = Driver::query()
            ->whereIn('id', $driverIds)
            ->get(['id', 'name', 'vehicle_id'])
            ->keyBy('id');

        // The vehicle this shift says they are in (`driver_presence.vehicle_id`)
        // wins; the one on their profile is the fallback — the same
        // precedence the matcher uses when it offers them work.
        $vehicleIds = $presences
            ->map(fn (DriverPresence $p) => $p->vehicleId ?? $drivers->get($p->driverId)?->vehicle_id)
            ->filter()
            ->unique()
            ->values()
            ->all();

        $vehicles = $vehicleIds === []
            ? collect()
            : Vehicle::query()
                ->whereIn('id', $vehicleIds)
                ->get(['id', 'registration_number', 'make', 'model', 'category'])
                ->keyBy('id');

        // The trip that has them, if one does — so the map can tell "waiting
        // for work" from "on a trip whose vehicle has not reported yet"
        // without a second round trip. One trip per driver at most; the
        // state machine refuses a second occupying trip on a busy driver.
        // `forActor`, not `query()` (ADR-0006): the caller is platform
        // staff with no tenant bound, and the plain tenant scope would
        // answer nothing — every driver would read as waiting.
        // Guaranteed non-null, and a platform user rather than a customer:
        // this route sits behind `auth:sanctum` and a fleet permission.
        /** @var User $actor */
        $actor = $request->user();

        $trips = Trip::forActor($actor)
            ->whereIn('driver_id', $driverIds)
            ->whereIn('status', TripStatus::occupyingValues())
            ->get(['id', 'driver_id', 'status'])
            ->keyBy('driver_id');

        $rows = $presences->map(function (DriverPresence $presence) use ($drivers, $vehicles, $trips) {
            $driver = $drivers->get($presence->driverId);
            $vehicleId = $presence->vehicleId ?? $driver?->vehicle_id;

            return new OnDutyDriverResource(
                $presence,
                $driver,
                $vehicleId === null ? null : $vehicles->get($vehicleId),
                $trips->get($presence->driverId),
            );
        });

        return ApiResponse::success($rows->values()->all());
    }
}
