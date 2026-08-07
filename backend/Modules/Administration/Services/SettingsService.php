<?php

namespace Modules\Administration\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;
use Modules\Administration\Models\Setting;

/**
 * The only reader and only writer of the settings table (ADR-0014).
 *
 * The catalogue below is the law: a group/key pair absent from it cannot
 * be written, exactly as ADR-0004 keeps permissions in code. Each entry
 * carries its default (what get() answers before anyone saves), its
 * validation rules, whether it is a secret (write-only, encrypted at
 * rest, masked in audit) and whether it is public (served to the
 * unauthenticated branding endpoint — nothing outside that flag can leak
 * by adding rows).
 */
class SettingsService
{
    private const CACHE_KEY = 'settings.all';

    /**
     * Entry shape: {default: mixed, rules: string[], secret?: bool,
     * public?: bool}.
     */
    private const CATALOGUE = [
        'branding' => [
            'app_name' => ['default' => 'KangaruRide', 'rules' => ['required', 'string', 'max:60'], 'public' => true],
            'tagline' => ['default' => 'For Safety and Reliability', 'rules' => ['nullable', 'string', 'max:120'], 'public' => true],
            'meta_description' => ['default' => 'Rides, deliveries and self-drive rentals across Kampala — corporate fleets on rate-card billing.', 'rules' => ['nullable', 'string', 'max:300'], 'public' => true],
            'contact_email' => ['default' => 'operations@kangaruride.com', 'rules' => ['required', 'email', 'max:190'], 'public' => true],
            'contact_phone' => ['default' => '', 'rules' => ['nullable', 'string', 'max:32'], 'public' => true],
            'logo_path' => ['default' => null, 'rules' => ['nullable', 'string', 'max:255'], 'public' => true],
            'favicon_path' => ['default' => null, 'rules' => ['nullable', 'string', 'max:255'], 'public' => true],
        ],
        'regional' => [
            'currency' => ['default' => 'UGX', 'rules' => ['required', 'string', 'size:3'], 'public' => true],
            'timezone' => ['default' => 'Africa/Kampala', 'rules' => ['required', 'string', 'timezone:all', 'max:64']],
            'date_format' => ['default' => 'DD MMM YYYY', 'rules' => ['required', 'string', 'max:20']],
        ],
        // Phase 2 (ADR-0014 §7). `walk_in_enabled` is public so the order
        // form can explain a pause instead of failing at submit; the rate
        // limit is the number ADR-0012 promised would "move by config".
        'ordering' => [
            'walk_in_enabled' => ['default' => true, 'rules' => ['required', 'boolean'], 'public' => true],
            'rate_limit_per_minute' => ['default' => 3, 'rules' => ['required', 'integer', 'min:1', 'max:60']],
        ],
        'booking' => [
            // On by default: approval is a control, and controls default
            // on. Switching it off makes BookingService auto-approve on
            // creation — the owner's call, recorded here and in audit.
            'approval_required' => ['default' => true, 'rules' => ['required', 'boolean']],
            'max_advance_days' => ['default' => 90, 'rules' => ['required', 'integer', 'min:1', 'max:365']],
        ],
        // Phase 3 (ADR-0014 §7): SMTP. The first real user of the
        // write-only secret rule. Consumed at send time (the test
        // endpoint today, password reset when ADR-0013's deferral lifts),
        // never applied at boot — a boot-time read would make `php
        // artisan migrate` on a fresh database depend on the table it is
        // about to create.
        'mail' => [
            'enabled' => ['default' => false, 'rules' => ['required', 'boolean']],
            'host' => ['default' => '', 'rules' => ['nullable', 'string', 'max:255']],
            'port' => ['default' => 587, 'rules' => ['required', 'integer', 'min:1', 'max:65535']],
            'username' => ['default' => '', 'rules' => ['nullable', 'string', 'max:255']],
            'password' => ['default' => null, 'rules' => ['nullable', 'string', 'max:255'], 'secret' => true],
            'encryption' => ['default' => 'tls', 'rules' => ['required', 'in:tls,none']],
            'from_address' => ['default' => '', 'rules' => ['nullable', 'email', 'max:190']],
            'from_name' => ['default' => '', 'rules' => ['nullable', 'string', 'max:120']],
        ],
        // Phase 4 (ADR-0014 §7): SMS gateway credentials — STORED ONLY.
        // No SMS flow exists and none may ship without its own decision
        // record (AGENTS.md: SMS-pumping fraud posture). There is no
        // `enabled` key here on purpose: a switch that switches nothing
        // teaches people to stop reading switches.
        'sms' => [
            'provider' => ['default' => '', 'rules' => ['nullable', 'in:,africastalking,twilio']],
            'sender_id' => ['default' => '', 'rules' => ['nullable', 'string', 'max:20']],
            'api_key' => ['default' => null, 'rules' => ['nullable', 'string', 'max:255'], 'secret' => true],
            'api_secret' => ['default' => null, 'rules' => ['nullable', 'string', 'max:255'], 'secret' => true],
        ],
        // Phase 5 (ADR-0014 §7): payment gateway credentials — STORED
        // ONLY, same reasoning. Enabling payments needs the payments ADR
        // that ADR-0005 and ADR-0012 both point at; these slots exist so
        // that launch is a code change, not a credentials scramble.
        'payments' => [
            'mtn_momo_api_user' => ['default' => '', 'rules' => ['nullable', 'string', 'max:255']],
            'mtn_momo_api_key' => ['default' => null, 'rules' => ['nullable', 'string', 'max:255'], 'secret' => true],
            'airtel_money_client_id' => ['default' => '', 'rules' => ['nullable', 'string', 'max:255']],
            'airtel_money_client_secret' => ['default' => null, 'rules' => ['nullable', 'string', 'max:255'], 'secret' => true],
        ],
    ];

