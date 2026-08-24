<?php

namespace Modules\Administration\Controllers;

use App\Enums\UserStatus;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use App\Support\Database\SearchTerm;
use Illuminate\Http\JsonResponse;
use Modules\Administration\Requests\ColleagueIndexRequest;
use Modules\Administration\Resources\ColleagueResource;
use Modules\Bookings\Models\Booking;

/**
 * The people you may raise a booking for — your own organisation's staff.
 *
 * ## Why this is not `GET /users`
 *
 * `/users` is staff *administration*: it answers with roles, capabilities,
 * MFA state and suspension history, and it is gated on `staff.view`. The
 * person raising a booking is usually a Corporate Employee, who holds none
 * of that and should not — being able to name a colleague as the passenger
 * is not being able to read the roster's permissions.
 *
 * So this is a separate, deliberately thin endpoint: id, name, number, and
 * nothing else. Gated on `bookings.create`, which is the honest statement
 * of the rule — *you may look up a colleague if you may book a car for
 * one*.
 *
 * ## Why it is a search rather than a list
 *
 * A bank branch network is thousands of accounts. A `<select>` holding all
 * of them is a slow page and an unusable picker, and it hands the whole
 * staff directory to anyone who opens the booking dialog. The query is
 * required, the result is capped, and what comes back is only ever the
 * caller's own tenant.
 */
class ColleagueController extends Controller
{
    /**
     * Enough to choose from, few enough that nobody scrolls a directory out
     * of it one page at a time.
     */
    private const LIMIT = 15;

    public function index(ColleagueIndexRequest $request): JsonResponse
    {
        $this->authorize('create', Booking::class);

        /** @var User $actor */
        $actor = $request->user();

        $term = SearchTerm::contains((string) $request->string('q'));

        $colleagues = User::forActor($actor)
            /*
             * A client's person, never a fleet's own.
             *
             * This used to answer an **empty list** to any platform-level
             * actor, and the reason it gave was sound at the time: *"`forActor`
             * would drop the scope and answer with every client's directory."*
             * It would have. `User::scopeForActor` matched every row with a
             * tenant, for every fleet.
             *
             * That is fixed at the scope rather than papered over here, so a
             * fleet now reaches exactly the clients it holds an active
             * contract with — and the dispatcher taking a call from a bank can
             * name the employee instead of typing a name three people spell
             * three ways. Which was the whole point of the field.
             *
             * The `whereNotNull` is what keeps the original intent: a fleet's
             * **own** staff are not passengers, and offering a dispatcher
             * their own colleagues in a passenger box is an invitation to book
             * a car for the person raising the booking. For head office it is
             * also the whole answer — their scope is Kangaru-level accounts,
             * every one of which has no tenant, so the list is empty without
             * a level check saying so.
             */
            ->whereNotNull('users.tenant_id')
            // Suspended accounts are not offered at all, unlike the staff
            // list which sorts them last. That list is read to administer
            // someone; this one is read to send a car to them.
            ->where('status', UserStatus::ACTIVE->value)
            ->where(fn ($match) => $match->where('name', 'like', $term)->orWhere('email', 'like', $term))
            ->orderBy('name')
            ->limit(self::LIMIT)
            ->get();

        return ApiResponse::success(ColleagueResource::collection($colleagues));
    }
}
