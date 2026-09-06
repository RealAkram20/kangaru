<?php

use App\Enums\AccessLevel;
use App\Enums\UserRole;
use App\Enums\UserStatus;
use App\Models\AuditLog;
use App\Models\Operator;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;

/**
 * ADR-0014: platform settings. The catalogue is law, reads are gated
 * like writes, every write is audited, and the public endpoint serves
 * the whitelist and nothing else.
 */
/**
 * A Super Admin at **head office**.
 *
 * `UserFactory` files any client-less account under Shanitah, so before
 * ADR-0059 this helper quietly produced a fleet-level actor — which was
 * indistinguishable from head office right up until four settings groups
 * stopped being a fleet's to write. The level is now stated rather than
 * inherited, which is ADR-0055 §4's rule and the reason these tests read the
 * way they do.
 */
function superAdmin(): User
{
    return User::factory()->create([
        'role' => UserRole::SUPER_ADMIN,
        'tenant_id' => null,
        'operator_id' => null,
        'access_level' => AccessLevel::KANGARU,
    ]);
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

/**
 * Four settings groups are Kangaru's copy of itself (ADR-0059): its name, its
 * legal notices, its public order page, and how people sign in.
 *
 * **Not a leak — an information architecture rule**, and the distinction is
 * worth keeping straight. `setGroup` already resolves `operator_id` from the
 * `AccessContext`, so a fleet writing these would override them for its own
 * console and never for Kangaru's. What that still produces is a fleet
 * quietly rebranding an app whose brand nobody decided to make configurable,
 * and a fleet holding the sign-in group that ADR-0061 §5 spent a whole
 * decision keeping out of its hands.
 */
it("refuses a fleet the four groups that are Kangaru's own", function () {
    $fleetAdmin = User::factory()->create([
        'role' => UserRole::SUPER_ADMIN,
        'status' => UserStatus::ACTIVE,
        'tenant_id' => null,
        'operator_id' => Operator::SHANITAH,
        'access_level' => AccessLevel::FLEET,
    ]);

    foreach (['branding', 'legal', 'ordering', 'auth'] as $group) {
        $this->actingAs($fleetAdmin, 'sanctum')
            ->patchJson("/api/v1/settings/{$group}", [])
            ->assertNotFound();
    }
});

/**
 * A 404 rather than a 403, matching the unknown-group branch beside it and the
 * menu's own stance: at this level the group **does not exist**. "Forbidden"
 * would confirm there is a platform-branding surface worth going to look for.
 */
it('tells a fleet the group does not exist, rather than that it is forbidden', function () {
    $fleetAdmin = User::factory()->create([
        'role' => UserRole::SUPER_ADMIN,
        'status' => UserStatus::ACTIVE,
        'tenant_id' => null,
        'operator_id' => Operator::SHANITAH,
        'access_level' => AccessLevel::FLEET,
    ]);

    $this->actingAs($fleetAdmin, 'sanctum')
        ->patchJson('/api/v1/settings/branding', ['app_name' => 'Not KangaruRide'])
        ->assertNotFound()
        ->assertJsonPath('code', 'NOT_FOUND');
});

/**
 * The other half, and the one that keeps `F1` intact: everything that is
 * genuinely a fleet's stays a fleet's. Gating too widely would be a
 * regression dressed as caution.
 */
it('leaves a fleet the groups that are genuinely theirs', function () {
    $fleetAdmin = User::factory()->create([
        'role' => UserRole::SUPER_ADMIN,
        'status' => UserStatus::ACTIVE,
        'tenant_id' => null,
        'operator_id' => Operator::SHANITAH,
        'access_level' => AccessLevel::FLEET,
    ]);

    $this->actingAs($fleetAdmin, 'sanctum')
        ->patchJson('/api/v1/settings/regional', ['date_format' => 'YYYY-MM-DD'])
        ->assertOk();
});

it("lets head office change its own platform's name", function () {
    $head = User::factory()->create([
        'role' => UserRole::SUPER_ADMIN,
        'status' => UserStatus::ACTIVE,
        'tenant_id' => null,
        'operator_id' => null,
        'access_level' => AccessLevel::KANGARU,
    ]);

    $this->actingAs($head, 'sanctum')
        ->patchJson('/api/v1/settings/branding', ['app_name' => 'KangaruRide'])
        ->assertOk();
});

/**
 * The upload route writes the `branding` group by another door. Gating the
 * PATCH and leaving this open would let a fleet replace the platform's logo
 * while being refused its name — the kind of half-closed rule that reads as a
 * bug from whichever side somebody finds it.
 */
it("refuses a fleet the platform's logo, not just its name", function () {
    Storage::fake('public');

    $fleetAdmin = User::factory()->create([
        'role' => UserRole::SUPER_ADMIN,
        'status' => UserStatus::ACTIVE,
        'tenant_id' => null,
        'operator_id' => Operator::SHANITAH,
        'access_level' => AccessLevel::FLEET,
    ]);

    $this->actingAs($fleetAdmin, 'sanctum')
        ->postJson('/api/v1/settings/assets/logo', [
            'file' => UploadedFile::fake()->image('theirs.png'),
        ])
        ->assertNotFound();
});
