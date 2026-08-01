<?php

use App\Enums\UserRole;
use App\Models\User;
use Illuminate\Testing\TestResponse;
use Modules\Billing\Models\Invoice;
use Modules\Billing\Models\RateCard;
use Modules\Trips\Models\Trip;
use Tests\Support\BillingFixtures;

/**
 * Who may move money.
 *
 * AGENTS.md Security: "MFA is required for Super Admin and Finance roles in
 * Phase 1 — these roles can move money and change rates." That sentence
 * defines the boundary these tests pin down: issuing an invoice, crediting
 * one, and setting prices are Super Admin and Finance only. Everyone else
 * either reads or is refused.
 *
 * MFA itself is not built (a known PROJECT.md gap), so today these roles are
 * protected by password alone. The authorization boundary is still the
 * right one, and is what MFA will sit on top of.
 */

/**
 * @return array<string, mixed>
 */
function billingRoleFixture(): array
{
    $fixture = BillingFixtures::tenantWithRateCard();

    $tenant = $fixture['tenant'];

    $roles = [];
    foreach ([
        UserRole::SUPER_ADMIN, UserRole::OPERATIONS_MANAGER, UserRole::CORPORATE_ADMIN,
        UserRole::CORPORATE_EMPLOYEE, UserRole::DRIVER,
    ] as $role) {
        $roles[$role->value] = User::factory()->create(['tenant_id' => $tenant->id, 'role' => $role]);
    }

    $trip = BillingFixtures::completedTrip(
        $tenant, $fixture['dispatcher'], $fixture['vehicle'], $fixture['driver'],
    );

    return [...$fixture, 'roles' => $roles, 'trip' => $trip];
}

