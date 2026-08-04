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
