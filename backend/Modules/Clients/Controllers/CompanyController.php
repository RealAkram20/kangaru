<?php

namespace Modules\Clients\Controllers;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Modules\Clients\Models\Company;
use Modules\Clients\Requests\StoreCompanyRequest;
use Modules\Clients\Requests\UpdateCompanyRequest;
use Modules\Clients\Resources\CompanyResource;
use Modules\Clients\Services\CompanyService;

class CompanyController extends Controller
{
    public function __construct(private readonly CompanyService $companies) {}

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

    public function store(StoreCompanyRequest $request): JsonResponse
    {
        $this->authorize('create', Company::class);

        $company = $this->companies->create($request);

        return ApiResponse::success(new CompanyResource($company), 'Company created.', 201);
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
