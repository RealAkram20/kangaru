<?php

use App\Enums\UserRole;
use App\Models\User;
use Modules\Administration\Services\SettingsService;

/**
 * The `maps` settings group — where the Google Directions credential lives.
 *
 * **The key bills per request.** That single fact is what every assertion here
 * is protecting: a Directions key that escapes into a browser bundle, a
 * handset, an audit row or an API response is somebody else's traffic on this
 * operator's invoice, and unlike a leaked password there is nothing to reset
 * that does not also break the feature.
 *
 * ADR-0014 §3 already built the mechanism — `secret` keys are encrypted at
 * rest, answered as `configured: true|false`, and masked in audit. This file
 * proves the new group actually inherits it rather than assuming it does.
 */
// Named for this file: `mapsSuperAdmin()` already exists in SettingsTest.php,
// and Pest shares one global function namespace across the suite.
function mapsSuperAdmin(): User
{
    return User::factory()->create(['tenant_id' => null, 'role' => UserRole::SUPER_ADMIN]);
}

it('never returns the key it was given', function () {
    $admin = mapsSuperAdmin();

    $this->actingAs($admin, 'sanctum')
        ->patchJson('/api/v1/settings/maps', [
            'routing_enabled' => true,
            'routing_provider' => 'google',
            'osrm_base_url' => 'https://router.project-osrm.org',
            'api_key' => 'AIzaSyDEMO-not-a-real-key',
        ])
        ->assertOk();

    $response = $this->actingAs($admin, 'sanctum')->getJson('/api/v1/settings')->assertOk();

    // The shape a secret takes on the way out, and the whole point of the
    // group: the console learns that a key exists and never learns what it is.
    $response->assertJsonPath('data.settings.maps.api_key.configured', true);

    expect($response->getContent())->not->toContain('AIzaSyDEMO-not-a-real-key');
});

it('encrypts the key at rest rather than storing it readable', function () {
    $this->actingAs(mapsSuperAdmin(), 'sanctum')
        ->patchJson('/api/v1/settings/maps', [
            'routing_enabled' => true,
            'routing_provider' => 'google',
            'osrm_base_url' => 'https://router.project-osrm.org',
            'api_key' => 'AIzaSyDEMO-not-a-real-key',
        ])
        ->assertOk();

    $stored = DB::table('settings')->where(['group' => 'maps', 'key' => 'api_key'])->value('value');

    expect($stored)->not->toBeNull();
    expect($stored)->not->toContain('AIzaSyDEMO-not-a-real-key');

    // And it round-trips, so "encrypted" does not quietly mean "lost".
    expect(app(SettingsService::class)->secret('maps', 'api_key'))
        ->toBe('AIzaSyDEMO-not-a-real-key');
});

it('keeps the key out of the public subset, which the browser reads unauthenticated', function () {
    $this->actingAs(mapsSuperAdmin(), 'sanctum')
        ->patchJson('/api/v1/settings/maps', [
            'routing_enabled' => true,
            'routing_provider' => 'google',
            'osrm_base_url' => 'https://router.project-osrm.org',
            'api_key' => 'AIzaSyDEMO-not-a-real-key',
        ])
        ->assertOk();

    $public = $this->getJson('/api/v1/public/settings')->assertOk();

    expect($public->getContent())->not->toContain('AIzaSyDEMO-not-a-real-key');
    expect($public->json('data.settings.maps'))->toBeNull();
});

it('starts switched off, so configuring a key never silently starts a bill', function () {
    $this->actingAs(mapsSuperAdmin(), 'sanctum')
        ->getJson('/api/v1/settings')
        ->assertOk()
        ->assertJsonPath('data.settings.maps.routing_enabled', false)
        // OSRM by default: it needs no key and costs nothing, so routing
        // works the moment the switch is turned on rather than after somebody
        // has opened a billing account. Google is the upgrade.
        ->assertJsonPath('data.settings.maps.routing_provider', 'osrm')
        ->assertJsonPath('data.settings.maps.api_key.configured', false);
});

it('reports routing as unconfigured until both the switch and the key are there', function () {
    $settings = app(SettingsService::class);
    $admin = mapsSuperAdmin();

    expect($settings->routingConfigured())->toBeFalse();

    // A key with the switch off: the operator has stopped the spend without
    // destroying the credential, which is exactly what the pair is for.
    $this->actingAs($admin, 'sanctum')->patchJson('/api/v1/settings/maps', [
        'routing_enabled' => false,
        'routing_provider' => 'google',
        'osrm_base_url' => 'https://router.project-osrm.org',
        'api_key' => 'AIzaSyDEMO-not-a-real-key',
    ])->assertOk();

    expect(app(SettingsService::class)->routingConfigured())->toBeFalse();

    // The switch on with no key: nothing to call.
    $this->actingAs($admin, 'sanctum')->patchJson('/api/v1/settings/maps', [
        'routing_enabled' => true,
        'routing_provider' => 'google',
        'osrm_base_url' => 'https://router.project-osrm.org',
    ])->assertOk();

    expect(app(SettingsService::class)->routingConfigured())->toBeTrue();
});

it('refuses a provider nobody has implemented', function () {
    $this->actingAs(mapsSuperAdmin(), 'sanctum')
        ->patchJson('/api/v1/settings/maps', [
            'routing_enabled' => true,
            'routing_provider' => 'mapbox',
            'osrm_base_url' => 'https://router.project-osrm.org',
            'api_key' => 'x',
        ])
        ->assertStatus(422);
});

it('reports the free engine as configured without any credential', function () {
    // The pair that would otherwise leave routing switched on and every route
    // null — indistinguishable, from a driver's seat, from the straight line
    // it was meant to replace.
    $this->actingAs(mapsSuperAdmin(), 'sanctum')->patchJson('/api/v1/settings/maps', [
        'routing_enabled' => true,
        'routing_provider' => 'osrm',
        'osrm_base_url' => 'https://router.project-osrm.org',
    ])->assertOk();

    expect(app(SettingsService::class)->routingConfigured())->toBeTrue();
});

it('is refused to a role without settings.manage', function () {
    $dispatcher = User::factory()->create(['role' => UserRole::DISPATCHER]);

    $this->actingAs($dispatcher, 'sanctum')
        ->patchJson('/api/v1/settings/maps', [
            'routing_enabled' => true,
            'routing_provider' => 'google',
            'osrm_base_url' => 'https://router.project-osrm.org',
            'api_key' => 'AIzaSyDEMO-not-a-real-key',
        ])
        ->assertForbidden();
});
