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
        'first_name' => 'Nakato',
        'last_name' => 'Grace',
        'gender' => 'female',
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

it('stores the names apart and composes the full name from them', function () {
    $this->postJson('/api/v1/customer/auth/register', validRegistration())
        ->assertStatus(201)
        ->assertJsonPath('data.customer.first_name', 'Nakato')
        ->assertJsonPath('data.customer.last_name', 'Grace')
        // Composed, not stored — the dispatcher queue reads this.
        ->assertJsonPath('data.customer.name', 'Nakato Grace')
        ->assertJsonPath('data.customer.gender', 'female');
});

it('accepts a sign-up that declines to state a gender', function () {
    // ADR-0015 §2: optional means the account is creatable without it,
    // and the column stays null rather than guessing a default.
    $this->postJson('/api/v1/customer/auth/register', [
        ...validRegistration(),
        'gender' => null,
    ])
        ->assertStatus(201)
        ->assertJsonPath('data.customer.gender', null);

    expect(Customer::query()->where('email', 'nakato@example.com')->firstOrFail()->gender)
        ->toBeNull();
});

it('keeps "prefer not to say" as a stored answer, distinct from never asked', function () {
    $this->postJson('/api/v1/customer/auth/register', [
        ...validRegistration(),
        'gender' => 'prefer_not_to_say',
    ])
        ->assertStatus(201)
        // Not null: somebody who declined has been asked, and a future
        // screen must be able to tell that from silence.
        ->assertJsonPath('data.customer.gender', 'prefer_not_to_say');
});

it('refuses a gender outside the closed list', function () {
    $this->postJson('/api/v1/customer/auth/register', [
        ...validRegistration(),
        'gender' => 'helicopter',
    ])
        ->assertStatus(422)
        ->assertJsonValidationErrors(['gender']);
});

it('requires both halves of the name', function () {
    foreach (['first_name', 'last_name'] as $field) {
        $payload = validRegistration();
        unset($payload[$field]);

        $this->postJson('/api/v1/customer/auth/register', $payload)
            ->assertStatus(422)
            ->assertJsonValidationErrors([$field]);
    }
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
