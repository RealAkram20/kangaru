<?php

namespace Modules\Fleet\Controllers;

use App\Enums\ErrorCode;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Modules\Fleet\Enums\AvailabilityResource;
use Modules\Fleet\Enums\AvailabilityStatus;
use Modules\Fleet\Models\AvailabilityBlock;
use Modules\Fleet\Requests\AnswerAvailabilityBlockRequest;
use Modules\Fleet\Requests\AvailabilityBlockIndexRequest;
use Modules\Fleet\Requests\StoreAvailabilityBlockRequest;
use Modules\Fleet\Resources\AvailabilityBlockResource;

/**
 * Leave, maintenance and every other reason a driver or vehicle is off the
 * road (ADR-0017).
 *
 * One collection for both resource kinds rather than a sub-resource under
 * each: a dispatcher's real question is "what is out this week", which
 * crosses both, and two endpoints would have to be merged by every caller
 * that asked it.
 */
class AvailabilityBlockController extends Controller
{
    public function index(AvailabilityBlockIndexRequest $request): JsonResponse
    {
        $this->authorize('viewAny', AvailabilityBlock::class);

        $filters = $request->validated();

        $blocks = AvailabilityBlock::query()
            ->when(
                isset($filters['resource_type']),
                fn ($q) => $q->where('resource_type', AvailabilityResource::from($filters['resource_type'])),
            )
            ->when(isset($filters['resource_id']), fn ($q) => $q->where('resource_id', $filters['resource_id']))
            ->when(
                isset($filters['status']),
                fn ($q) => $q->where('status', AvailabilityStatus::from($filters['status'])),
            )
            ->when(
                isset($filters['from'], $filters['to']),
                fn ($q) => $q->overlapping(
                    CarbonImmutable::parse($filters['from']),
                    CarbonImmutable::parse($filters['to']),
                ),
            )
            ->orderBy('starts_at')
            ->get();

        return ApiResponse::success(AvailabilityBlockResource::collection($blocks));
    }

    public function store(StoreAvailabilityBlockRequest $request): JsonResponse
    {
        $attributes = $request->validated();
        $resource = AvailabilityResource::from($attributes['resource_type']);

        // Authorised on the resource kind, not on the model — the
        // permission that governs a driver's leave is the one that governs
        // the driver (ADR-0017 §5).
        $this->authorize('createFor', [AvailabilityBlock::class, $resource]);

        /** @var User $user */
        $user = $request->user();

        $block = AvailabilityBlock::create([
            ...$attributes,
            'created_by_user_id' => $user->id,
        ]);

        return ApiResponse::success(
            new AvailabilityBlockResource($block),
            'Recorded. Dispatch will not offer this for the period.',
            201,
        );
    }

    /**
     * The fleet office answering a request for time off (ADR-0017 §6).
     *
     * This is the far end of the Driver's Application: a driver asks, this
     * answers. Idempotent it is not — an already-answered request is a 409,
     * because silently re-deciding somebody's leave is how two people end up
     * holding two different answers.
     */
    public function answer(
        AnswerAvailabilityBlockRequest $request,
        AvailabilityBlock $availabilityBlock,
    ): JsonResponse {
        $this->authorize('respond', $availabilityBlock);

        if ($availabilityBlock->isAnswered()) {
            return ApiResponse::error(
                ErrorCode::AVAILABILITY_ALREADY_ANSWERED,
                sprintf(
                    'This request was already %s. Remove it and ask again if the decision has changed.',
                    $availabilityBlock->status->value,
                ),
                [],
                409,
            );
        }

        /** @var User $user */
        $user = $request->user();

        $availabilityBlock->update([
            'status' => AvailabilityStatus::from($request->validated()['status']),
            'answer_note' => $request->validated()['note'] ?? null,
            'answered_by_user_id' => $user->id,
            'answered_at' => now(),
        ]);

        return ApiResponse::success(
            new AvailabilityBlockResource($availabilityBlock->refresh()),
            'Answered.',
        );
    }

    /**
     * Ends the block, which is how a vehicle released early gets back on the
     * road today rather than when the paperwork said it would.
     */
    public function destroy(AvailabilityBlock $availabilityBlock): JsonResponse
    {
        $this->authorize('delete', $availabilityBlock);

        $availabilityBlock->delete();

        return ApiResponse::success(message: 'Removed. Dispatch can offer this again.', status: 204);
    }
}
