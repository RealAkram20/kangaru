<?php

use App\Support\Money\Shillings;
use Modules\Billing\Models\CreditNote;
use Modules\Billing\Models\Invoice;
use Modules\Billing\Models\RateCard;
use Modules\Vehicles\Models\Vehicle;
use Tests\Support\BillingFixtures;

/**
 * ADR-0001's mandatory, non-skippable isolation proof, for the module where
 * a leak would be worst.
 *
 * On a trip list, a cross-tenant leak shows up as a stray row somebody might
 * notice. Here it shows up as another client's money: their prices, their
 * invoice totals, their disputes. PROJECT.md names this the single worst bug
 * the platform can have, and the anchor client is a bank.
 *
 * AGENTS.md also fixes the shape of the refusal — "404 also masks
 * cross-tenant IDs; never return 403 for another tenant's resource" — so
 * these assert the status code as carefully as the absence of data.
 */

/**
 * Two fully independent tenants, each with a rate card, a completed trip and
 * an issued invoice carrying a credit note.
 *
 * @return array<string, mixed>
 */
function twoBilledTenants(): array
{
    $build = function (string $key) {
        $fixture = BillingFixtures::tenantWithRateCard();

        $trip = BillingFixtures::completedTrip(
            $fixture['tenant'], $fixture['dispatcher'], $fixture['vehicle'], $fixture['driver'],
        );

        test()->withHeader('Idempotency-Key', "idem-isolation-{$key}")
            ->actingAs($fixture['finance'], 'sanctum')
            ->postJson("/api/v1/trips/{$trip->id}/invoice")
            ->assertStatus(201);

        $invoice = Invoice::where('trip_id', $trip->id)->firstOrFail();

        test()->withHeader('Idempotency-Key', "idem-isolation-cn-{$key}")
            ->actingAs($fixture['finance'], 'sanctum')
            ->postJson("/api/v1/invoices/{$invoice->uuid}/credit-notes", [
                'reason' => 'Isolation fixture credit.',
                'lines' => [['description' => 'Credit', 'amount_minor' => 1_000]],
            ])->assertStatus(201);

        return [...$fixture, 'trip' => $trip, 'invoice' => $invoice];
    };

    return ['a' => $build('a'), 'b' => $build('b')];
}

it('excludes another tenant\'s rate cards from the listing', function () {
    ['a' => $a, 'b' => $b] = twoBilledTenants();

    $response = $this->actingAs($a['finance'], 'sanctum')->getJson('/api/v1/rate-cards')->assertOk();

    $ids = collect($response->json('data'))->pluck('id')->all();

    expect($ids)->toContain($a['card']->id);
    expect($ids)->not->toContain($b['card']->id);
});

it('returns 404, not 403, when fetching another tenant\'s rate card', function () {
    ['a' => $a, 'b' => $b] = twoBilledTenants();

    // 403 would confirm the id exists somewhere, which is itself a leak.
    $this->actingAs($a['finance'], 'sanctum')
        ->getJson("/api/v1/rate-cards/{$b['card']->id}")
        ->assertStatus(404)
        ->assertJsonPath('code', 'NOT_FOUND');
});

it('excludes another tenant\'s invoices from the listing', function () {
    ['a' => $a, 'b' => $b] = twoBilledTenants();

    $response = $this->actingAs($a['finance'], 'sanctum')->getJson('/api/v1/invoices')->assertOk();

    $numbers = collect($response->json('data'))->pluck('uuid')->all();

    expect($numbers)->toContain($a['invoice']->uuid);
    expect($numbers)->not->toContain($b['invoice']->uuid);
    // Both tenants' first invoice is numbered ...000001, so asserting on
    // the number alone would pass even with a leak. The uuid is the
    // discriminator, which is why this asserts on that.
    expect($response->json('data'))->toHaveCount(1);
});

it('returns 404 when fetching another tenant\'s invoice by uuid', function () {
    ['a' => $a, 'b' => $b] = twoBilledTenants();

    $this->actingAs($a['finance'], 'sanctum')
        ->getJson("/api/v1/invoices/{$b['invoice']->uuid}")
        ->assertStatus(404)
        ->assertJsonPath('code', 'NOT_FOUND');
});

it('refuses to invoice another tenant\'s trip', function () {
    ['a' => $a, 'b' => $b] = twoBilledTenants();

    $unbilledTrip = BillingFixtures::completedTrip(
        $b['tenant'], $b['dispatcher'],
        Vehicle::factory()->forTenant($b['tenant'])->create(['category' => 'sedan']),
        $b['driver'],
    );

    // Billing another client's journey to your own account would be the
    // worst possible expression of this bug.
    $this->withHeader('Idempotency-Key', 'idem-cross-tenant-01')
        ->actingAs($a['finance'], 'sanctum')
        ->postJson("/api/v1/trips/{$unbilledTrip->id}/invoice")
        ->assertStatus(404);

    expect(Invoice::allTenants()->where('trip_id', $unbilledTrip->id)->count())->toBe(0);
});

it('refuses to credit another tenant\'s invoice', function () {
    ['a' => $a, 'b' => $b] = twoBilledTenants();

    $this->withHeader('Idempotency-Key', 'idem-cross-credit-1')
        ->actingAs($a['finance'], 'sanctum')
        ->postJson("/api/v1/invoices/{$b['invoice']->uuid}/credit-notes", [
            'reason' => 'Should never land.',
            'lines' => [['description' => 'Credit', 'amount_minor' => 1_000]],
        ])
        ->assertStatus(404);

    expect(CreditNote::allTenants()->where('invoice_id', $b['invoice']->id)->count())->toBe(1);
});

it('refuses to price a trip with another tenant\'s rate card', function () {
    ['a' => $a, 'b' => $b] = twoBilledTenants();

    $trip = BillingFixtures::completedTrip(
        $a['tenant'], $a['dispatcher'],
        Vehicle::factory()->forTenant($a['tenant'])->create(['category' => 'sedan']),
        $a['driver'],
    );

    // Naming another client's negotiated prices explicitly. Rejected at
    // validation, because the `exists` rule is scoped to the caller's
    // tenant — 422, since from the caller's perspective the id simply is
    // not a rate card.
    $this->withHeader('Idempotency-Key', 'idem-foreign-card-1')
        ->actingAs($a['finance'], 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/invoice", ['rate_card_id' => $b['card']->id])
        ->assertStatus(422)
        ->assertJsonValidationErrors('rate_card_id');

    expect(Invoice::where('trip_id', $trip->id)->count())->toBe(0);
});

it('hides another tenant\'s billing records at the model level under TenantContext', function () {
    ['a' => $a, 'b' => $b] = twoBilledTenants();

    // Below the HTTP layer entirely: this is TenantScope itself, the thing
    // every one of the assertions above ultimately depends on.
    BillingFixtures::bindTenant($a['tenant']);

    expect(RateCard::find($b['card']->id))->toBeNull();
    expect(Invoice::find($b['invoice']->id))->toBeNull();
    expect(Invoice::count())->toBe(1);
    expect(CreditNote::count())->toBe(1);

    // And the aggregate a leak would inflate invisibly: tenant A's own
    // total, not the sum of both tenants'.
    $total = Invoice::get()->reduce(
        fn ($carry, Invoice $invoice) => $carry->plus($invoice->total()),
        Shillings::zero(),
    );

    expect(Shillings::toMinor($total))->toBe(Shillings::toMinor($a['invoice']->total()));
});
