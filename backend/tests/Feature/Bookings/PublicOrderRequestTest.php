<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Support\Facades\Notification;
use Modules\Bookings\Models\OrderRequest;
use Modules\Notifications\Notifications\OrderRequestReceivedNotification;

/**
 * ADR-0012 §3: the public order form. Unauthenticated on purpose, so these
 * tests are the record of what that surface promises: it validates like a
 * tenant endpoint, throttles harder, honeypots bots, and tells the dispatch
 * desk — and nobody else — that work arrived.
 */
function validRidePayload(): array
{
    return [
        'service_type' => 'ride',
        'contact_name' => 'Nakato Grace',
        'contact_phone' => '+256 700 123456',
        'pickup_location' => 'Bukerere Rd, Kampala',
        'dropoff_location' => 'Entebbe International Airport',
        'details' => ['passengers' => 2, 'vehicle_class' => 'standard'],
    ];
}

it('accepts a walk-in ride request and returns a quotable reference', function () {
    $response = $this->postJson('/api/v1/public/order-requests', validRidePayload());

    $response->assertStatus(201);

    $reference = $response->json('data.reference');
    expect($reference)->toMatch('/^KR-[A-Z2-9]{6}$/');

    $stored = OrderRequest::query()->where('reference', $reference)->firstOrFail();
    expect($stored->status->value)->toBe('new')
        ->and($stored->contact_name)->toBe('Nakato Grace')
        ->and($stored->details)->toBe(['passengers' => 2, 'vehicle_class' => 'standard']);
});

it('requires pickup and drop-off for a ride but not for self drive', function () {
    $this->postJson('/api/v1/public/order-requests', [
        'service_type' => 'ride',
        'contact_name' => 'Okello James',
        'contact_phone' => '0700123456',
    ])->assertStatus(422)
        ->assertJsonValidationErrors(['pickup_location', 'dropoff_location']);

    $this->postJson('/api/v1/public/order-requests', [
        'service_type' => 'self_drive',
        'contact_name' => 'Okello James',
        'contact_phone' => '0700123456',
        'details' => [
            'vehicle_category' => 'suv',
            'start_date' => now()->addDays(2)->toDateString(),
            'end_date' => now()->addDays(5)->toDateString(),
        ],
    ])->assertStatus(201);
});

it('rejects a self drive rental that ends before it starts', function () {
    $this->postJson('/api/v1/public/order-requests', [
        'service_type' => 'self_drive',
        'contact_name' => 'Okello James',
        'contact_phone' => '0700123456',
        'details' => [
            'start_date' => now()->addDays(5)->toDateString(),
            'end_date' => now()->addDays(2)->toDateString(),
        ],
    ])->assertStatus(422)->assertJsonValidationErrors(['details.end_date']);
});

it('fake-succeeds and stores nothing when the honeypot is filled', function () {
    $response = $this->postJson('/api/v1/public/order-requests', [
        ...validRidePayload(),
        'website' => 'https://spam.example',
    ]);

    // The bot must not be able to tell it was caught: same status, same
    // shape, a reference that looks as real as anyone's.
    $response->assertStatus(201);
    expect($response->json('data.reference'))->toMatch('/^KR-[A-Z2-9]{6}$/');

    expect(OrderRequest::query()->count())->toBe(0);
});

it('throttles the fourth request from one address inside a minute', function () {
    foreach (range(1, 3) as $i) {
        $this->postJson('/api/v1/public/order-requests', [
            ...validRidePayload(),
            'contact_name' => "Caller {$i}",
        ])->assertStatus(201);
    }

    $this->postJson('/api/v1/public/order-requests', validRidePayload())
        ->assertStatus(429);
});

it('notifies platform staff who hold the permission, and nobody else', function () {
    Notification::fake();

    $platformDispatcher = User::factory()->create(['role' => UserRole::DISPATCHER]);
    $platformFinance = User::factory()->create(['role' => UserRole::FINANCE]);

    $tenant = Tenant::factory()->create();
    $tenantDispatcher = User::factory()->create([
        'tenant_id' => $tenant->id,
        'role' => UserRole::DISPATCHER,
    ]);

    $this->postJson('/api/v1/public/order-requests', validRidePayload())->assertStatus(201);

    Notification::assertSentTo($platformDispatcher, OrderRequestReceivedNotification::class);
    // Finance holds no `order_requests.manage`; the tenant's dispatcher
    // holds the permission but is not platform staff. Both silent.
    Notification::assertNotSentTo($platformFinance, OrderRequestReceivedNotification::class);
    Notification::assertNotSentTo($tenantDispatcher, OrderRequestReceivedNotification::class);
});

it('writes an audit row for the received request', function () {
    $this->postJson('/api/v1/public/order-requests', validRidePayload())->assertStatus(201);

    $request = OrderRequest::query()->firstOrFail();

    $this->assertDatabaseHas('audit_logs', [
        'auditable_type' => 'order_request',
        'auditable_id' => $request->id,
        'action' => 'created',
    ]);
});
