<?php

namespace Modules\Clients\Controllers;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Modules\Clients\Models\Company;
use Modules\Clients\Requests\OnboardClientRequest;
use Modules\Clients\Requests\UpdateCompanyRequest;
use Modules\Clients\Resources\CompanyResource;
use Modules\Clients\Services\ClientOnboardingService;
use Modules\Clients\Services\CompanyService;

class CompanyController extends Controller
{
    public function __construct(
        private readonly CompanyService $companies,
        private readonly ClientOnboardingService $onboarding,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $this->authorize('viewAny', Company::class);

        /** @var User $user */
        $user = $request->user();

        return ApiResponse::success(CompanyResource::collection($this->companies->list($user)));
    }

    public function show(Company $company): JsonResponse
    {
        $this->authorize('view', $company);

        return ApiResponse::success(new CompanyResource($company));
    }

    /**
     * Onboarding a corporate client (ADR-0060, ADR-0062 §3).
     *
     * This used to attach a company profile to a `tenant_id` the caller
     * already had, writing no contract and creating no login — a client served
     * by nobody that nobody could sign into. It now creates the tenant, the
     * company, the contract and the client's first administrator in one
     * transaction, or none of them.
     */
    public function store(OnboardClientRequest $request): JsonResponse
    {
        $this->authorize('create', Company::class);

        $actor = $request->user();

        $company = $this->onboarding->onboard(
            $request->safe()->except('operator_id'),
            $request->contractingOperator(),
            // Named in the invitation email. A stranger asking you to set a
            // password is a phishing email; a colleague's name is something
            // the reader can check.
            //
            // Narrowed rather than passed through. `$request->user()` is
            // `Customer|User|null` across this application's two guards, and
            // only a `User` can be an inviter — a customer reaching this route
            // is refused by the policy above, so the null branch here is the
            // type being honest rather than a case that happens.
            $actor instanceof User ? $actor : null,
        );

        return ApiResponse::success(
            new CompanyResource($company),
            'Client onboarded. Their administrator has been emailed an invitation.',
            201,
        );
    }

    public function update(UpdateCompanyRequest $request, Company $company): JsonResponse
    {
        $this->authorize('update', $company);

        $company = $this->companies->update($company, $request);

        return ApiResponse::success(new CompanyResource($company), 'Company updated.');
    }

    public function destroy(Company $company): JsonResponse
    {
        $this->authorize('delete', $company);

        $this->companies->delete($company);

        return ApiResponse::success(message: 'Company deleted.', status: 204);
    }
}
