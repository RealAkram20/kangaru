<?php

namespace Modules\Drivers\Controllers;

use App\Enums\ErrorCode;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Modules\Drivers\Enums\LedgerEntryKind;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Resources\DriverTripResource;
use Modules\Drivers\Services\DriverEarningsService;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;

/**
 * A driver's own trip history — the work that is over, newest first.
 *
 * The third `/me` read in this module, and it sits beside the other two
 * deliberately. `/me/earnings` answers *how much*, `/me/ledger-entries`
 * answers *why is my balance that*, and this answers **what did I actually
 * do**. All three are read-only, all three are keyed off the token, and none
 * of them has an id in the path — **the driver is the token**, so the
 * narrowing is the authorization and there is no policy to get wrong.
 *
 * ## Why this is not `GET /trips` with a filter
 *
 * `TripController::index` is the dispatch board. It serves `TripResource`,
 * which cannot carry either of the two facts this screen turns on:
 *
 * - **`service_type`**, which the All / Rides / Deliveries filter runs on. It
 *   lives on `order_requests`, and `TripResource` never joins it.
 * - **The driver's own share of the fare.** `TripResource::driverEarningsFor()`
 *   returns null on any list, because it reads the `ledgerEntries` relation and
 *   that is unbounded per row — its own docblock names `index()` as the reason.
 *
 * Both are answerable in **one extra query each, keyed by trip id**, which is
 * the shape `DriverLedgerController::serviceTypesFor()` already established.
 * Doing that inside `TripResource` would mean a constructor argument on a
 * class the console, the customer app and three other agents' fields all
 * share.
 *
 * ## The tenant scope, which is the trap in this module
 *
 * `Trip` is `BelongsToTenant` and `TenantScope` **fails closed**: with no
 * tenant bound it appends `1 = 0`, and with one bound it appends
 * `tenant_id = X`, which excludes every walk-in — a walk-in's `tenant_id` is
 * null by definition. A driver's own work is mostly walk-ins, so the obvious
 * `Trip::query()->where('driver_id', …)` returns a plausible, silently
 * incomplete list. `Trip::forDriver()` is the named opt-out, written for this
 * and documented on the model beside `forCustomer`, which exists for the same
 * reason on the customer side.
 */
class DriverTripHistoryController extends Controller
{
    /** The house page size — `TripController` and `DriverLedgerController` both use it. */
    private const PER_PAGE = 25;

    /**
     * The statuses a driver's history is made of: every state in which their
     * involvement is over, one way or another.
     *
     * **Cancelled, no-show and rejected are in it on purpose.** The owner
     * ruled on this before the screen was built: a driver who drove to a
     * pickup and was cancelled on has spent forty minutes, and nothing
     * anywhere else in the app lists that trip. Those rows carry `—` where
     * the money goes and their status in words — never `UGX 0`, which reads
     * as a job done for free.
     *
     * The live statuses are absent because each already has a screen that
     * owns it (`docs/agent-worklog.md` holds that map), and `assigned` is
     * absent because an unanswered offer has not happened yet.
     */
    private const HISTORY_STATUSES = [
        TripStatus::TRIP_COMPLETED,
        TripStatus::INVOICE_GENERATED,
        TripStatus::DISPUTED,
        TripStatus::CLOSED,
        TripStatus::NO_SHOW,
        TripStatus::CANCELLED,
        TripStatus::REJECTED,
    ];

    /**
     * Injected only for its timezone.
     *
     * `DriverEarningsService::timezone()` is the one place that resolves
     * `settings.regional.timezone`, and reading the setting a second time here
     * is how two surfaces start disagreeing about which day a trip belongs to
     * — on a screen whose headings are "Today" and "Yesterday".
     */
    public function __construct(private readonly DriverEarningsService $earnings) {}

