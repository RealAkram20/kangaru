<?php

namespace Database\Factories;

use App\Enums\UserRole;
use App\Enums\UserStatus;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use OTPHP\TOTP;

/**
 * @extends Factory<User>
 */
class UserFactory extends Factory
{
    /**
     * The current password being used by the factory.
     */
    protected static ?string $password;

    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'tenant_id' => null,
            'name' => fake()->name(),
            'email' => fake()->unique()->safeEmail(),
            'email_verified_at' => now(),
            'password' => static::$password ??= Hash::make('password'),
            'role' => UserRole::CORPORATE_EMPLOYEE,
            // Set explicitly rather than left to the column default. The
            // default applies on insert, so the in-memory model a factory
            // hands back has no `status` at all — and every read of it
            // (UserResource, User::isActive) then dereferences null. A
            // factory should produce a model indistinguishable from one
            // loaded back out of the database.
            'status' => UserStatus::ACTIVE,
            'remember_token' => Str::random(10),
        ];
    }

    /**
     * Indicate that the model's email address should be unverified.
     */
    public function unverified(): static
    {
        return $this->state(fn (array $attributes) => [
            'email_verified_at' => null,
        ]);
    }

    /**
     * Users whose role requires a second factor are created already
     * enrolled (ADR-0008).
     *
     * This is fidelity, not convenience. Since decision 3 a Super Admin or
     * Finance officer who has not enrolled can reach **nothing but the
     * enrolment endpoints** — so an unenrolled one is not "a Super Admin",
     * it is a Super Admin mid-onboarding, and building every fixture in
     * that state would mean the suite tests a user who cannot do the thing
     * the test is about.
     *
     * The alternative was exempting tests from the middleware, which is the
     * shape of a bypass this ADR rejects elsewhere: a control switched off
     * in the environment that is supposed to prove it works.
     *
     * `notEnrolledInMfa()` is the explicit opt-out, and the forced-enrolment
     * tests use it — the state has to stay reachable or the rule guarding it
     * is untested.
     */
    public function configure(): static
    {
        return $this->afterCreating(function (User $user): void {
            if (! $user->requiresMfa() || $user->hasMfaEnabled()) {
                return;
            }

            $user->forceFill([
                // A real, valid Base32 secret rather than a placeholder, so
                // a test that generates a genuine code against it verifies
                // through the same path production does.
                'mfa_secret' => TOTP::generate()->getSecret(),
                'mfa_confirmed_at' => now(),
            ])->save();
        });
    }

    /**
     * A user in an MFA-required role who has not set one up — the state
     * decision 3 forces out of.
     */
    public function notEnrolledInMfa(): static
    {
        return $this->afterCreating(function (User $user): void {
            $user->forceFill(['mfa_secret' => null, 'mfa_confirmed_at' => null])->save();
        });
    }
}
