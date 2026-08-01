<?php

namespace Modules\Billing\Controllers;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Modules\Billing\Models\RateCard;
use Modules\Billing\Requests\StoreRateCardRequest;
use Modules\Billing\Requests\StoreRateCardVersionRequest;
use Modules\Billing\Resources\RateCardResource;
use Modules\Billing\Resources\RateCardVersionResource;
use Modules\Billing\Services\RateCardService;

/**
 * Rate cards are admin CRUD, so page pagination is acceptable here
 * (AGENTS.md: cursor pagination is for large or append-heavy lists). A
 * tenant has a handful of cards, not thousands.
 *
 * There is no `update` and no `destroy` for prices. Changing what a client
 * is charged is `storeVersion`, and that is the module's central rule
 * rather than an omission.
 */
class RateCardController extends Controller
{
    public function __construct(private readonly RateCardService $rateCards) {}

    public function index(): JsonResponse
    {
        $this->authorize('viewAny', RateCard::class);

        $paginator = RateCard::query()
            ->with(['versions.rates'])
            ->orderByDesc('is_default')
            ->orderBy('name')
            ->paginate(25);

        return ApiResponse::success(
            RateCardResource::collection($paginator->getCollection()),
            meta: [
                'page' => $paginator->currentPage(),
                'per_page' => $paginator->perPage(),
                'total' => $paginator->total(),
            ],
        );
    }

    public function show(RateCard $rateCard): JsonResponse
    {
        $this->authorize('view', $rateCard);

        return ApiResponse::success(new RateCardResource($rateCard->load('versions.rates')));
    }

    public function store(StoreRateCardRequest $request): JsonResponse
    {
        $this->authorize('create', RateCard::class);

        /** @var User $user */
        $user = $request->user();

        $card = $this->rateCards->create($request->cardData(), $user);

        return ApiResponse::success(
            new RateCardResource($card->load('versions.rates')),
            'Rate card created.',
            201,
        );
    }

    /**
     * Supersedes the card's prices with a new immutable version. The
     * previous version is untouched and every invoice raised under it keeps
     * pointing at it (AGENTS.md: "historical invoices keep their version
     * reference").
     */
    public function storeVersion(StoreRateCardVersionRequest $request, RateCard $rateCard): JsonResponse
    {
        $this->authorize('update', $rateCard);

        /** @var User $user */
        $user = $request->user();

        $version = $this->rateCards->addVersion($rateCard, $request->versionData(), $user);

        return ApiResponse::success(
            new RateCardVersionResource($version),
            'Rate card version created.',
            201,
        );
    }

    /**
     * Makes this the card that prices trips when no card is named. A PUT
     * because it is idempotent: applying it twice leaves the same single
     * default in place.
     */
    public function makeDefault(RateCard $rateCard): JsonResponse
    {
        $this->authorize('update', $rateCard);

        $card = $this->rateCards->makeDefault($rateCard);

        return ApiResponse::success(
            new RateCardResource($card->load('versions.rates')),
            'Default rate card updated.',
        );
    }
}
