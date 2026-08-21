<?php

use App\Support\Observability\ScrubsSecrets;
use Sentry\Event;

/**
 * ADR-0054 §3 — credentials never leave this server, whatever
 * `send_default_pii` is set to.
 *
 * The owner chose to send full request data, so a passenger's name and
 * address *do* go to Sentry. These tests defend the line that decision does
 * not move: a password is not a diagnostic.
 *
 * Written as unit assertions over a real `Sentry\Event` rather than by
 * asserting on a mocked transport, because the thing worth defending is the
 * shape of what the scrubber returns, and a mock would only prove that the
 * scrubber was called.
 */
function scrubbed(array $request): array
{
    $event = Event::createEvent();
    $event->setRequest($request);

    $result = (new ScrubsSecrets)($event);

    return $result?->getRequest() ?? [];
}

it('redacts a password out of a login body', function () {
    $out = scrubbed(['data' => ['email' => 'grace@bank.test', 'password' => 'hunter2']]);

    expect($out['data']['password'])->toBe('[redacted]');
    // The rest survives. A report with nothing in it fixes nothing, and the
    // owner's decision was that ordinary fields come through.
    expect($out['data']['email'])->toBe('grace@bank.test');
});

it('replaces the value rather than dropping the key', function () {
    $out = scrubbed(['data' => ['password' => 'hunter2']]);

    // "The login had no password field" is a materially different bug report
    // from "the password was wrong", and an absent key says the first.
    expect($out['data'])->toHaveKey('password');
});

it('catches the variants one field name has across a body, a header and a query', function () {
    $out = scrubbed([
        'data' => [
            'password_confirmation' => 'hunter2',
            'current_password' => 'hunter1',
        ],
        'headers' => [
            'Authorization' => 'Bearer 1|abcdef',
            'Cookie' => 'laravel_session=abc',
            'X-Api-Key' => 'k-123',
        ],
        'query_string' => 'api_token=t-9',
    ]);

    expect($out['data']['password_confirmation'])->toBe('[redacted]');
    expect($out['data']['current_password'])->toBe('[redacted]');
    expect($out['headers']['Authorization'])->toBe('[redacted]');
    expect($out['headers']['Cookie'])->toBe('[redacted]');
    expect($out['headers']['X-Api-Key'])->toBe('[redacted]');
});

it('redacts the MFA enrolment payload, which is the one that carries a secret', function () {
    // ADR-0008's enrolment posts the shared secret and the recovery codes.
    // An enrolment that 500s is exactly the event somebody would want, and
    // exactly the one that must not carry the factor with it.
    $out = scrubbed([
        'data' => [
            'mfa_secret' => 'STTPMS6JYQVFOVQ',
            'totp_code' => '123456',
            'recovery_codes' => ['aaa-bbb', 'ccc-ddd'],
            'challenge_id' => 'V4jq3e1mnmGhySct',
        ],
    ]);

    expect($out['data']['mfa_secret'])->toBe('[redacted]');
    expect($out['data']['totp_code'])->toBe('[redacted]');
    expect($out['data']['recovery_codes'])->toBe('[redacted]');
    expect($out['data']['challenge_id'])->toBe('[redacted]');
});

it('redacts an idempotency key, because a leaked one replays a financial mutation', function () {
    $out = scrubbed(['headers' => ['Idempotency-Key' => 'idem-first-invoice-0001']]);

    expect($out['headers']['Idempotency-Key'])->toBe('[redacted]');
});

it('reaches a credential nested under several levels', function () {
    $out = scrubbed(['data' => ['driver' => ['account' => ['password' => 'hunter2']]]]);

    // The walk is recursive; a body one level deeper than the test author
    // imagined is the ordinary case, not the exotic one.
    expect($out['data']['driver']['account']['password'])->toBe('[redacted]');
});

it('leaves the fields the owner chose to receive alone', function () {
    $out = scrubbed([
        'data' => [
            'passenger_name' => 'Grace Achieng',
            'passenger_phone' => '+256 772 000 111',
            'origin' => 'Mapeera House',
            'vehicle_category' => 'van',
            'passenger_count' => 4,
        ],
    ]);

    // The point of the test: this class is **not** a PII filter, and turning
    // it into one by accident would quietly overturn a decision the owner
    // made deliberately. If somebody later wants these scrubbed, that is an
    // ADR amendment, and this assertion is what will fail to say so.
    expect($out['data']['passenger_name'])->toBe('Grace Achieng');
    expect($out['data']['passenger_phone'])->toBe('+256 772 000 111');
    expect($out['data']['origin'])->toBe('Mapeera House');
});
