<?php

namespace Modules\Clients\Controllers;

use App\Enums\AccessLevel;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Modules\Administration\Resources\UserResource;
use Modules\Clients\Models\Company;

/**
 * Who head office can act as at a corporate client (ADR-0056).
 *
 * The client-side twin of `OperatorAccountController`, and it exists for the
 * same one reason: acting as assumes **a person's identity**. There is no "act
 * as Centenary Bank"; there is "act as Centenary Bank's transport officer", so
 * the Log in as button needs a list of names or it has nothing to send.
 *
 * ## Gated harder than the fleet twin, deliberately
 *
 * `OperatorAccountController` gates on `view` of the fleet, which under
 * `OperatorPolicy` already means head office and nobody else. This one cannot
 * borrow that shape, because `CompanyPolicy::view` is `companies.view` — a
 * permission a **client's own** administrator holds for their own profile. So
 * the gate here is the act-as grant itself, and that is the honest reading of
 * ADR-0062: head office reads the client *directory*, not the client's
 * operations, and a roster of named employees is much closer to the second.
 * The only justification for disclosing it is the one thing it is for.
 *
 * A client administrator who wants their own colleagues has `/users`, correctly
 * scoped to them, and has had it since ADR-0065.
 *
 * ## Client accounts only
 *
 * Filtered on `access_level = client` as well as on the tenant, and the two are
 * the **same set by construction**: the migration behind `AccessLevel::permits()`
 * writes a CHECK constraint that pins a tenant-carrying row to `client`, so a
 * fleet or Kangaru row with this `tenant_id` cannot be inserted at all. The
 * clause guards nothing; it is here so the query says what the endpoint means —
 * "this client's people", not "whoever shares this tenant id" — which is the
 * difference between a reader trusting it and a reader checking the schema.
 */
class ClientAccountController extends Controller
{
    public function index(Company $company): JsonResponse
    {
        $this->authorize('actAsSomebody', $company);

        $accounts = User::query()
            ->where('tenant_id', $company->tenant_id)
            ->where('access_level', AccessLevel::CLIENT)
            ->orderBy('name')
            ->get();

        return ApiResponse::success(UserResource::collection($accounts));
    }
}
