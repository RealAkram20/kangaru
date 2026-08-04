<?php

namespace Modules\Customers\Services;

use App\Models\Customer;
use Illuminate\Support\Facades\Hash;
use Modules\Administration\Services\InvalidCredentialsException;

/**
 * Customer registration and login (ADR-0013 §3). Deliberately much
 * smaller than the staff AuthService: no MFA, no challenges, no
 * suspension state — a customer either proves a credential or does not.
 *
 * Reuses Administration's InvalidCredentialsException rather than minting
 * a twin: the controller maps it to the same single 401 message for a
 * wrong password and an unknown email alike, because which of the two it
 * was is exactly what a credential-stuffing run wants to learn.
 */
class CustomerAuthService
{
    /**
     * @param  array<string, mixed>  $attributes  RegisterCustomerRequest::validated()
     * @return array{customer: Customer, token: string}
     */
    public function register(array $attributes): array
    {
        // The `hashed` cast on the model does the hashing; what this
        // service guarantees is ADR-0013 §1's invariant — a row created
        // here always holds a credential.
        $customer = Customer::query()->create($attributes);

        return [
            'customer' => $customer,
            'token' => $customer->createToken('customer')->plainTextToken,
        ];
    }

    /**
     * @return array{customer: Customer, token: string}
     *
     * @throws InvalidCredentialsException
     */
    public function login(string $email, string $password): array
    {
        $customer = Customer::query()->where('email', $email)->first();

        // A Google-only account has a null password hash; Hash::check
        // against null must read as a wrong password, not a crash, so it
        // is guarded here. The message stays identical for every branch.
        if (! $customer || $customer->password === null || ! Hash::check($password, $customer->password)) {
            throw new InvalidCredentialsException;
        }

        return [
            'customer' => $customer,
            'token' => $customer->createToken('customer')->plainTextToken,
        ];
    }

    public function logout(Customer $customer): void
    {
        $customer->currentAccessToken()->delete();
    }
}
