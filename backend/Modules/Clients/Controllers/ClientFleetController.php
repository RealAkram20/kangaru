<?php

namespace Modules\Clients\Controllers;

use App\Http\Controllers\Controller;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Modules\Clients\Models\Company;
use Modules\Clients\Requests\SetClientFleetsRequest;
use Modules\Clients\Resources\CompanyResource;
use Modules\Clients\Services\ClientFleetAssignment;

/**
 * Which fleets serve a corporate client (ADR-0060, ADR-0062, owner 24 Aug).
 *
 * ## Its own controller, and not a field on `PATCH /companies/{company}`
 *
 * Editing a client's legal name and re-sourcing its transport are different
 * acts with different consequences, and only one of them can strand a client
 * with nobody to dispatch its trips. Folding the set into the profile PATCH
 * would mean every form that touches a client's city carries the power to end
 * a commercial relationship, and a partial write of that request would be a
 * half-answered question about who serves whom.
 *
 * It is also what keeps `CompanyPolicy::update` honest: a Corporate Admin
 * holds `companies.update` for their own organisation's profile, and must not
 * inherit the right to re-source themselves onto a fleet that never agreed.
 */
class ClientFleetController extends Controller
{
    public function __construct(private readonly ClientFleetAssignment $fleets) {}

    public function update(SetClientFleetsRequest $request, Company $company): JsonResponse
    {
        $this->authorize('assignFleets', $company);

        /** @var list<int> $ids */
        $ids = array_map('intval', $request->validated()['operator_ids']);

        $this->fleets->set($company, $ids);

        return ApiResponse::success(
            // `refresh()` rather than `fresh()`: the latter returns a new
            // instance or **null** if the row has gone, and the analyser is
            // right that nothing here would notice. `refresh()` reloads in
            // place and returns `$this`, so the response is the client that
            // was just written rather than a nullable maybe.
            new CompanyResource($company->refresh()->load('contracts.operator')),
            'Fleets updated.',
        );
    }
}
