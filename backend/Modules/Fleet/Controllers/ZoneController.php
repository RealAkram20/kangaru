<?php

namespace Modules\Fleet\Controllers;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Modules\Fleet\Models\Zone;
use Modules\Fleet\Requests\ResolveZoneRequest;
use Modules\Fleet\Requests\StoreZoneRequest;
use Modules\Fleet\Resources\ZoneResource;
use Modules\Fleet\Services\ZoneResolver;

/**
 * The geofences (ADR-0021).
 */
class ZoneController extends Controller
{
    public function __construct(private readonly ZoneResolver $resolver) {}

    public function index(Request $request): JsonResponse
    {
        $this->authorize('viewAny', Zone::class);

        /** @var User $user */
        $user = $request->user();

        $zones = Zone::query()
            // The platform's plus this client's — never another client's.
            // A platform reader passes null and sees every zone.
            ->when(
                ! $user->isPlatformLevel(),
                fn ($q) => $q->visibleTo($user->tenant_id),
            )
            // …and now never another *fleet's* either (ADR-0055 §5). "A
            // platform reader sees every zone" was true when there was one
            // fleet; it is the same hole F0 found in the staff list, on a
            // table where a zone is a competitor's operating patch.
            //
            // `visibleToActor` rather than the fleet id, because a client's
            // user and a Kangaru user both have a null `operator_id` and must
            // not be treated alike — see the scope's own docblock for the test
            // that proved it.
            ->visibleToActor($user)
            ->orderBy('priority')
            ->orderBy('name')
            ->get();

        return ApiResponse::success(ZoneResource::collection($zones));
    }

    public function store(StoreZoneRequest $request): JsonResponse
    {
        $this->authorize('create', Zone::class);

        // `refresh()`, not the model `create()` returns. `active` has a
        // database default and the request may omit it, so the in-memory
        // instance carries null for it — and the create response would tell
        // a client the zone was switched off when the stored row says
        // otherwise.
        return ApiResponse::success(
            new ZoneResource(Zone::create($request->validated())->refresh()),
            'Zone saved.',
            201,
        );
    }

    public function update(StoreZoneRequest $request, Zone $zone): JsonResponse
    {
        $this->authorize('update', $zone);

        $zone->update($request->validated());

        return ApiResponse::success(new ZoneResource($zone->refresh()), 'Zone updated.');
    }

    public function destroy(Zone $zone): JsonResponse
    {
        $this->authorize('delete', $zone);

        // Soft-deleted, not removed: an invoice raised last month recorded
        // the zone it was priced in, and a hard delete would leave that
        // reference pointing at nothing.
        $zone->delete();

        return ApiResponse::success(message: 'Zone retired.', status: 204);
    }

    /**
     * Which zones contain this point — the question a dispatcher asks when
     * a price or a refusal needs explaining.
     */
    public function resolve(ResolveZoneRequest $request): JsonResponse
    {
        $this->authorize('viewAny', Zone::class);

        /** @var User $user */
        $user = $request->user();

        $lat = (float) $request->validated()['latitude'];
        $lng = (float) $request->validated()['longitude'];

        $zones = $this->resolver->at($lat, $lng, $user->tenant_id);

        return ApiResponse::success(
            ZoneResource::collection($zones),
            meta: [
                // Both reported, because they answer different questions:
                // "may we take this job at all" and "what does it cost".
                'within_service_area' => $this->resolver->withinServiceArea($lat, $lng),
                'pricing_zone_id' => $this->resolver->pricingZoneAt($lat, $lng, $user->tenant_id)?->id,
            ],
        );
    }
}
