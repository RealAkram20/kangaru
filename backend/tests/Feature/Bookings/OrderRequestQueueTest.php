<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use Modules\Bookings\Models\OrderRequest;

/**
 * ADR-0012 §4: the walk-in queue is platform work behind
 * `order_requests.manage`, and ADR-0006's two-halves rule applies —
 * a client must see nothing of it, and so must platform staff without the
 * permission. Both refusals are asserted here, not assumed.
 */
it('lets a platform dispatcher read and filter the queue', function () {
    $dispatcher = User::factory()->create(['role' => UserRole::DISPATCHER]);

    OrderRequest::factory()->count(2)->create();
    OrderRequest::factory()->delivery()->create();

    $this->actingAs($dispatcher, 'sanctum')
        ->getJson('/api/v1/order-requests')
        ->assertStatus(200)
        ->assertJsonCount(3, 'data.order_requests');

    $this->actingAs($dispatcher, 'sanctum')
        ->getJson('/api/v1/order-requests?service_type=delivery')
        ->assertStatus(200)
        ->assertJsonCount(1, 'data.order_requests');
});

it('refuses an unknown filter rather than ignoring it', function () {
    $dispatcher = User::factory()->create(['role' => UserRole::DISPATCHER]);

    $this->actingAs($dispatcher, 'sanctum')
        ->getJson('/api/v1/order-requests?vibe=urgent')
        ->assertStatus(422);
});

it('hides the queue from tenant users — even a tenant dispatcher', function () {
    $tenant = Tenant::factory()->create();
    $corporateAdmin = User::factory()->create([
        'tenant_id' => $tenant->id, 'role' => UserRole::CORPORATE_ADMIN,
    ]);
    // The sharp half of the test: this role HOLDS the permission. What it
    // lacks is being platform staff, and that alone must be refusal enough.
    $tenantDispatcher = User::factory()->create([
        'tenant_id' => $tenant->id, 'role' => UserRole::DISPATCHER,
    ]);

    $request = OrderRequest::factory()->create();

    foreach ([$corporateAdmin, $tenantDispatcher] as $actor) {
        $this->actingAs($actor, 'sanctum')
            ->getJson('/api/v1/order-requests')->assertStatus(403);
        $this->actingAs($actor, 'sanctum')
            ->getJson("/api/v1/order-requests/{$request->id}")->assertStatus(403);
        $this->actingAs($actor, 'sanctum')
            ->patchJson("/api/v1/order-requests/{$request->id}", ['status' => 'contacted'])
            ->assertStatus(403);
    }
});

it('hides the queue from platform staff without the permission', function () {
    // ADR-0006's second half: Finance belongs to no tenant and reads across
    // clients elsewhere — but holds no order_requests.manage, so the null
    // tenant_id must not become reach here.
    $finance = User::factory()->create(['role' => UserRole::FINANCE]);

    OrderRequest::factory()->create();

    $this->actingAs($finance, 'sanctum')
        ->getJson('/api/v1/order-requests')
        ->assertStatus(403);
});

it('requires authentication entirely', function () {
    $this->getJson('/api/v1/order-requests')->assertStatus(401);
});

it('moves a request through a legal transition and records who', function () {
    $dispatcher = User::factory()->create(['role' => UserRole::DISPATCHER]);
    $request = OrderRequest::factory()->create();

    $response = $this->actingAs($dispatcher, 'sanctum')
        ->patchJson("/api/v1/order-requests/{$request->id}", [
            'status' => 'contacted',
            'dispatcher_notes' => 'Called — wants the ride at 3pm.',
        ]);

    $response->assertStatus(200);
    expect($response->json('data.order_request.status'))->toBe('contacted')
        ->and($response->json('data.order_request.handled_by.id'))->toBe($dispatcher->id);
});

it('keeps earlier dispatcher notes when a later move sends none', function () {
    $dispatcher = User::factory()->create(['role' => UserRole::DISPATCHER]);
    $request = OrderRequest::factory()->create();

    $this->actingAs($dispatcher, 'sanctum')
        ->patchJson("/api/v1/order-requests/{$request->id}", [
            'status' => 'contacted',
            'dispatcher_notes' => 'Quoted UGX 45,000.',
        ])->assertStatus(200);

    $this->actingAs($dispatcher, 'sanctum')
        ->patchJson("/api/v1/order-requests/{$request->id}", ['status' => 'converted'])
        ->assertStatus(200);

    expect($request->refresh()->dispatcher_notes)->toBe('Quoted UGX 45,000.');
});

it('refuses an illegal transition with the stable error code', function () {
    $dispatcher = User::factory()->create(['role' => UserRole::DISPATCHER]);
    $request = OrderRequest::factory()->create();

    $this->actingAs($dispatcher, 'sanctum')
        ->patchJson("/api/v1/order-requests/{$request->id}", ['status' => 'closed'])
        ->assertStatus(200);

    // Closed is terminal — nothing may leave it.
    $this->actingAs($dispatcher, 'sanctum')
        ->patchJson("/api/v1/order-requests/{$request->id}", ['status' => 'contacted'])
        ->assertStatus(409)
        ->assertJsonPath('code', 'INVALID_ORDER_REQUEST_TRANSITION');
});
