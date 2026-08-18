<?php

namespace Modules\Drivers\Controllers;

use App\Enums\ErrorCode;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Modules\Drivers\Enums\DriverApplicationStatus;
use Modules\Drivers\Models\DriverApplication;
use Modules\Drivers\Requests\ApproveDriverApplicationRequest;
use Modules\Drivers\Requests\RejectDriverApplicationRequest;
use Modules\Drivers\Requests\StoreDriverApplicationRequest;
use Modules\Drivers\Resources\DriverApplicationResource;
use Modules\Drivers\Resources\DriverResource;
use Modules\Drivers\Services\DriverAccountConflictException;
use Modules\Drivers\Services\DriverApplicationClosedException;
use Modules\Drivers\Services\DriverApplicationService;

/**
 * The queue a rider puts themselves in, and the console that empties it
 * (ADR-0027).
 *
 * One controller, two audiences: `store` is unauthenticated and reached from
 * the Driver App's sign-up form, everything else is console-side behind
 * `DriverApplicationPolicy`.
 */
class DriverApplicationController extends Controller
{
    public function __construct(private readonly DriverApplicationService $applications) {}

    /**
     * Records an application. Unauthenticated, throttled at the route.
     *
     * **Answers identically whether or not the email is already known**
     * (ADR-0027 §5). There is no duplicate check here and no uniqueness rule
     * in the form request, because either one would turn this endpoint into
     * a way of asking "does this person drive for KangaruRide". A duplicate
     * is stored and refused at approval, in front of somebody entitled to
     * the answer.
     *
     * 202, not 201: the platform has accepted the application for review, and
     * has deliberately not created the account the caller asked for. Nothing
     * is returned but a sentence — an id would be a handle for guessing at
     * other people's applications, and §6 gives the applicant nothing to
     * look up anyway.
     */
    public function store(StoreDriverApplicationRequest $request): JsonResponse
    {
        $this->applications->submit($request->validated());

        return ApiResponse::success(
            null,
            'Your application has been received. The office will call you on the number you gave.',
            202,
        );
    }

    public function index(Request $request): JsonResponse
    {
        $this->authorize('viewAny', DriverApplication::class);

        $filters = $request->validate([
            'status' => ['sometimes', Rule::enum(DriverApplicationStatus::class)],
        ]);

        // Oldest first, like the walk-in queue and for the same reason: the
        // application that has waited longest is the next phone call to make.
        $page = DriverApplication::query()
            ->when(
                isset($filters['status']),
                fn ($query) => $query->where('status', $filters['status']),
            )
            ->orderBy('created_at')
            ->paginate(25);

        return ApiResponse::success(
            ['driver_applications' => DriverApplicationResource::collection($page->items())],
            'Driver applications retrieved.',
            200,
            [
                'page' => $page->currentPage(),
                'per_page' => $page->perPage(),
                'total' => $page->total(),
            ],
        );
    }

    public function show(DriverApplication $driverApplication): JsonResponse
    {
        $this->authorize('view', $driverApplication);

        return ApiResponse::success(new DriverApplicationResource($driverApplication));
    }

    /**
     * Creates the driver, mints the account, links them, closes the
     * application — one transaction (ADR-0027 §4).
     */
    public function approve(
        ApproveDriverApplicationRequest $request,
        DriverApplication $driverApplication,
    ): JsonResponse {
        $this->authorize('decide', DriverApplication::class);

        /** @var User $reviewer */
        $reviewer = $request->user();

        try {
            $driver = $this->applications->approve(
                $driverApplication,
                $reviewer,
                $request->validated(),
            );
        } catch (DriverApplicationClosedException $e) {
            return ApiResponse::error(ErrorCode::DRIVER_APPLICATION_CLOSED, $e->getMessage(), [], 409);
        } catch (DriverAccountConflictException $e) {
            // The duplicate ADR-0027 §5 deliberately let through at
            // submission, surfacing here where a human can act on it.
            return ApiResponse::error(ErrorCode::DRIVER_ACCOUNT_CONFLICT, $e->getMessage(), [], 409);
        }

        return ApiResponse::success(
            new DriverResource($driver->refresh()->load('user')),
            'Approved. They can sign in with the password they chose when they applied.',
            201,
        );
    }

    public function reject(
        RejectDriverApplicationRequest $request,
        DriverApplication $driverApplication,
    ): JsonResponse {
        $this->authorize('decide', DriverApplication::class);

        /** @var User $reviewer */
        $reviewer = $request->user();

        try {
            $application = $this->applications->reject(
                $driverApplication,
                $reviewer,
                (string) $request->validated()['reason'],
            );
        } catch (DriverApplicationClosedException $e) {
            return ApiResponse::error(ErrorCode::DRIVER_APPLICATION_CLOSED, $e->getMessage(), [], 409);
        }

        return ApiResponse::success(
            new DriverApplicationResource($application),
            'Application rejected. Nobody is told automatically — call them if they should know.',
        );
    }
}
