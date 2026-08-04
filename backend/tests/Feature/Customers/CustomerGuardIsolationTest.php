<?php

use App\Models\Customer;
use App\Models\User;
use Illuminate\Support\Facades\Route;

/**
 * ADR-0013 §2: the guard split, proved in both directions.
 *
 * The staff half is the one with teeth. Sanctum ships its `sanctum` guard
 * with a null provider, and a null provider accepts any tokenable model —
 * so without config/auth.php pinning `provider => users`, every test in
 * this file's first half would fail, and a walk-in customer's token would
 * open the dispatch queue. These tests are the tripwire on that config
 * line: whoever loosens it meets this file, not an incident.
 *
 * The customer half runs against a probe route because no customer
 * endpoint exists yet (§3 adds them). The probe lives outside /api/v1 so
 * the ADR-0011 contract gate ignores it; when real customer routes land,
 * the probe assertions should migrate onto them.
 */
function customerToken(): string
{
    return Customer::factory()->create()->createToken('customer')->plainTextToken;
}

it('refuses a customer token on the staff auth surface', function () {
    $token = customerToken();

    $this->withToken($token)->getJson('/api/v1/auth/me')->assertStatus(401);
    $this->withToken($token)->postJson('/api/v1/auth/logout')->assertStatus(401);
});

it('refuses a customer token on tenant-scoped business routes', function () {
    $token = customerToken();

    $this->withToken($token)->getJson('/api/v1/bookings')->assertStatus(401);
    $this->withToken($token)->getJson('/api/v1/trips')->assertStatus(401);
    $this->withToken($token)->getJson('/api/v1/invoices')->assertStatus(401);
});

it('refuses a customer token on the walk-in queue it feeds', function () {
    // The sharpest version of the split: the queue is *about* customers,
    // and still no customer may read it — it is the dispatcher's view of
    // everyone, not any one customer's view of themselves (ADR-0012 §4).
    $this->withToken(customerToken())
        ->getJson('/api/v1/order-requests')
        ->assertStatus(401);
});

it('authenticates a customer token on a customer-guarded route, and a staff token never', function () {
    Route::middleware('auth:customer')->get('/probe/customer-guard', fn () => response()->json([
        'id' => auth('customer')->id(),
    ]));

    $customer = Customer::factory()->create();
    $customerToken = $customer->createToken('customer')->plainTextToken;
    $staffToken = User::factory()->create()->createToken('api')->plainTextToken;

    $this->withToken($customerToken)->getJson('/probe/customer-guard')
        ->assertStatus(200)
        ->assertJson(['id' => $customer->id]);

    // Guards memoise the resolved user for the request's lifetime, and in
    // a feature test the "request" is the whole test — without this flush
    // the staff request below would be served the cached customer and the
    // assertion would test the cache, not the guard.
    app('auth')->forgetGuards();

    $this->withToken($staffToken)->getJson('/probe/customer-guard')->assertStatus(401);

    app('auth')->forgetGuards();

    $this->getJson('/probe/customer-guard')->assertStatus(401);
});
