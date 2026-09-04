<?php

namespace Modules\Clients\Controllers;

use App\Http\Controllers\Controller;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Modules\Clients\Models\ClientPlace;
use Modules\Clients\Models\ClientRoute;
use Modules\Clients\Requests\PreviewClientRouteRequest;
use Modules\Clients\Services\ClientRouteReferenceException;
use Modules\Trips\Routing\RouteService;

/**
 * The line under the pins, while the circuit is still being drawn
 * (ADR-0045 §7).
 *
 * ## Why the builder cannot draw this itself
 *
 * ADR-0031 §1: the Directions credential never leaves the server, because it
 * **bills per request** and a key in a browser bundle is extractable with no
 * password to rotate. So the browser sends an ordered list of its own place
 * ids and gets back a shape — the key, the cache and the ceiling all stay on
 * this side.
 *
 * ## Null is a real answer
 *
 * Routing is off by default (ADR-0031 §2) and every provider failure is a
 * null rather than an exception. `data: null` therefore means "no line
 * today", and the builder must render the pins with no polyline and an em
 * dash where the distance goes — never a straight line between the stops,
 * which is not a road, and never a crow's-flight kilometre figure, which
 * ADR-0020 §3 refused for understating the drive by 39% on a real run.
 */
class ClientRoutePreviewController extends Controller
{
    public function __construct(private readonly RouteService $routes) {}

    public function store(PreviewClientRouteRequest $request): JsonResponse
    {
        // The route policy, not a place one: this answers "what does my
        // circuit look like", and the circuit is the thing being built.
        $this->authorize('create', ClientRoute::class);

        /** @var array<int, int> $ids */
        $ids = array_map(intval(...), $request->validated('place_ids'));

        // Keyed by id and read under the tenant scope, so a place belonging
        // to another client simply is not in the map — and the refusal below
        // names it rather than drawing a shorter circuit. Same guard, same
        // reasoning and the same error code as saving one.
        $places = ClientPlace::query()
            ->whereIn('id', $ids)
            ->get()
            ->keyBy('id');

        // Walked in the order sent rather than over the keyed collection,
        // because a client may legitimately visit the same place twice in
        // one circuit — head office at the start and again at the end is the
        // ordinary shape of a cash run, and a keyed read would drop the leg
        // home.
        $points = [];
        $missing = [];

        foreach ($ids as $id) {
            $place = $places->get($id);

            if ($place === null) {
                $missing[$id] = $id;

                continue;
            }

            $points[] = [(float) $place->latitude, (float) $place->longitude];
        }

        if ($missing !== []) {
            $refusal = ClientRouteReferenceException::places(array_values($missing));

            return ApiResponse::error(
                $refusal->errorCode,
                $refusal->getMessage(),
                ['place_ids' => $refusal->values],
            );
        }

        $route = $this->routes->via($points);

        return ApiResponse::success($route?->toArray());
    }
}
