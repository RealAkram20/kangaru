<?php

use App\Enums\UserRole;
use App\Models\Customer;
use App\Models\Tenant;
use App\Models\User;
use Modules\Bookings\Models\OrderRequest;
use Modules\Customers\Enums\CustomerStatus;

/**
 * ADR-0018 — the customer register.
 *
 * Customers could register, order and sign in, and no member of staff could
 * see that they existed: there was no listing, no profile, and no way to
 * stop an account being used. A dispatcher answering the phone had nothing
 * to look the caller up in.
 *
 * The cases that matter are search (a dispatcher with somebody waiting will
 * type what is on their screen, not what the database stores), the privacy
 * boundary (a corporate client's admin is not entitled to Shanitah's retail
 * customers), and suspension actually taking effect.
 */
function registerStaff(string $role = 'super_admin'): User
{
    return User::factory()->create([
        'tenant_id' => null,
        'role' => UserRole::from($role),
    ]);
}

function customerNamed(string $first, string $last, array $overrides = []): Customer
{
    return Customer::factory()->create([
        'first_name' => $first,
        'last_name' => $last,
        ...$overrides,
    ]);
}

// ── Finding somebody ─────────────────────────────────────────────────────

it('lists customers newest first, with a tally for the header', function () {
    customerNamed('Aaa', 'Older');
    customerNamed('Bbb', 'Newer');
    customerNamed('Ccc', 'Blocked', ['status' => CustomerStatus::SUSPENDED]);

    $response = $this->actingAs(registerStaff(), 'sanctum')
        ->getJson('/api/v1/customers')
        ->assertOk();

    // Newest first: the account somebody is asking about is almost always
    // one just created, and id-ascending buries it on the last page.
    expect($response->json('data.0.last_name'))->toBe('Blocked');
    expect($response->json('meta.tally'))->toBe(['total' => 3, 'active' => 2, 'suspended' => 1]);
});

it('finds a customer by name', function () {
    customerNamed('Grace', 'Amongin');
    customerNamed('Moses', 'Kato');

    $rows = $this->actingAs(registerStaff(), 'sanctum')
        ->getJson('/api/v1/customers?q=among')->assertOk()->json('data');

    expect($rows)->toHaveCount(1);
    expect($rows[0]['name'])->toBe('Grace Amongin');
});

it('finds a customer by phone however it was typed', function () {
    customerNamed('Grace', 'Amongin', ['phone' => '+256 700 123 456']);

    // The dispatcher types what is on their screen — the local form, no
    // spaces — and the database holds the international form with them.
    // The digits are the identity; the formatting is decoration.
    foreach (['0700123456', '700123456', '256700123456', '+256 700 123 456'] as $typed) {
        $rows = $this->actingAs(registerStaff(), 'sanctum')
            ->getJson('/api/v1/customers?q='.urlencode($typed))->assertOk()->json('data');

        expect($rows)->toHaveCount(1, "searching for {$typed}");
    }
});

it('does not return the whole register when the search matches nothing', function () {
    customerNamed('Grace', 'Amongin', ['phone' => '+256700123456']);
    customerNamed('Moses', 'Kato', ['phone' => '+256700999888']);

    // The phone arm is `LIKE '%digits%'`; an empty digit string would make
    // it `LIKE '%%'` and match every row — a search for a name returning
    // the whole register reads as broken.
    $rows = $this->actingAs(registerStaff(), 'sanctum')
        ->getJson('/api/v1/customers?q=zzzznobody')->assertOk()->json('data');

    expect($rows)->toBeEmpty();
});

it('filters by status', function () {
    customerNamed('Aaa', 'Active');
    customerNamed('Bbb', 'Blocked', ['status' => CustomerStatus::SUSPENDED]);

    $rows = $this->actingAs(registerStaff(), 'sanctum')
        ->getJson('/api/v1/customers?status=suspended')->assertOk()->json('data');

    expect($rows)->toHaveCount(1);
    expect($rows[0]['last_name'])->toBe('Blocked');
});

it('refuses a filter it does not know rather than ignoring it', function () {
    $this->actingAs(registerStaff(), 'sanctum')
        ->getJson('/api/v1/customers?status=banished')
        ->assertStatus(422);
});

it('requires a signed-in staff member, not merely a policy that refuses null', function () {
    $customer = Customer::factory()->create();

    // These routes were first appended to `Modules/Customers/Routes/api.php`,
    // which is required OUTSIDE the staff middleware group so that customer
    // register and login can stay public. They inherited `api` alone — no
    // `auth:sanctum`, no `tenant`. Nothing leaked, because `authorize()`
    // denies a null user, but a valid staff token was ignored and every
    // request 403'd. This asserts the middleware, not the policy: an
    // anonymous caller must be told they are *unauthenticated*.
    $this->getJson('/api/v1/customers')->assertUnauthorized();
    $this->getJson("/api/v1/customers/{$customer->id}")->assertUnauthorized();
    $this->getJson("/api/v1/customers/{$customer->id}/activity")->assertUnauthorized();
    $this->postJson("/api/v1/customers/{$customer->id}/suspension", ['reason' => 'Long enough reason.'])
        ->assertUnauthorized();
    $this->deleteJson("/api/v1/customers/{$customer->id}/suspension")->assertUnauthorized();
});

// ── The privacy boundary ─────────────────────────────────────────────────

