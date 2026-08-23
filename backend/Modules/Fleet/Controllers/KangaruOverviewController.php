<?php

namespace Modules\Fleet\Controllers;

use App\Http\Controllers\Controller;
use App\Models\Customer;
use App\Models\ImpersonationSession;
use App\Models\Operator;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Gate;
use Modules\Drivers\Enums\DriverApplicationStatus;
use Modules\Drivers\Enums\SettlementRequestStatus;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Models\DriverApplication;
use Modules\Drivers\Models\DriverSettlementRequest;
use Modules\Support\Enums\SupportRequestStatus;
use Modules\Support\Models\SupportRequest;
use Modules\Vehicles\Models\Vehicle;

/**
 * What head office sees when it signs in (ADR-0059, `K4`).
 *
 * ## Counts, and deliberately nothing else
 *
 * Every figure here is a **scalar**. There is no list, no row, no name, no
 * identifier of anybody's customer, driver or trip. That is not a
 * simplification — it is the line ADR-0055 §2 draws: *no account in the system
 * can read every fleet's data in one query, including Super Admin.*
 *
 * A count is Kangaru's own business metric and, once plans are priced by size
 * (ADR-0058), a billing input. A list of rows would be the cross-fleet read
 * §2 forbids, and **the difference between the two is one endpoint** —
 * `docs/platform-plan.md` §6 q4 flagged it as very easy to build the wrong one
 * by accident. To look at any of this, act as somebody in the fleet it belongs
 * to.
 *
 * ## Why the queues are here and the operations are not
 *
 * The four queue figures are work only head office can clear — a driver
 * application, a settlement, a report, a fleet still onboarding. Bookings,
 * dispatch and trips are a fleet's, and their absence from this response is
 * the same absence as their removal from the menu.
 */
class KangaruOverviewController extends Controller
{
    public function show(): JsonResponse
    {
        Gate::authorize('viewAny', Operator::class);

        return ApiResponse::success([
            'network' => [
                'fleets' => Operator::query()->count(),
                'fleets_active' => Operator::query()->where('status', 'active')->count(),
                // A count, never a list. See the class docblock: this single
                // integer is the whole of what Kangaru may know about the
                // corporate clients on the platform without acting as a fleet.
                'clients' => Tenant::query()->count(),
                'walk_in_clients' => Customer::query()->count(),
                'drivers' => Driver::query()->count(),
                'vehicles' => Vehicle::query()->count(),
            ],
            'queues' => [
                'driver_applications' => DriverApplication::query()
                    ->where('status', DriverApplicationStatus::PENDING->value)->count(),
                'driver_reports' => SupportRequest::query()
                    ->where('status', SupportRequestStatus::OPEN->value)->count(),
                'settlement_requests' => DriverSettlementRequest::query()
                    ->where('status', SettlementRequestStatus::PENDING->value)->count(),
                // A fleet with no account is unreachable to support for ever
                // (ADR-0059 §5). Onboarding creates one in the same
                // transaction, so this should always be nought — which is
                // exactly why it is worth showing. A number here means the
                // invariant has been broken somewhere.
                'fleets_without_an_account' => Operator::query()
                    ->whereDoesntHave('users')->count(),
            ],
            'governance' => [
                'acting_as_now' => ImpersonationSession::query()->live()->count(),
                'kangaru_staff' => User::query()
                    ->where('access_level', 'kangaru')->count(),
            ],
        ]);
    }
}
