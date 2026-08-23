<?php

namespace App\Support\Observability;

use Sentry\Event;
use Sentry\EventHint;

/**
 * Strips credentials out of every event before it leaves this server
 * (ADR-0054 §3).
 *
 * ## Why this exists even though `send_default_pii` is on
 *
 * The owner chose to send full request data, so a passenger's name and a
 * pickup address do reach Sentry. **That decision is about personal data and
 * this class is not.** A password, a bearer token, a TOTP secret or a session
 * cookie is not a richer diagnostic — it is a credential, and a credential in
 * a bug report is a security defect no matter who is reading the report or
 * where it is hosted.
 *
 * The two happen to travel in the same request body, which is the only reason
 * anyone would confuse them. So the PII switch is left to the owner and this
 * runs unconditionally.
 *
 * ## Why a denylist of keys and not a value-shaped regex
 *
 * A regex over values would have to recognise a JWT, a Sanctum token, a
 * bcrypt hash and a six-digit TOTP code — and the last of those is
 * indistinguishable from a passenger count, a house number or a year. Keys
 * are what the platform actually controls: every one below is a field name
 * this codebase writes, and adding a new credential field means adding a
 * line here, which is a thing review can see.
 *
 * Matching is on a **normalised substring**, so `password`,
 * `password_confirmation`, `current_password` and `X-Api-Password` are all
 * caught by one entry. The cost is over-redaction — a field called
 * `token_count` would be filtered — and that is the right direction to be
 * wrong in.
 */
class ScrubsSecrets
{
    /**
     * Normalised fragments that mark a value as a credential.
     *
     * `mfa`/`totp`/`recovery` are here because ADR-0008's enrolment flow
     * posts the secret and the recovery codes in a request body, and an
     * enrolment that 500s is exactly the kind of thing somebody would want a
     * Sentry event for.
     *
     * `idempotency` is not a secret, but a leaked key lets somebody replay a
     * financial mutation (AGENTS.md: replays return the original result), so
     * it is treated as one.
     *
     * @var list<string>
     */
    private const SECRET_KEYS = [
        'password',
        'secret',
        'token',
        'authorization',
        'cookie',
        'api_key',
        'apikey',
        'private_key',
        'mfa',
        'totp',
        'recovery',
        'challenge',
        'idempotency',
        'signature',
        'credential',
    ];

    private const REDACTED = '[redacted]';

    /**
     * The entry point `config/sentry.php` names, and it is **static for a
     * reason that cost a failed deploy to learn**.
     *
     * `before_send` was first written as `new ScrubsSecrets` — an object
     * sitting in a config array. That works in every test and on every
     * developer machine, and it makes the application unbootable in
     * production: each container runs `php artisan config:cache` at start
     * (`deploy/README.md` §1), Laravel `var_export`s the whole config, and an
     * object without `__set_state()` throws *"Your configuration files are
     * not serializable"*. The container never becomes healthy and the deploy
     * stops.
     *
     * Nothing in the test suite runs `config:cache`, so nothing local could
     * have caught it. CI's deploy-stack job did, which is the entire argument
     * for that job existing.
     *
     * `[ScrubsSecrets::class, 'handle']` is an array of two strings: a valid
     * PHP callable and something `var_export` handles.
     */
    public static function handle(Event $event, ?EventHint $hint = null): ?Event
    {
        return (new self)->__invoke($event, $hint);
    }

    public function __invoke(Event $event, ?EventHint $hint = null): ?Event
    {
        $request = $event->getRequest();

        if ($request !== []) {
            $event->setRequest($this->scrub($request));
        }

        $event->setExtra($this->scrub($event->getExtra()));

        // `contexts` carries whatever the SDK and our own breadcrumbs put
        // there. The SDK types every context as an array, so there is no
        // `is_array()` guard here — Larastan level 8 rejects it as always
        // true, and a guard that can never fail is one a reader has to
        // decide the meaning of.
        foreach ($event->getContexts() as $name => $context) {
            $event->setContext($name, $this->scrub($context));
        }

        return $event;
    }

    /**
     * @param  array<array-key, mixed>  $data
     * @return array<array-key, mixed>
     */
    private function scrub(array $data): array
    {
        foreach ($data as $key => $value) {
            if (is_string($key) && $this->isSecret($key)) {
                // Replaced, not removed. An absent key reads as "the client
                // did not send one", and "the login had no password field"
                // is a materially different bug report from "the password
                // was wrong".
                $data[$key] = self::REDACTED;

                continue;
            }

            if (is_array($value)) {
                $data[$key] = $this->scrub($value);
            }
        }

        return $data;
    }

    private function isSecret(string $key): bool
    {
        // Underscores, hyphens and casing all differ between a JSON body, a
        // query string and an HTTP header for the same concept.
        $normalised = str_replace(['-', '.', ' '], '_', strtolower($key));

        foreach (self::SECRET_KEYS as $needle) {
            if (str_contains($normalised, $needle)) {
                return true;
            }
        }

        return false;
    }
}
