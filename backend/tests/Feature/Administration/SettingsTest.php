<?php

use App\Enums\UserRole;
use App\Models\AuditLog;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;

/**
 * ADR-0014: platform settings. The catalogue is law, reads are gated
 * like writes, every write is audited, and the public endpoint serves
 * the whitelist and nothing else.
 */
function superAdmin(): User
{
    return User::factory()->create(['role' => UserRole::SUPER_ADMIN]);
}

it('resolves every catalogue key to a default before anything is saved', function () {
    $this->actingAs(superAdmin(), 'sanctum')
        ->getJson('/api/v1/settings')
        ->assertStatus(200)
        ->assertJsonPath('data.settings.branding.app_name', 'KangaruRide')
        ->assertJsonPath('data.settings.regional.currency', 'UGX')
        ->assertJsonPath('data.settings.regional.timezone', 'Africa/Kampala');
});

it('gates the read as tightly as the write', function () {
    // Unauthenticated first: actingAs() would stay memoised for the
    // rest of the test and turn this 401 into a 403.
    $this->getJson('/api/v1/settings')->assertStatus(401);

    $dispatcher = User::factory()->create(['role' => UserRole::DISPATCHER]);

    $this->actingAs($dispatcher, 'sanctum')
        ->getJson('/api/v1/settings')->assertStatus(403);
    $this->actingAs($dispatcher, 'sanctum')
        ->patchJson('/api/v1/settings/branding', ['app_name' => 'Hijack'])->assertStatus(403);
});

it('saves a group, reflects it everywhere, and audits the change', function () {
    $admin = superAdmin();

    $this->actingAs($admin, 'sanctum')
        ->patchJson('/api/v1/settings/branding', [
            'app_name' => 'Shanitah Rides',
            'contact_phone' => '0700 111 222',
        ])
        ->assertStatus(200)
        ->assertJsonPath('data.settings.branding.app_name', 'Shanitah Rides');

    // The public endpoint sees the same truth, unauthenticated.
    $this->getJson('/api/v1/public/settings')
        ->assertStatus(200)
        ->assertJsonPath('data.settings.branding.app_name', 'Shanitah Rides')
        ->assertJsonPath('data.settings.branding.contact_phone', '0700 111 222');

    // Audited like a rate card: who, what, to the append-only trail.
    // withoutGlobalScopes: settings are platform rows (tenant_id null),
    // and BelongsToTenant's fail-closed read scope would hide them from
    // an unbound query — the same reason the audit UI reads them through
    // a platform actor, not the reason they would be missing.
    $audit = AuditLog::withoutGlobalScopes()->where('auditable_type', 'setting')->get();
    expect($audit)->not->toBeEmpty()
        ->and($audit->first()->user_id)->toBe($admin->id);
});

it('refuses an unknown key rather than skipping it', function () {
    $this->actingAs(superAdmin(), 'sanctum')
        ->patchJson('/api/v1/settings/branding', ['app_name' => 'Fine', 'rogue_key' => 'x'])
        ->assertStatus(200)
        ->assertJsonMissingPath('data.settings.branding.rogue_key');

    // Sent alone, the unknown key cannot masquerade as a saved change:
    // the request validates nothing and writes nothing.
    $this->actingAs(superAdmin(), 'sanctum')
        ->patchJson('/api/v1/settings/nonsense', ['whatever' => 1])
        ->assertStatus(404);
});

it('validates through the catalogue rules', function () {
    $this->actingAs(superAdmin(), 'sanctum')
        ->patchJson('/api/v1/settings/branding', ['contact_email' => 'not-an-email'])
        ->assertStatus(422)
        ->assertJsonValidationErrors(['contact_email']);

    $this->actingAs(superAdmin(), 'sanctum')
        ->patchJson('/api/v1/settings/regional', ['timezone' => 'Mars/Olympus_Mons'])
        ->assertStatus(422);
});

it('keeps non-public keys off the public endpoint', function () {
    $response = $this->getJson('/api/v1/public/settings')->assertStatus(200);

    // timezone and date_format are catalogue keys without the public
    // flag; the whitelist is what keeps them (and every future SMTP or
    // gateway key) from leaking by default.
    expect($response->json('data.settings.regional'))->toBe(['currency' => 'UGX'])
        ->and($response->json('data.settings.branding.app_name'))->toBe('KangaruRide');
});

it('stores an uploaded logo and serves it as a URL', function () {
    Storage::fake('public');

    $this->actingAs(superAdmin(), 'sanctum')
        ->post('/api/v1/settings/assets/logo', [
            'file' => UploadedFile::fake()->image('logo.png', 200, 60),
        ], ['Accept' => 'application/json'])
        ->assertStatus(200);

    $path = $this->actingAs(superAdmin(), 'sanctum')
        ->getJson('/api/v1/settings')
        ->json('data.settings.branding.logo_path');

    expect($path)->not->toBeNull();
    Storage::disk('public')->assertExists($path);

    $url = $this->getJson('/api/v1/public/settings')->json('data.settings.branding.logo_path');
    expect($url)->toContain('/storage/');
});

it('refuses an oversized or wrong-type asset', function () {
    Storage::fake('public');

    $this->actingAs(superAdmin(), 'sanctum')
        ->post('/api/v1/settings/assets/favicon', [
            'file' => UploadedFile::fake()->create('malware.exe', 100, 'application/octet-stream'),
        ], ['Accept' => 'application/json'])
        ->assertStatus(422);

    $this->actingAs(superAdmin(), 'sanctum')
        ->post('/api/v1/settings/assets/logo', [
            'file' => UploadedFile::fake()->create('huge.png', 5000, 'image/png'),
        ], ['Accept' => 'application/json'])
        ->assertStatus(422);

    $this->actingAs(superAdmin(), 'sanctum')
        ->post('/api/v1/settings/assets/banner', [
            'file' => UploadedFile::fake()->image('x.png'),
        ], ['Accept' => 'application/json'])
        ->assertStatus(404);
});