function attemptInvoice(User $actor, Trip $trip, string $key): TestResponse
{
    return test()->withHeader('Idempotency-Key', $key)
        ->actingAs($actor, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/invoice");
}

it('lets only Finance and Super Admin issue an invoice', function () {
    ['finance' => $finance, 'dispatcher' => $dispatcher, 'roles' => $roles, 'trip' => $trip] = billingRoleFixture();

    // The dispatcher drove this trip all the way to Trip Completed and
    // still cannot price it. That separation is deliberate: the person who
    // records what happened should not be the person who bills for it.
    foreach ([
        $dispatcher,
        $roles[UserRole::OPERATIONS_MANAGER->value],
        $roles[UserRole::CORPORATE_ADMIN->value],
        $roles[UserRole::CORPORATE_EMPLOYEE->value],
        $roles[UserRole::DRIVER->value],
    ] as $user) {
        attemptInvoice($user, $trip, 'idem-policy-denied-1')
            ->assertForbidden()
            ->assertJsonPath('code', 'FORBIDDEN');
    }

    expect(Invoice::count())->toBe(0);

    attemptInvoice($roles[UserRole::SUPER_ADMIN->value], $trip, 'idem-policy-allowed1')
        ->assertStatus(201);

    expect(Invoice::count())->toBe(1);

    // And Finance on a second trip, so both permitted roles are proven
    // rather than assumed from one.
    ['finance' => $finance2, 'trip' => $trip2] = billingRoleFixture();
    attemptInvoice($finance2, $trip2, 'idem-policy-allowed2')->assertStatus(201);
});

it('lets only Finance and Super Admin issue a credit note', function () {
    ['finance' => $finance, 'dispatcher' => $dispatcher, 'roles' => $roles, 'trip' => $trip] = billingRoleFixture();

    attemptInvoice($finance, $trip, 'idem-policy-credit01')->assertStatus(201);
    $invoice = Invoice::firstOrFail();

    $body = [
        'reason' => 'Attempted correction.',
        'lines' => [['description' => 'Credit', 'amount_minor' => 1_000]],
    ];

    foreach ([$dispatcher, $roles[UserRole::OPERATIONS_MANAGER->value], $roles[UserRole::CORPORATE_ADMIN->value]] as $user) {
        $this->withHeader('Idempotency-Key', 'idem-policy-cn-deny1')
            ->actingAs($user, 'sanctum')
            ->postJson("/api/v1/invoices/{$invoice->uuid}/credit-notes", $body)
            ->assertForbidden();
    }

    $this->withHeader('Idempotency-Key', 'idem-policy-cn-ok001')
        ->actingAs($finance, 'sanctum')
        ->postJson("/api/v1/invoices/{$invoice->uuid}/credit-notes", $body)
        ->assertStatus(201);
});

it('lets Operations and Corporate Admin read invoices but not create them', function () {
    ['finance' => $finance, 'roles' => $roles, 'trip' => $trip] = billingRoleFixture();

    attemptInvoice($finance, $trip, 'idem-policy-read0001')->assertStatus(201);
    $invoice = Invoice::firstOrFail();

    // Both need to see what was billed — a Corporate Admin is the client
    // being billed, and hiding it invites the disputes this module exists
    // to prevent. TenantScope keeps "what was billed" to their own tenant.
    foreach ([$roles[UserRole::OPERATIONS_MANAGER->value], $roles[UserRole::CORPORATE_ADMIN->value]] as $user) {
        $this->actingAs($user, 'sanctum')->getJson('/api/v1/invoices')->assertOk();
        $this->actingAs($user, 'sanctum')->getJson("/api/v1/invoices/{$invoice->uuid}")->assertOk();
    }
});

it('shows a driver and a corporate employee no invoices at all', function () {
    ['finance' => $finance, 'roles' => $roles, 'trip' => $trip] = billingRoleFixture();

    attemptInvoice($finance, $trip, 'idem-policy-hidden01')->assertStatus(201);
    $invoice = Invoice::firstOrFail();

    // A driver has no business knowing the client's contracted rates, and
    // an employee who books transport is not the person who pays for it.
    foreach ([$roles[UserRole::DRIVER->value], $roles[UserRole::CORPORATE_EMPLOYEE->value]] as $user) {
        $this->actingAs($user, 'sanctum')->getJson('/api/v1/invoices')->assertForbidden();
        $this->actingAs($user, 'sanctum')->getJson("/api/v1/invoices/{$invoice->uuid}")->assertForbidden();
        $this->actingAs($user, 'sanctum')->getJson('/api/v1/rate-cards')->assertForbidden();
    }
});

it('lets Operations read rate cards but never set a price', function () {
    ['card' => $card, 'roles' => $roles] = billingRoleFixture();

    $operations = $roles[UserRole::OPERATIONS_MANAGER->value];

    $this->actingAs($operations, 'sanctum')->getJson('/api/v1/rate-cards')->assertOk();

    // Running the fleet is not the same as pricing it.
    $this->actingAs($operations, 'sanctum')->postJson('/api/v1/rate-cards', [
        'name' => 'Operations attempt',
        'version' => [
            'effective_from' => '2026-01-01',
            'rates' => [['vehicle_category' => 'sedan', 'base_fare_minor' => 1]],
        ],
    ])->assertForbidden();

    $this->actingAs($operations, 'sanctum')
        ->postJson("/api/v1/rate-cards/{$card->id}/versions", [
            'effective_from' => '2026-01-01',
            'rates' => [['vehicle_category' => 'sedan', 'base_fare_minor' => 1]],
        ])->assertForbidden();

    $this->actingAs($operations, 'sanctum')
        ->putJson("/api/v1/rate-cards/{$card->id}/default")
        ->assertForbidden();

    expect(RateCard::count())->toBe(1);
    expect($card->fresh()->versions()->count())->toBe(1);
});

it('rejects an unauthenticated request to every billing endpoint', function () {
    ['card' => $card, 'trip' => $trip] = billingRoleFixture();

    foreach ([
        ['getJson', '/api/v1/rate-cards'],
        ['getJson', "/api/v1/rate-cards/{$card->id}"],
        ['getJson', '/api/v1/invoices'],
        ['postJson', "/api/v1/trips/{$trip->id}/invoice"],
    ] as [$method, $uri]) {
        $this->{$method}($uri)
            ->assertStatus(401)
            ->assertJsonPath('code', 'UNAUTHENTICATED');
    }
});
