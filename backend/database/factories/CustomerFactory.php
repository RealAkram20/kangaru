<?php

namespace Database\Factories;

use App\Models\Customer;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Facades\Hash;

/**
 * @extends Factory<Customer>
 */
class CustomerFactory extends Factory
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
            'name' => fake()->name(),
            'phone' => '07'.fake()->numerify('########'),
            'email' => fake()->unique()->safeEmail(),
            'password' => static::$password ??= Hash::make('password'),
            'google_id' => null,
        ];
    }

    /**
     * A customer who only ever signed in with Google (ADR-0013 §3): a
     * `google_id` and no password. The other credential shape the
     * registration service must keep honest.
     */
    public function googleOnly(): static
    {
        return $this->state(fn () => [
            'password' => null,
            'google_id' => fake()->unique()->numerify('####################'),
        ]);
    }
}