it('keeps the register away from a corporate client, whose customers these are not', function () {
    Customer::factory()->create();

    // A Corporate Admin administers their own company's staff. Shanitah's
    // retail customers are a different population entirely, covered by the
    // Data Protection and Privacy Act — this is the assertion that holding
    // `staff.view` never quietly became holding `customers.view`.
    $corporateAdmin = User::factory()->create([
        'tenant_id' => Tenant::factory()->create()->id,
        'role' => UserRole::CORPORATE_ADMIN,
    ]);

    $this->actingAs($corporateAdmin, 'sanctum')->getJson('/api/v1/customers')->assertForbidden();
});

it('lets a dispatcher read the register but not suspend anybody', function () {
    $customer = Customer::factory()->create();
    $dispatcher = registerStaff('dispatcher');

    // Reading is how they answer the phone; suspending is an act somebody
    // has to answer for.
    $this->actingAs($dispatcher, 'sanctum')->getJson('/api/v1/customers')->assertOk();

    $this->actingAs($dispatcher, 'sanctum')
        ->postJson("/api/v1/customers/{$customer->id}/suspension", [
            'reason' => 'Repeatedly abusive to drivers.',
        ])
        ->assertForbidden();
});

it('never exposes a credential, not even whether the password is hashed', function () {
    $customer = Customer::factory()->create(['google_id' => 'google-sub-123']);

    $row = $this->actingAs(registerStaff(), 'sanctum')
        ->getJson("/api/v1/customers/{$customer->id}")->assertOk()->json('data');

    expect($row)->not->toHaveKey('password');
    expect($row)->not->toHaveKey('google_id');
    // But it does say *how* they sign in, which is the first question a
    // support agent has to answer on "I cannot log in" (ADR-0013 §3).
    expect($row['has_password'])->toBeTrue();
    expect($row['has_google'])->toBeTrue();
});

// ── Suspension ───────────────────────────────────────────────────────────

it('suspends an account, closes its sessions and blocks the next sign-in', function () {
    $customer = Customer::factory()->create([
        'email' => 'blocked@example.test',
        'password' => 'a-very-long-passphrase',
    ]);
    $customer->createToken('phone');

    $this->actingAs(registerStaff(), 'sanctum')
        ->postJson("/api/v1/customers/{$customer->id}/suspension", [
            'reason' => 'Chargebacks on four consecutive rides.',
        ])
        ->assertOk()
        ->assertJsonPath('data.status', 'suspended');

    // Flipping a column while a live token keeps working means they carry
    // on ordering from the app already open on their phone.
    expect($customer->fresh()->tokens()->count())->toBe(0);

    // And the sign-in that would replace it is refused — with the ordinary
    // wrong-credentials answer, so the login form cannot be used to
    // enumerate which accounts are in trouble.
    $this->postJson('/api/v1/customer/auth/login', [
        'email' => 'blocked@example.test',
        'password' => 'a-very-long-passphrase',
    ])->assertStatus(401)->assertJsonPath('code', 'INVALID_CREDENTIALS');
});

it('insists on a reason somebody could read back to the customer', function () {
    $customer = Customer::factory()->create();

    foreach ([[], ['reason' => 'n/a']] as $payload) {
        $this->actingAs(registerStaff(), 'sanctum')
            ->postJson("/api/v1/customers/{$customer->id}/suspension", $payload)
            ->assertStatus(422)
            ->assertJsonValidationErrors('reason');
    }

    expect($customer->fresh()->status)->toBe(CustomerStatus::ACTIVE);
});

it('restores an account and clears the stale reason with it', function () {
    $customer = Customer::factory()->create([
        'email' => 'back@example.test',
        'password' => 'a-very-long-passphrase',
    ]);
    $staff = registerStaff();

    $this->actingAs($staff, 'sanctum')
        ->postJson("/api/v1/customers/{$customer->id}/suspension", [
            'reason' => 'Suspected fraudulent card.',
        ])->assertOk();

    $this->actingAs($staff, 'sanctum')
        ->deleteJson("/api/v1/customers/{$customer->id}/suspension")
        ->assertOk()
        ->assertJsonPath('data.status', 'active')
        // Keeping "suspended because…" beside an active account is how a
        // support agent tells somebody they are blocked when they are not.
        ->assertJsonPath('data.suspension_reason', null);

    $this->postJson('/api/v1/customer/auth/login', [
        'email' => 'back@example.test',
        'password' => 'a-very-long-passphrase',
    ])->assertOk();
});

// ── Activity ─────────────────────────────────────────────────────────────

it('shows what a customer has asked for, and only theirs', function () {
    $customer = Customer::factory()->create();
    $someoneElse = Customer::factory()->create();

    $mine = OrderRequest::factory()->create([
        'customer_id' => $customer->id,
        'pickup_location' => 'Ntinda',
    ]);
    OrderRequest::factory()->create(['customer_id' => $someoneElse->id]);

    $rows = $this->actingAs(registerStaff(), 'sanctum')
        ->getJson("/api/v1/customers/{$customer->id}/activity")->assertOk()->json('data');

    expect($rows)->toHaveCount(1);
    expect($rows[0]['id'])->toBe($mine->id);
});

it('counts a customer orders on their profile', function () {
    $customer = Customer::factory()->create();
    OrderRequest::factory()->count(3)->create(['customer_id' => $customer->id]);

    $this->actingAs(registerStaff(), 'sanctum')
        ->getJson("/api/v1/customers/{$customer->id}")
        ->assertOk()
        ->assertJsonPath('data.orders_count', 3);
});
