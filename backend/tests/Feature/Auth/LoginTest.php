<?php

use App\Enums\UserRole;
use App\Models\User;
use Illuminate\Support\Facades\Hash;

it('logs in with valid credentials and returns a token', function () {
    $user = User::factory()->create([
        'email' => 'driver.admin@example.test',
        'password' => Hash::make('correct-password'),
        'role' => UserRole::CORPORATE_ADMIN,
    ]);

    $response = $this->postJson('/api/v1/auth/login', [
        'email' => $user->email,
        'password' => 'correct-password',
    ]);

    $response->assertOk()
        ->assertJsonPath('success', true)
        ->assertJsonPath('data.user.email', $user->email)
        ->assertJsonStructure(['data' => ['user', 'token']]);
});

it('rejects invalid credentials with a 401 envelope', function () {
    $user = User::factory()->create([
        'password' => Hash::make('correct-password'),
    ]);

    $response = $this->postJson('/api/v1/auth/login', [
        'email' => $user->email,
        'password' => 'wrong-password',
    ]);

    $response->assertStatus(401)
        ->assertJsonPath('success', false)
        ->assertJsonPath('code', 'INVALID_CREDENTIALS');
});

it('rate limits login attempts at 5 per minute per IP', function () {
    for ($i = 0; $i < 5; $i++) {
        $this->postJson('/api/v1/auth/login', [
            'email' => 'nobody@example.test',
            'password' => 'whatever',
        ]);
    }

    $response = $this->postJson('/api/v1/auth/login', [
        'email' => 'nobody@example.test',
        'password' => 'whatever',
    ]);

    $response->assertStatus(429);
});
