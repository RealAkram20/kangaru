<?php

use App\Models\Customer;
use App\Support\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;

/**
 * ADR-0013 §1: the customer principal, before any endpoint exists for it.
 * These tests are the record of the model's invariants — what the table
 * and casts promise regardless of which controller arrives later.
 */
it('hashes the password on the way in and hides it on the way out', function () {
    $customer = Customer::factory()->create(['password' => 'kampala-rides-1']);

    expect($customer->password)->not->toBe('kampala-rides-1')
        ->and(Hash::check('kampala-rides-1', $customer->password))->toBeTrue()
        ->and($customer->toArray())->not->toHaveKeys(['password', 'google_id']);
});

it('supports a Google-only customer with no password at all', function () {
    $customer = Customer::factory()->googleOnly()->create();

    expect($customer->password)->toBeNull()
        ->and($customer->google_id)->not->toBeNull();
});

it('refuses a second customer with the same email', function () {
    Customer::factory()->create(['email' => 'nakato@example.com']);

    Customer::factory()->create(['email' => 'nakato@example.com']);
})->throws(QueryException::class);

it('is platform data: invisible to no one, whatever tenant is bound', function () {
    // Customers carry no BelongsToTenant (ADR-0013 §1, following ADR-0005's
    // rule for the fleet and order_requests). If someone ever adds the
    // trait, this is the test that names the decision they are reversing:
    // a bound tenant context must not hide, or reveal, any customer.
    $customer = Customer::factory()->create();

    $seen = app(TenantContext::class)->for(1, fn () => Customer::query()->count());

    expect($seen)->toBe(1)
        ->and(Customer::query()->find($customer->id))->not->toBeNull();
});

it('carries no role and no permissions — a customer is not a staff actor', function () {
    // ADR-0013 §1's core claim, asserted structurally: the columns through
    // which every staff ability flows (ADR-0004) do not exist here, so no
    // policy or seeder can ever grant a customer anything by accident.
    expect(Schema::hasColumn('customers', 'role'))->toBeFalse()
        ->and(Schema::hasColumn('customers', 'tenant_id'))->toBeFalse();
});
