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
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Models\DriverLedgerEntry;
use Modules\Drivers\Resources\DriverLedgerEntryResource;
use Modules\Drivers\Services\DriverEarningsService;

/**
 * A driver's own wallet statement — the ledger, row by row.
 *
 * The gap ADR-0029 left open and two screens have now named: the ledger was
 * the record of what a driver is owed and **nothing exposed it**. `/me/stats`
 * served the balance as a single number and `/me/earnings` served aggregates;
 * neither could answer "why is my balance that?", which is the only question
 * a driver actually has about it.
 *
 * Under `/me` like `me/stats`, `me/earnings` and `me/duty`, and for the same
 * reason: **the driver is the token.** There is no id in the path, so there is
 * no cross-driver read to authorise and no way to spell one. An office-side
 * `drivers/{driver}/ledger-entries` would need a policy; this does not, and
 * the difference is exactly that path parameter.
 *
 * **Read-only, and that is the whole surface.** ADR-0029 §6 is explicit that
 * the platform records money moving rather than moving it: no gateway, no
 * payout, no top-up. There is deliberately no `store` here, and a driver
 * cannot write a `settlement` — those are the office's to write, from a
 * console screen that does not exist yet either.
 */
class DriverLedgerController extends Controller
{
    /** The house page size — `TripEventController` and `TripController` both use it. */
    private const PER_PAGE = 25;

    /**
     * Injected only for its timezone.
     *
     * `DriverEarningsService::timezone()` is the one place that resolves
     * `settings.regional.timezone`, and reading it a second time here is how
     * two surfaces start disagreeing about which day a row belongs to.
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

        /** @var array{from?: string, to?: string} $filters */
        $filters = $request->validate([
            // Dates, not timestamps — a driver picks a day, not an instant.
            'from' => ['sometimes', 'date_format:Y-m-d'],
            'to' => ['sometimes', 'date_format:Y-m-d', 'after_or_equal:from'],
        ]);

        $timezone = $this->earnings->timezone();

        // Pulled out rather than read inside the closures below: `isset()` on
        // an optional array offset does not narrow the type for a later read
        // of the same offset, and Larastan is right that the second access
        // could in principle see something different.
        $from = $filters['from'] ?? null;
        $to = $filters['to'] ?? null;

        $paginator = DriverLedgerEntry::query()
            ->where('driver_id', $driver->getKey())
            // **Both boundaries are the driver's local day, converted to UTC
            // before binding.** Two rules from the earnings work apply here
            // unchanged: `config/app.php` is UTC, so an unconverted day
            // boundary rolls a Kampala driver's day at 03:00 local; and
            // Laravel *formats* a bound Carbon in its own zone rather than
            // converting it, so the conversion has to be explicit or the
            // window silently moves three hours.
            ->when(
                $from !== null,
                fn ($query) => $query->where(
                    'created_at',
                    '>=',
                    CarbonImmutable::parse((string) $from, $timezone)->startOfDay()->utc(),
                ),
            )
            // `to` is inclusive of the day the driver picked, so the window
            // ends at the *start of the next* day. Anyone picking "15 August"
            // means the whole of it, and an exclusive bound at 00:00 on the
            // 15th would return nothing at all.
            ->when(
                $to !== null,
                fn ($query) => $query->where(
                    'created_at',
                    '<',
                    CarbonImmutable::parse((string) $to, $timezone)->startOfDay()->addDay()->utc(),
                ),
            )
            // Newest first — a statement is read from the top, and the row a
            // driver is looking for is almost always the one that just
            // appeared. **`id`, not `created_at`**: the pair written at
            // completion shares a timestamp to the second, so ordering on the
            // timestamp alone leaves their order undefined and a cursor over
            // it can skip or repeat one across a page boundary.
            ->orderByDesc('id')
            ->cursorPaginate(self::PER_PAGE);

        $entries = $paginator->getCollection();

        // Built explicitly rather than by `pluck()->filter()->all()`, which
        // Larastan cannot narrow to a list of ints — and it is right not to:
        // `filter()` preserves keys, so the result is not a list at all.
        $tripIds = [];

        foreach ($entries as $entry) {
            if ($entry->trip_id !== null) {
                $tripIds[(int) $entry->trip_id] = true;
            }
        }

        $serviceTypes = $this->serviceTypesFor(array_keys($tripIds));

        return ApiResponse::success(
            $entries->map(fn (DriverLedgerEntry $entry) => new DriverLedgerEntryResource(
                $entry,
                $serviceTypes,
            )),
            meta: ['cursor' => ['next' => $paginator->nextCursor()?->encode()]],
        );
    }

    /**
     * Which of this page's trips were rides and which deliveries.
     *
     * **One query for the page, and through the query builder rather than
     * Eloquent.** Two reasons, and neither is style:
     *
     * - `Trip` is `BelongsToTenant`, and `TenantScope` fails closed — with no
     *   tenant bound it appends `1 = 0` rather than risk leaking across
     *   tenants. A driver on a walk-in has no tenant context, so
     *   `->with('trip.orderRequest')` resolves to null for every row, and
     *   does it silently. That cost the first draft of this endpoint a test.
     * - `order_requests.trip_id` is a nullable foreign key with **no unique
     *   constraint** — the `hasOne` is a model convention, not a database
     *   guarantee — so a join could multiply a row. Keying by trip cannot,
     *   and nothing about the money depends on this map anyway.
     *
     * Same shape as `DriverEarningsService::serviceTypesFor()`, deliberately:
     * one join, described once, done the same way in both places.
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
}