    /**
     * The catalogue, typed loosely on purpose: phase 1 ships no `secret`
     * key, and the const's literal-inferred type would let phpstan
     * declare the secret branches below dead right up until phase 3
     * needs them. A method return type is the one annotation it takes
     * at face value.
     *
     * @return array<string, array<string, array<string, mixed>>>
     */
    public static function catalogue(): array
    {
        return self::CATALOGUE;
    }

    /**
     * Every group with every key resolved: stored value where one
     * exists, catalogue default where none does, secrets replaced by
     * `configured`. This is the GET /settings shape.
     *
     * @return array<string, array<string, mixed>>
     */
    public function all(): array
    {
        ['values' => $values, 'secrets' => $configured] = $this->stored();
        $out = [];

        foreach (self::catalogue() as $group => $keys) {
            foreach ($keys as $key => $spec) {
                if ($spec['secret'] ?? false) {
                    $out[$group][$key] = ['configured' => in_array("$group.$key", $configured, true)];
                } else {
                    $out[$group][$key] = array_key_exists("$group.$key", $values)
                        ? $values["$group.$key"]
                        : $spec['default'];
                }
            }
        }

        return $out;
    }

    /**
     * The unauthenticated subset: only keys flagged `public`.
     *
     * @return array<string, array<string, mixed>>
     */
    public function publicSubset(): array
    {
        $all = $this->all();
        $out = [];

        foreach (self::catalogue() as $group => $keys) {
            foreach ($keys as $key => $spec) {
                if ($spec['public'] ?? false) {
                    $out[$group][$key] = $all[$group][$key];
                }
            }
        }

        // Paths become URLs at the edge: the frontend runs on another
        // origin and cannot resolve a disk-relative path.
        foreach (['logo_path', 'favicon_path'] as $asset) {
            $path = $out['branding'][$asset] ?? null;
            $out['branding'][$asset] = is_string($path) && $path !== ''
                ? Storage::disk('public')->url($path)
                : null;
        }

        return $out;
    }

    public function get(string $group, string $key): mixed
    {
        return $this->all()[$group][$key] ?? null;
    }

    /**
     * Writes one group. Unknown keys are refused loudly — a silent skip
     * would make a typo in the client look like a saved setting.
     *
     * @param  array<string, mixed>  $values
     */
    public function setGroup(string $group, array $values): void
    {
        $keys = self::catalogue()[$group] ?? null;

        if ($keys === null) {
            throw ValidationException::withMessages(['group' => ["Unknown settings group '$group'."]]);
        }

        foreach ($values as $key => $value) {
            $spec = $keys[$key] ?? null;

            if ($spec === null) {
                throw ValidationException::withMessages([$key => ["Unknown setting '$group.$key'."]]);
            }

            Setting::query()->updateOrCreate(
                ['group' => $group, 'key' => $key],
                [
                    'value' => ($spec['secret'] ?? false) && $value !== null
                        ? Crypt::encryptString((string) $value)
                        : $value,
                    'is_secret' => $spec['secret'] ?? false,
                ],
            );
        }

        Cache::forget(self::CACHE_KEY);
    }

    /**
     * A secret's plaintext, for the code that consumes it (a mailer, a
     * gateway client) — never for an HTTP response. Phase 1 has no
     * secret keys; the seam exists so later phases inherit the rule
     * instead of negotiating it.
     */
    public function secret(string $group, string $key): ?string
    {
        $row = Setting::query()->where(['group' => $group, 'key' => $key])->first();

        if ($row === null || ! $row->is_secret || $row->value === null) {
            return null;
        }

        return Crypt::decryptString($row->value);
    }

    /**
     * One cache entry for everything a read needs: non-secret values
     * keyed "group.key", plus which secret keys are configured — their
     * existence is readable, their plaintext never is.
     *
     * @return array{values: array<string, mixed>, secrets: array<int, string>}
     */
    private function stored(): array
    {
        /** @var array{values: array<string, mixed>, secrets: array<int, string>} */
        return Cache::rememberForever(self::CACHE_KEY, function () {
            $rows = Setting::query()->get();

            return [
                'values' => $rows->where('is_secret', false)
                    ->mapWithKeys(fn (Setting $s) => ["{$s->group}.{$s->key}" => $s->value])
                    ->all(),
                'secrets' => $rows->where('is_secret', true)
                    ->whereNotNull('value')
                    ->map(fn (Setting $s) => "{$s->group}.{$s->key}")
                    ->values()
                    ->all(),
            ];
        });
    }
}
