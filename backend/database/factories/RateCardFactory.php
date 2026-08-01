<?php

namespace Database\Factories;

use App\Models\Tenant;
use Illuminate\Database\Eloquent\Factories\Factory;
use Modules\Billing\Enums\RateCardStatus;
use Modules\Billing\Models\RateCard;

/**
 * Builds the card only — never a version, and never a rate.
 *
 * A card with prices is a priced contract, and the only thing allowed to
 * create one is Modules\Billing\Services\RateCardService: it allocates the
 * version number under a lock and seals versions once used. A factory that
 * wrote `rate_card_versions` rows directly would produce version histories
 * no service could have produced, and tests built on them would prove
 * nothing about the code that actually runs.
 *
 * Tests that need priced cards use Tests\Support\BillingFixtures, which
 * goes through the service.
 *
 * @extends Factory<RateCard>
 */
class RateCardFactory extends Factory
{
    protected $model = RateCard::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'tenant_id' => Tenant::factory(),
            // Unique globally rather than per tenant: `name` is unique per
            // tenant, and a globally unique value satisfies that under every
            // tenant arrangement a test can build (same reasoning as
            // VehicleFactory::$registration_number).
            'name' => 'Rate card '.fake()->unique()->numerify('####'),
            'description' => null,
            'status' => RateCardStatus::ACTIVE,
            'is_default' => false,
        ];
    }

    public function forTenant(Tenant $tenant): static
    {
        return $this->state(fn (array $attributes) => ['tenant_id' => $tenant->id]);
    }
}
