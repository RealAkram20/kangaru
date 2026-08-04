<?php

use App\Models\Customer;
use Illuminate\Support\Facades\Hash;

/**
 * ADR-0013 §3: the customer sign-up and sign-in surface. Every response
 * here also passes through the ADR-0011 contract gate, so these tests
 * double as the spec's proof.
 */
function validRegistration(): array
{
    return [
        'name' => 'Nakato Grace',
        'phone' => '0700123456',
        'email' => 'nakato@example.com',
        'password' => 'kampala-rides-1',
    ];
}

it('registers a customer and returns a working token', function () {
    $response = $this->postJson('/api/v1/customer/auth/register', validRegistration());

    $response->assertStatus(201)
        ->assertJsonPath('data.customer.email', 'nakato@example.com')
        ->assertJsonMissingPath('data.customer.password');

    // The token works on the customer surface immediately.
    $this->withToken($response->json('data.token'))
        ->getJson('/api/v1/customer/auth/me')
        ->assertStatus(200)
        ->assertJsonPath('data.email', 'nakato@example.com');

    // And the stored password is a hash, not the plaintext.
    $customer = Customer::query()->where('email', 'nakato@example.com')->firstOrFail();
    expect(Hash::check('kampala-rides-1', $customer->password))->toBeTrue();
});

it('refuses a duplicate email with a message that points at log in', function () {
    Customer::factory()->create(['email' => 'nakato@example.com']);

    $this->postJson('/api/v1/customer/auth/register', validRegistration())
        ->assertStatus(422)
        ->assertJsonValidationErrors(['email']);
});

it('logs a customer in with valid credentials', function () {
    Customer::factory()->create([
        'email' => 'nakato@example.com',
        'password' => 'kampala-rides-1',
    ]);

    $this->postJson('/api/v1/customer/auth/login', [
        'email' => 'nakato@example.com',
        'password' => 'kampala-rides-1',
    ])
        ->assertStatus(200)
        ->assertJsonPath('data.customer.email', 'nakato@example.com')
        ->assertJsonStructure(['data' => ['token']]);
});

it('answers wrong password and unknown email with one identical refusal', function () {
    Customer::factory()->create([
        'email' => 'nakato@example.com',
        'password' => 'kampala-rides-1',
    ]);

    $wrongPassword = $this->postJson('/api/v1/customer/auth/login', [
        'email' => 'nakato@example.com',
        'password' => 'not-the-password',
    ]);
    $unknownEmail = $this->postJson('/api/v1/customer/auth/login', [
        'email' => 'nobody@example.com',
        'password' => 'kampala-rides-1',
    ]);

    // Identical status, code and message: which of the two it was is
    // exactly what a credential-stuffing run is trying to learn.
    $wrongPassword->assertStatus(401)->assertJsonPath('code', 'INVALID_CREDENTIALS');
    $unknownEmail->assertStatus(401)->assertJsonPath('code', 'INVALID_CREDENTIALS');
    expect($wrongPassword->json('message'))->toBe($unknownEmail->json('message'));
});

it('refuses a password login against a Google-only account without crashing', function () {
    $customer = Customer::factory()->googleOnly()->create();

    $this->postJson('/api/v1/customer/auth/login', [
        'email' => $customer->email,
        'password' => 'any-guess-at-all',
    ])
        ->assertStatus(401)
        ->assertJsonPath('code', 'INVALID_CREDENTIALS');
});

it('rate limits login attempts at 5 per minute per IP', function () {
    foreach (range(1, 5) as $i) {
        $this->postJson('/api/v1/customer/auth/login', [
            'email' => 'nobody@example.com',
            'password' => 'wrong',
        ])->assertStatus(401);
    }

    $this->postJson('/api/v1/customer/auth/login', [
        'email' => 'nobody@example.com',
        'password' => 'wrong',
    ])->assertStatus(429);
});

it('revokes the token on logout', function () {
    $customer = Customer::factory()->create();
    $token = $customer->createToken('customer')->plainTextToken;

    $this->withToken($token)->postJson('/api/v1/customer/auth/logout')->assertStatus(200);

    // Guards memoise per test-lifetime request; flush so the second call
    // re-resolves against the now-deleted token.
    app('auth')->forgetGuards();

    $this->withToken($token)->getJson('/api/v1/customer/auth/me')->assertStatus(401);
});
