<?php

namespace Modules\Customers\Controllers;

use App\Enums\ErrorCode;
use App\Http\Controllers\Controller;
use App\Models\Customer;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Modules\Administration\Services\InvalidCredentialsException;
use Modules\Customers\Requests\CustomerLoginRequest;
use Modules\Customers\Requests\RegisterCustomerRequest;
use Modules\Customers\Resources\CustomerResource;
use Modules\Customers\Services\CustomerAuthService;

/**
 * Customer sign-up and sign-in (ADR-0013 §3). The customer counterpart of
 * Administration's AuthController, minus everything role-shaped: no MFA,
 * no enrolment states, no permissions — a customer token opens the
 * `/customer/*` surface and nothing else (§2).
 */
class CustomerAuthController extends Controller
{
    public function __construct(private readonly CustomerAuthService $auth) {}

    public function register(RegisterCustomerRequest $request): JsonResponse
    {
        $result = $this->auth->register($request->validated());

        return ApiResponse::success([
            'customer' => new CustomerResource($result['customer']),
            'token' => $result['token'],
        ], 'Account created. Welcome to KangaruRide!', 201);
    }

    public function login(CustomerLoginRequest $request): JsonResponse
    {
        try {
            $result = $this->auth->login(
                $request->validated('email'),
                $request->validated('password'),
            );
        } catch (InvalidCredentialsException) {
            return ApiResponse::error(
                ErrorCode::INVALID_CREDENTIALS,
                'The email or password you entered is incorrect.',
                [],
                401,
            );
        }

        return ApiResponse::success([
            'customer' => new CustomerResource($result['customer']),
            'token' => $result['token'],
        ], 'Logged in successfully.');
    }

    public function logout(Request $request): JsonResponse
    {
        /** @var Customer $customer */
        $customer = $request->user('customer');

        $this->auth->logout($customer);

        return ApiResponse::success(message: 'Logged out successfully.');
    }

    public function me(Request $request): JsonResponse
    {
        return ApiResponse::success(new CustomerResource($request->user('customer')));
    }
}