    public function index(Request $request): JsonResponse
    {
        /** @var User $user */
        $user = $request->user();

        $driver = Driver::query()->where('user_id', $user->id)->first();

        if ($driver === null) {
            return ApiResponse::error(
                ErrorCode::NOT_A_DRIVER,
                'This account is not linked to a driver profile.',
                [],
                403,
            );
        }

        /** @var array{service_type?: string} $filters */
        $filters = $request->validate([
            // Not an enum rule. `order_requests.service_type` is a
            // `string(20)` fed partly by a public form, so the set can grow
            // without a migration; a hard enum here would 422 on a service
            // the platform had legitimately started offering.
            'service_type' => ['sometimes', 'string', 'max:20'],
        ]);

        $serviceType = $filters['service_type'] ?? null;

        $paginator = Trip::forDriver($driver)
            ->whereIn('status', array_map(
                fn (TripStatus $status) => $status->value,
                self::HISTORY_STATUSES,
            ))
            // The filter runs in SQL, not over a loaded page. The list is
            // cursor-paginated, so filtering twenty-five loaded rows down to
            // three and calling it "Rides" would be a lie about the whole
            // history rather than a view of it.
            //
            // A subquery rather than a join: `order_requests.trip_id` is
            // nullable with no unique constraint, so a join can multiply a
            // row — the fan-out `DriverEarningsService` documents. `whereIn`
            // over a subquery cannot, whatever the data does.
            ->when(
                $serviceType !== null,
                fn ($query) => $query->whereIn(
                    'trips.id',
                    DB::table('order_requests')
                        ->select('trip_id')
                        ->whereNotNull('trip_id')
                        ->where('service_type', $serviceType),
                ),
            )
            // **`id`, not a timestamp.** A cursor needs a unique, indexed
            // ordering: `completed_at` is null on every cancelled trip (which
            // MySQL sorts to the end of a DESC list, burying them) and is
            // shared to the second by trips completed together. `id`
            // descending is stable and cannot skip or repeat a row across a
            // page boundary.
            //
            // Within a day the app re-sorts by `happened_at` before drawing
            // the section, so the visible order is the one a driver expects
            // even where dispatch order and completion order differ.
            ->orderByDesc('id')
            ->cursorPaginate(self::PER_PAGE);

        $trips = $paginator->getCollection();

        $tripIds = [];

        foreach ($trips as $trip) {
            $tripIds[(int) $trip->getKey()] = true;
        }

        $ids = array_keys($tripIds);
        $timezone = $this->earnings->timezone();
        $today = CarbonImmutable::now($timezone);

        // Both resolved **once for the page**, above the map rather than
        // inside it. Reading them per row is the N+1 AGENTS.md forbids, and
        // it is the exact shape that hides best: the payload is identical
        // either way, so nothing on screen tells you the page cost fifty-one
        // queries instead of three.
        $serviceTypes = $this->serviceTypesFor($ids);
        $earnings = $this->earningsFor($driver, $ids);

        return ApiResponse::success(
            $trips->map(fn (Trip $trip) => new DriverTripResource(
                $trip,
                $serviceTypes,
                $earnings,
                $timezone,
            )),
            meta: [
                'cursor' => ['next' => $paginator->nextCursor()?->encode()],
                // Served rather than assumed, so the app labels a section
                // "Today" against the *fleet's* day and not the handset's. A
                // driver near a border must not see their history reshuffle.
                'timezone' => $timezone,
                'today' => $today->format('Y-m-d'),
                'yesterday' => $today->subDay()->format('Y-m-d'),
            ],
        );
    }

    /**
     * Which of this page's trips were rides and which deliveries.
     *
     * One query for the page, through the query builder, for the two reasons
     * `DriverLedgerController::serviceTypesFor()` sets out at length: the
     * tenant scope fails closed on an eager-loaded `orderRequest`, and
     * `order_requests.trip_id` has no unique constraint so a join could
     * multiply a row.
     *
     * **Nothing from `order_requests.details` is read.** That column carries
     * `sender_phone` and `recipient_phone`, which ADR-0024 §7 withholds;
     * `service_type` is a real column beside it, not a key inside it, so this
     * never goes near the JSON.
     *
     * @param  list<int>  $tripIds
     * @return array<int, string>
     */
    private function serviceTypesFor(array $tripIds): array
    {
        if ($tripIds === []) {
            return [];
        }

        $rows = DB::table('order_requests')
            ->select(['trip_id', 'service_type'])
            ->whereIn('trip_id', $tripIds)
            ->get();

        $types = [];

        foreach ($rows as $row) {
            /** @var object{trip_id: int, service_type: string} $row */
            $types[(int) $row->trip_id] = (string) $row->service_type;
        }

        return $types;
    }

    /**
     * What the driver made on each of this page's trips.
     *
     * `FARE_EARNED` only, and **the `kind` predicate is the load-bearing
     * one.** The ledger writes a *pair* at completion — a positive
     * `fare_earned` and a negative `cash_collected` for the gross the driver
     * is holding (ADR-0029 §2) — so a join that took both would report a
     * finished ride as roughly minus the commission. That is the same rule
     * `DriverEarningsService::entries()` follows, which is what makes this
     * screen and the earnings screen agree.
     *
     * **`driver_id` is defence in depth here, not a guard**, and saying so is
     * more useful than implying otherwise: the trip ids all come from
     * `Trip::forDriver()`, and `driver_ledger_entries` carries a unique index
     * on `(trip_id, kind)`, so no second driver's `fare_earned` row for one
     * of these trips can exist to be picked up. A test set out to prove that
     * predicate bites, could not, and is written up in the suite rather than
     * quietly deleted.
     *
     * `cash_collected` is deliberately not summed in: it is the negative
     * counterpart that makes the *wallet balance* work (ADR-0029 §2), and
     * adding it here would report a completed ride as roughly minus the
     * commission. That is the same rule `DriverEarningsService::entries()`
     * follows, so this screen and the earnings screen agree.
     *
     * @param  list<int>  $tripIds
     * @return array<int, array{amount_minor: int, currency: string}>
     */
    private function earningsFor(Driver $driver, array $tripIds): array
    {
        if ($tripIds === []) {
            return [];
        }

        $rows = DB::table('driver_ledger_entries')
            ->select(['trip_id', 'amount_minor', 'currency'])
            ->where('driver_id', $driver->getKey())
            ->where('kind', LedgerEntryKind::FARE_EARNED->value)
            ->whereIn('trip_id', $tripIds)
            ->get();

        $earnings = [];

        foreach ($rows as $row) {
            /** @var object{trip_id: int, amount_minor: int|string, currency: string|null} $row */
            $earnings[(int) $row->trip_id] = [
                'amount_minor' => (int) $row->amount_minor,
                'currency' => (string) ($row->currency ?? ''),
            ];
        }

        return $earnings;
    }
}
