<?php

use App\Enums\AccessLevel;
use App\Enums\UserRole;
use App\Models\User;

/**
 * ADR-0014, `legal` group: the Terms and Privacy notices the Driver App's
 * sign-up form asks consent to.
 *
 * Two properties matter here and nothing else does. They must be readable
 * without an account, because the screen that shows them is the screen where
 * an account does not yet exist. And they must be editable by the owner,
 * because a legal notice that needs a deploy to correct is a legal notice
 * that stays wrong.
 */
it('serves both documents to a reader with no account at all', function () {
    $this->getJson('/api/v1/public/legal')
        ->assertStatus(200)
        ->assertJsonPath('success', true)
        ->assertJsonStructure(['data' => ['terms', 'privacy']]);
});

/**
 * An unconfigured deployment still tells a driver something true about what
 * they are agreeing to. Mutation check — replace either catalogue default
 * with an empty string and this fails.
 */
it('ships a real short-form notice rather than an empty box', function () {
    $response = $this->getJson('/api/v1/public/legal')->assertStatus(200);

    expect($response->json('data.terms'))->toContain('driving licence');
    expect($response->json('data.privacy'))->toContain('Data Protection and Privacy Act');
});

it('lets the owner correct a notice without a deploy', function () {
    $admin = User::factory()->create([
        'tenant_id' => null,
        'operator_id' => null,
        'access_level' => AccessLevel::KANGARU,
        'role' => UserRole::SUPER_ADMIN,
    ]);

    $this->actingAs($admin, 'sanctum')
        ->patchJson('/api/v1/settings/legal', ['terms' => 'Ride safely. Record your odometer.'])
        ->assertStatus(200);

    $this->getJson('/api/v1/public/legal')
        ->assertStatus(200)
        ->assertJsonPath('data.terms', 'Ride safely. Record your odometer.');
});

it('gates the write behind settings.manage like every other group', function () {
    $dispatcher = User::factory()->create(['role' => UserRole::DISPATCHER]);

    $this->actingAs($dispatcher, 'sanctum')
        ->patchJson('/api/v1/settings/legal', ['terms' => 'You owe me your bike.'])
        ->assertStatus(403);
});

/**
 * The documents are long and the branding subset is fetched on every page
 * load and every app cold start. Mutation check — flag either `legal` key
 * `public` in the catalogue and this fails.
 */
it('keeps the documents off the branding endpoint that every page load hits', function () {
    $response = $this->getJson('/api/v1/public/settings')->assertStatus(200);

    expect($response->json('data.settings'))->not->toHaveKey('legal');
});
