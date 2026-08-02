<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Illuminate\Support\Facades\Hash;

/**
 * Changing your own password.
 *
 * Ships with staff administration rather than after it: administrators now
 * hand out initial passwords, and creating accounts without giving their
 * owners a way to take that password out of the administrator's hands would
 * be half a feature, and the wrong half.
 */
function passwordFixture(): User
{
    $tenant = Tenant::factory()->create();
    app(TenantContext::class)->set($tenant->id);

    return User::factory()->create([
        'tenant_id' => $tenant->id,
        'role' => UserRole::CORPORATE_EMPLOYEE,
        'password' => 'the-original-password',
    ]);
}

it('changes a password and lets the new one sign in', function () {
    $user = passwordFixture();

    $this->actingAs($user, 'sanctum')->patchJson('/api/v1/auth/password', [
        'current_password' => 'the-original-password',
        'password' => 'a-brand-new-password',
        'password_confirmation' => 'a-brand-new-password',
    ])->assertOk();

    expect(Hash::check('a-brand-new-password', $user->refresh()->password))->toBeTrue();

    $this->postJson('/api/v1/auth/login', [
        'email' => $user->email,
        'password' => 'a-brand-new-password',
    ])->assertOk();
});

it('requires the current password even though the caller is signed in', function () {
    $user = passwordFixture();

    // A bearer token proves the request came from a signed-in session, not
    // that the person holding it owns the account — an unattended laptop is
    // enough. This is the standard re-authentication before a credential
    // change.
    $this->actingAs($user, 'sanctum')->patchJson('/api/v1/auth/password', [
        'current_password' => 'not-the-password',
        'password' => 'a-brand-new-password',
        'password_confirmation' => 'a-brand-new-password',
    ])->assertStatus(422)->assertJsonPath('code', 'INVALID_CREDENTIALS');

    expect(Hash::check('the-original-password', $user->refresh()->password))->toBeTrue();
});

it('requires a confirmation so a typo cannot lock someone out', function () {
    $user = passwordFixture();

    $this->actingAs($user, 'sanctum')->patchJson('/api/v1/auth/password', [
        'current_password' => 'the-original-password',
        'password' => 'a-brand-new-password',
        'password_confirmation' => 'a-brand-new-passw0rd',
    ])->assertStatus(422)->assertJsonValidationErrors('password');

    expect(Hash::check('the-original-password', $user->refresh()->password))->toBeTrue();
});

it('refuses a password that is too short, or the same as the current one', function () {
    $user = passwordFixture();

    $this->actingAs($user, 'sanctum')->patchJson('/api/v1/auth/password', [
        'current_password' => 'the-original-password',
        'password' => 'short',
        'password_confirmation' => 'short',
    ])->assertStatus(422)->assertJsonValidationErrors('password');

    $this->actingAs($user, 'sanctum')->patchJson('/api/v1/auth/password', [
        'current_password' => 'the-original-password',
        'password' => 'the-original-password',
        'password_confirmation' => 'the-original-password',
    ])->assertStatus(422)->assertJsonValidationErrors('password');
});

it('signs every device out, including the one that changed it', function () {
    $user = passwordFixture();

    $user->createToken('old-phone');
    $user->createToken('old-laptop');
    expect($user->tokens()->count())->toBe(2);

    // Everything goes. Keeping the current session alive would be
    // friendlier, but identifying it depends on Sanctum's
    // currentAccessToken(), which is typed non-nullable while returning a
    // keyless TransientToken under some guards. For a credential change the
    // blunt rule is also the safer one.
    $this->actingAs($user, 'sanctum')->patchJson('/api/v1/auth/password', [
        'current_password' => 'the-original-password',
        'password' => 'a-brand-new-password',
        'password_confirmation' => 'a-brand-new-password',
    ])->assertOk();

    expect($user->tokens()->count())->toBe(0);

    // And the new password is what signs back in.
    $this->postJson('/api/v1/auth/login', [
        'email' => $user->email,
        'password' => 'a-brand-new-password',
    ])->assertOk();
});

it('is not reachable without signing in', function () {
    $this->patchJson('/api/v1/auth/password', [
        'current_password' => 'x',
        'password' => 'a-brand-new-password',
        'password_confirmation' => 'a-brand-new-password',
    ])->assertUnauthorized();
});

it('offers no way for an administrator to set somebody else\'s password', function () {
    $user = passwordFixture();
    $admin = User::factory()->create(['tenant_id' => $user->tenant_id, 'role' => UserRole::CORPORATE_ADMIN]);

    // Deliberate: an admin silently resetting a password is the one act an
    // audit trail cannot tell apart from impersonation. The route takes no
    // user parameter, and PATCH /users/{user} does not accept a password.
    $this->actingAs($admin, 'sanctum')->patchJson("/api/v1/users/{$user->id}", [
        'password' => 'i-know-your-password-now',
    ])->assertOk();

    expect(Hash::check('the-original-password', $user->refresh()->password))->toBeTrue();
    expect(Hash::check('i-know-your-password-now', $user->password))->toBeFalse();
});
