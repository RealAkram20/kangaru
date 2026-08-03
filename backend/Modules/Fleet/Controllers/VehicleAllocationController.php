<?php

namespace Modules\Fleet\Controllers;

use App\Enums\ErrorCode;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use App\Support\Tenancy\ClientOptions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Modules\Fleet\Models\VehicleAllocation;
use Modules\Fleet\Requests\EndVehicleAllocationRequest;
use Modules\Fleet\Requests\StoreVehicleAllocationRequest;
use Modules\Fleet\Resources\VehicleAllocationResource;
use Modules\Fleet\Services\AllocationConflictException;
use Modules\Fleet\Services\AllocationService;

/**
 * `Modules/Fleet`'s first API — README item 4, which ADR-0009 turned from a
 * nicety into the blocker: ranking, exclusivity and the overlap rule are all
 * unreachable while allocations can only be written by a seeder.
 *
 * A platform reader is the primary reader here. An allocation is a contract
 * between Shanitah and a client, and Shanitah is a party to it, so
 * `forActor()` is present from the first commit rather than retrofitted the
 * way ADR-0006 had to retrofit five other listings.
 */
class VehicleAllocationController extends Controller
{
    public function __construct(private readonly AllocationService $allocations) {}

    public function index(Request $request): JsonResponse
    {
        $this->authorize('viewAny', VehicleAllocation::class);

        /** @var User $user */
        $user = $request->user();

        $allocations = VehicleAllocation::forActor($user)
            ->with(['vehicle', ...($user->isPlatformLevel() ? ['tenant'] : [])])
            // Newest contract first, then by vehicle so a client's rows group
            // predictably rather than by insertion accident.
            ->orderByDesc('starts_on')
            ->orderBy('vehicle_id')
            ->get();

        return ApiResponse::success(
            VehicleAllocationResource::collection($allocations),
            '',
            200,
            // The same picker payload /bookings and /trips serve, so a client
            // filter holds no list of its own (ADR-0006).
            ['filters' => ['clients' => ClientOptions::forActor($user)]],
        );
    }

    public function show(VehicleAllocation $allocation): JsonResponse
    {
        $this->authorize('view', $allocation);

        return ApiResponse::success(
            new VehicleAllocationResource($allocation->load(['vehicle', 'tenant'])),
        );
    }

    /**
     * A 409 rather than a 422 when the overlap rule refuses: the request was
     * well-formed, the world already holds something incompatible with it —
     * the same distinction dispatch draws (AGENTS.md API Standards).
     */
    public function store(StoreVehicleAllocationRequest $request): JsonResponse
    {
        $this->authorize('create', VehicleAllocation::class);

        /** @var User $user */
        $user = $request->user();

        try {
            $allocation = $this->allocations->agree($request->allocation(), $user);
        } catch (AllocationConflictException $e) {
            return ApiResponse::error(ErrorCode::ALLOCATION_CONFLICT, $e->getMessage(), [], 409);
        }

        return ApiResponse::success(
            new VehicleAllocationResource($allocation->load(['vehicle', 'tenant'])),
            'Allocation agreed.',
            201,
        );
    }

    /**
     * Ending a contract is a PATCH on the allocation rather than a DELETE:
     * the row is a commercial record and the audit log is a product feature,
     * so a contract that ran stays visible with the day it stopped.
     */
    public function end(EndVehicleAllocationRequest $request, VehicleAllocation $allocation): JsonResponse
    {
        $this->authorize('update', $allocation);

        $allocation = $this->allocations->end(
            $allocation,
            Carbon::parse($request->validated()['ends_on']),
        );

        return ApiResponse::success(
            new VehicleAllocationResource($allocation->load(['vehicle', 'tenant'])),
            'Allocation ended.',
        );
    }
}
