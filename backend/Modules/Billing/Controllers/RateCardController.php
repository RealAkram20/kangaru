<?php

namespace Modules\Billing\Controllers;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Modules\Billing\Models\RateCard;
use Modules\Billing\Requests\StoreRateCardRequest;
use Modules\Billing\Requests\StoreRateCardVersionRequest;
use Modules\Billing\Requests\UpdateRateCardRequest;
use Modules\Billing\Resources\RateCardResource;
use Modules\Billing\Resources\RateCardVersionResource;
use Modules\Billing\Services\RateCardService;

/**
 * Rate cards are admin CRUD, so page pagination is acceptable here
 * (AGENTS.md: cursor pagination is for large or append-heavy lists). A
 * tenant has a handful of cards, not thousands.
 *
 * **`update` exists and cannot touch a price.** It changes a card's name,
 * description and status — the labels *on* a pricing document rather than the
 * terms *of* one. Changing what a client is charged is `storeVersion`, and
 * that is the module's central rule rather than an omission: a version is
 * immutable, so an invoice already sent stays reproducible from the version
 * that priced it.
 *
 * There is no `destroy`. A rate card that priced an invoice is evidence;
 * `status: archived` is how one is taken out of the way.
 */
class RateCardController extends Controller
{
    public function __construct(private readonly RateCardService $rateCards) {}

    /**
     * **`forActor()`, not a plain query** (ADR-0006).
     *
     * `TenantScope` fails closed: with no tenant bound to the request it
     * appends `1 = 0` rather than returning every tenant's rows. Platform
     * staff — Super Admin, Finance, Operations — have `tenant_id` null and
     * bind no tenant, so a plain `RateCard::query()` answered **zero cards to
     * the two roles that own pricing**, on a database holding three.
     *
     * That was the live symptom: "No rate cards yet", with the empty state's
     * "create one to get started" advice, on a platform whose default walk-in
     * tariff already existed. `store()` would then have made a fourth nobody
     * could see either.
     *
     * `BelongsToTenant::resolveRouteBinding()` already made *single-resource*
     * routes actor-aware and its docblock names this exact leftover — "that is
     * the shape of the Super Admin's empty platform today: the listing was
     * only half of it". `RateCardService` uses `forActor()` on every write
     * path. This listing was the one place still missing it, so a Super Admin
     * could open a card by id and could not find one to open.
     *
     * **Scoping is not authorization and this grants nothing.** `forActor()`
     * answers *whose* rows; `RateCardPolicy::viewAny` has already answered
     * *whether this actor may look*, and a tenant user's query is unchanged —
     * they still see their own cards and the 404 on somebody else's still
     * holds.
     */
    public function index(): JsonResponse
    {
        $this->authorize('viewAny', RateCard::class);

        /** @var User $user */
        $user = request()->user();

        $paginator = RateCard::query()
            ->forActor($user)
            // A fleet prices its own clients and reads Kangaru's public
            // tariff; it does not read another fleet's prices (ADR-0055 §5).
            // `forActor` answers the *client* axis and drops the scope
            // entirely for fleet staff, which before this line meant every
            // fleet's commercial terms in one list.
            //
            // A client reader is left to `forActor` alone: which fleet serves
            // them is the contract F2 introduces, and filtering on their own
            // null fleet would hide the cards that price their own trips.
            ->visibleToActor($user)
            ->with($this->versionsFor($user))
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

    /**
     * Renames a card, redescribes it, or archives it — **never its prices.**
     *
     * `UpdateRateCardRequest` offers no field that reaches a version, and
     * `PricedRate` throws on update regardless. The card's own subtitle in the
     * console states the rule this preserves: *a version is never edited —
     * changing a price adds another.*
     *
     * `is_default` is not accepted here either; promoting a card must demote
     * whichever card currently holds the flag, and
     * `PUT /rate-cards/{card}/default` owns that transaction.
     */
    public function update(UpdateRateCardRequest $request, RateCard $rateCard): JsonResponse
    {
        $this->authorize('update', $rateCard);

        /** @var User $user */
        $user = $request->user();

        $card = $this->rateCards->updateDetails($rateCard, $request->cardDetails(), $user);

        return ApiResponse::success(
            new RateCardResource($card->load($this->versionsFor($user))),
            'Rate card updated.',
        );
    }

    public function show(RateCard $rateCard): JsonResponse
    {
        $this->authorize('view', $rateCard);

        /** @var User $user */
        $user = request()->user();

        return ApiResponse::success(new RateCardResource($rateCard->load($this->versionsFor($user))));
    }

    /**
     * The versions eager-load, made actor-aware — **`forActor()` does not
     * reach into a relation.**
     *
     * `RateCardVersion` carries `BelongsToTenant` too, so the nested load runs
     * its own query with its own global `TenantScope`, and that scope fails
     * closed for an actor with no tenant. Scoping the *parent* correctly and
     * then loading `versions` plainly therefore produced the second half of
     * the same bug: platform staff got the list of cards and every one of them
     * came back with zero versions, rendering as **"This card has no versions
     * and cannot price a trip"** on a tariff holding two.
     *
     * That reading is worse than the empty list it replaced. An empty list
     * says "nothing here"; this says a specific, false, alarming thing about a
     * card that *is* pricing live trips — and it sits directly under a "New
     * version" button, inviting somebody to add a third version to fix a
     * problem that does not exist.
     *
     * `RateCardService::nextVersionNumber()` documents the same trap from the
     * write side, in as many words: *"`forActor()`, not `$card->versions()`.
     * The plain relation carries the global `TenantScope`."* Same relation,
     * same scope, same actor — it simply had not been applied on the read
     * side.
     *
     * **The whole chain needs it, not just `versions`.** `RateCardRate` and
     * `RateCardZoneRate` both extend `PricedRate`, and the trait is declared
     * on that abstract parent — so grepping either model for
     * `BelongsToTenant` finds nothing while both are fully tenant-scoped. That
     * is worth knowing before trusting a search here: fixing only `versions`
     * moved the symptom from "no versions" to "a version priced at nothing",
     * which is the worse of the two because it looks like data rather than
     * like an error.
     *
     * `Zone` is the one link that genuinely is not scoped, and says so in its
     * own docblock — it carries a nullable `tenant_id` and deliberately does
     * not use the trait. So the chain stops there.
     *
     * @return array<string, \Closure>
     */
    private function versionsFor(User $user): array
    {
        $forActor = fn ($query) => $query->forActor($user);

        return [
            'versions' => fn ($query) => $query->forActor($user)->with([
                'rates' => fn ($rates) => $rates->forActor($user)->with([
                    // `zone` is not tenant-scoped and needs no closure.
                    'zoneRates' => fn ($zoneRates) => $forActor($zoneRates)->with('zone'),
                ]),
            ]),
        ];
    }

    public function store(StoreRateCardRequest $request): JsonResponse
    {
        $this->authorize('create', RateCard::class);

        /** @var User $user */
        $user = $request->user();

        $card = $this->rateCards->create($request->cardData(), $user);

        return ApiResponse::success(
            new RateCardResource($card->load('versions.rates.zoneRates.zone')),
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
            new RateCardResource($card->load('versions.rates.zoneRates.zone')),
            'Default rate card updated.',
        );
    }
}
