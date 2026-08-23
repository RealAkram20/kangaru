<?php

use App\Enums\UserRole;
use App\Models\AuditLog;
use App\Models\User;
use Modules\Administration\Models\Setting;
use Modules\Administration\Services\SettingsService;

/**
 * ADR-0014 §3, exercised by its first real users (mail, sms, payments):
 * a secret goes in through the same PATCH as any value and never comes
 * back out — not in GET, not in the public subset, not in audit.
 */
function settingsAdmin(): User
{
    return User::factory()->create(['role' => UserRole::SUPER_ADMIN]);
}

it('stores a secret and answers only that it is configured', function () {
    $admin = settingsAdmin();

    $this->actingAs($admin, 'sanctum')
        ->patchJson('/api/v1/settings/mail', [
            'enabled' => true,
            'host' => 'smtp.example.test',
            'password' => 'smtp-secret-value',
        ])
        ->assertStatus(200)
        ->assertJsonPath('data.settings.mail.password.configured', true)
        ->assertJsonMissing(['smtp-secret-value']);

    // The raw response body never carries the plaintext anywhere.
    $body = $this->actingAs($admin, 'sanctum')->getJson('/api/v1/settings')->getContent();
    expect($body)->not->toContain('smtp-secret-value')
        ->and(json_decode($body, true)['data']['settings']['mail']['password'])
        ->toBe(['configured' => true]);
});

it('stores the secret encrypted, not as the plaintext', function () {
    app(SettingsService::class)->setGroup('mail', ['password' => 'smtp-secret-value']);

    $row = Setting::query()->where(['group' => 'mail', 'key' => 'password'])->firstOrFail();

    expect($row->is_secret)->toBeTrue()
        ->and(json_encode($row->value))->not->toContain('smtp-secret-value');

    // The one legal reader — the code that consumes it — gets it back.
    expect(app(SettingsService::class)->secret('mail', 'password'))->toBe('smtp-secret-value');
});

it('masks the secret in the audit trail', function () {
    $admin = settingsAdmin();

    $this->actingAs($admin, 'sanctum')
        ->patchJson('/api/v1/settings/sms', ['api_key' => 'sms-key-plaintext'])
        ->assertStatus(200);

    $rows = AuditLog::withoutGlobalScopes()->where('auditable_type', 'setting')->get();

    expect($rows)->not->toBeEmpty();
    foreach ($rows as $row) {
        expect(json_encode($row->changes))->not->toContain('sms-key-plaintext');
    }
});

it('keeps every credential group off the public endpoint', function () {
    app(SettingsService::class)->setGroup('mail', ['password' => 'x']);
    app(SettingsService::class)->setGroup('payments', ['mtn_momo_api_key' => 'y']);

    $groups = array_keys($this->getJson('/api/v1/public/settings')->json('data.settings'));

    expect($groups)->not->toContain('mail')
        ->not->toContain('sms')
        ->not->toContain('payments');
});

it('refuses a test email until mail is actually configured', function () {
    $this->actingAs(settingsAdmin(), 'sanctum')
        ->postJson('/api/v1/settings/mail/test')
        ->assertStatus(422);
});

it('surfaces the transport error when the SMTP server is unreachable', function () {
    // The suite runs the settings mailer on the `array` transport so tests can
    // reach that code path without a mail server (see config/mail.php). This
    // one case is *about* a real SMTP server refusing, so it asks for the real
    // transport back and then points it at a closed port.
    config(['mail.settings_transport' => 'smtp']);

    app(SettingsService::class)->setGroup('mail', [
        'enabled' => true,
        'host' => '127.0.0.1',
        'port' => 1,
        'from_address' => 'noreply@kangaruride.test',
        'encryption' => 'none',
    ]);

    $this->actingAs(settingsAdmin(), 'sanctum')
        ->postJson('/api/v1/settings/mail/test', ['to' => 'owner@example.test'])
        ->assertStatus(502)
        ->assertJsonPath('code', 'MAIL_DELIVERY_FAILED');
});

it('gates the test-send like every other settings write', function () {
    $dispatcher = User::factory()->create(['role' => UserRole::DISPATCHER]);

    $this->actingAs($dispatcher, 'sanctum')
        ->postJson('/api/v1/settings/mail/test')
        ->assertStatus(403);
});
