<?php

use App\Enums\UserRole;
use App\Models\Customer;
use App\Models\User;
use Modules\Bookings\Models\OrderRequest;

/**
 * ADR-0013 §4: orders link to customers, anonymity survives, and the
 * customer's read surface is scoped by the token — never by a guessable
 * reference or an unscoped id.
 */
function ridePayload(): array
{
    return [
        'service_type' => 'ride',
        'contact_name' => 'Nakato Grace',
        'contact_phone' => '0700123456',
        'pickup_location' => 'Seeta',
        'dropoff_location' => 'Acacia Mall',
    ];
}

it('keeps an anonymous walk-in anonymous', function () {
    $this->postJson('/api/v1/public/order-requests', ridePayload())->assertStatus(201);

    expect(OrderRequest::query()->first()->customer_id)->toBeNull();
});

it('stamps the customer when their token accompanies the public order', function () {
    $customer = Customer::factory()->create();

    $this->withToken($customer->createToken('customer')->plainTextToken)
        ->postJson('/api/v1/public/order-requests', ridePayload())
        ->assertStatus(201);

    expect(OrderRequest::query()->first()->customer_id)->toBe($customer->id);
});

it('stamps nothing for a staff token on the public endpoint', function () {
    $staff = User::factory()->create();

    $this->withToken($staff->createToken('api')->plainTextToken)
        ->postJson('/api/v1/public/order-requests', ridePayload())
        ->assertStatus(201);

    expect(OrderRequest::query()->first()->customer_id)->toBeNull();
});

it('lists only the signed-in customer\'s own requests, newest first', function () {
    $mine = Customer::factory()->create();
    $other = Customer::factory()->create();

    $older = OrderRequest::factory()->create(['customer_id' => $mine->id, 'created_at' => now()->subDay()]);
    $newer = OrderRequest::factory()->create(['customer_id' => $mine->id]);
    OrderRequest::factory()->create(['customer_id' => $other->id]);
    OrderRequest::factory()->create(['customer_id' => null]);

    $response = $this->withToken($mine->createToken('customer')->plainTextToken)
        ->getJson('/api/v1/customer/order-requests')
        ->assertStatus(200)
        ->assertJsonCount(2, 'data.order_requests');

    expect($response->json('data.order_requests.0.id'))->toBe($newer->id)
        ->and($response->json('data.order_requests.1.id'))->toBe($older->id);
});

it('never shows a customer the desk\'s internal fields', function () {
    $customer = Customer::factory()->create();
    OrderRequest::factory()->create([
        'customer_id' => $customer->id,
        'dispatcher_notes' => 'Regular caller, quote the corporate rate',
    ]);

    $item = $this->withToken($customer->createToken('customer')->plainTextToken)
        ->getJson('/api/v1/customer/order-requests')
        ->assertStatus(200)
        ->json('data.order_requests.0');

    // "Walk-ins only see what they need to see": the desk's working
    // notes, the staff assignment and the transition graph are all
    // absent, not merely null.
    expect($item)->not->toHaveKeys(['dispatcher_notes', 'handled_by', 'allowed_transitions', 'contact_phone']);
});

it('answers 404, not 403, for another customer\'s request', function () {
    $mine = Customer::factory()->create();
    $theirs = OrderRequest::factory()->create([
        'customer_id' => Customer::factory()->create()->id,
    ]);

    $this->withToken($mine->createToken('customer')->plainTextToken)
        ->getJson("/api/v1/customer/order-requests/{$theirs->id}")
        ->assertStatus(404);
});

it('shows the customer their own request by id', function () {
    $customer = Customer::factory()->create();
    $request = OrderRequest::factory()->create(['customer_id' => $customer->id]);

    $this->withToken($customer->createToken('customer')->plainTextToken)
        ->getJson("/api/v1/customer/order-requests/{$request->id}")
        ->assertStatus(200)
        ->assertJsonPath('data.order_request.reference', $request->reference);
});

it('shows the dispatch queue who the account holder is, and null for walk-ins', function () {
    $customer = Customer::factory()->create(['name' => 'Nakato Grace']);
    OrderRequest::factory()->create(['customer_id' => $customer->id]);
    OrderRequest::factory()->create(['customer_id' => null]);

    $dispatcher = User::factory()->create(['role' => UserRole::DISPATCHER]);

    $response = $this->actingAs($dispatcher, 'sanctum')
        ->getJson('/api/v1/order-requests')
        ->assertStatus(200)
        ->assertJsonCount(2, 'data.order_requests');

    // ADR-0013 §5: the desk sees the linked account's name — and only
    // its name and id, not the account's email or anything to browse.
    $linked = collect($response->json('data.order_requests'))
        ->firstWhere('customer.name', 'Nakato Grace');
    $anonymous = collect($response->json('data.order_requests'))
        ->firstWhere('customer', null);

    expect($linked)->not->toBeNull()
        ->and($linked['customer'])->toBe(['id' => $customer->id, 'name' => 'Nakato Grace'])
        ->and($anonymous)->not->toBeNull();
});
