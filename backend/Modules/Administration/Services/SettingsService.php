<?php

namespace Modules\Administration\Services;

use Illuminate\Contracts\Mail\Mailer;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\Mail;
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
        // The two documents the Driver App's sign-up form requires consent
        // to. They live here rather than as pages on a marketing site so the
        // owner can correct them without a deploy — the same reason every
        // other knob in this catalogue exists.
        //
        // Deliberately NOT flagged `public`. The branding subset is fetched on
        // every landing-page load and every app cold start; a full terms
        // document pasted in by an administrator would ride along with it,
        // and on the connections this platform is built for that is a real
        // cost paid by people who never opened the document. They are served
        // instead by `GET /public/legal`, which is fetched only when somebody
        // taps the link.
        //
        // The defaults below are a genuine short-form notice rather than
        // lorem ipsum: an unconfigured deployment must still show a driver
        // something true about what they are agreeing to.
        'legal' => [
            'terms' => [
                'default' => "By creating a KangaruRide driver account you agree to:\n\n1. Provide accurate personal, licence and vehicle information, and to keep it current.\n2. Hold a valid driving licence and any permit your vehicle class requires, and to produce them on request.\n3. Carry out accepted trips and deliveries with reasonable care, and to record opening and closing odometer readings honestly.\n4. Use the app only for work KangaruRide has assigned to you.\n5. Accept that your account may be suspended for unsafe conduct, dishonest readings, or lapsed documents.\n\nKangaruRide agrees to pay for completed work at the rates published to you, and to give reasonable notice of any change to them.\n\nThis is a short-form notice. A full agreement will be provided before your account is activated.",
                'rules' => ['nullable', 'string', 'max:40000'],
            ],
            'privacy' => [
                'default' => "KangaruRide collects your name, phone number, email address, licence and vehicle details so that we can offer you work, dispatch you to it, and pay you for it.\n\nWhile you are on duty the app records your location, so that dispatch can offer you nearby work and so that a completed trip's distance can be checked against your odometer readings. Location is not recorded while you are off duty.\n\nWe share what we must with the client whose trip you are carrying out — typically your name, phone number and vehicle registration — and with nobody else, except where the law requires it.\n\nYou may ask us what we hold about you, ask us to correct it, and ask us to delete it when it is no longer needed for a trip record or a tax obligation. Write to the contact address published in the app.\n\nThis is a short-form notice, issued under Uganda's Data Protection and Privacy Act, 2019. A full policy will be provided before your account is activated.",
                'rules' => ['nullable', 'string', 'max:40000'],
            ],
        ],
        // ADR-0028: which ways into the Driver App are on, and the
        // credentials they run on. The three booleans are public because the
        // app renders its welcome screen from them — fail-closed, so a flag
        // the phone cannot fetch is a button that does not exist. The
        // credentials are not public and the Facebook secret is write-only.
        //
        // Saving `google_enabled: true` with no client ids is legal and
        // inert: the catalogue validates shape, and the auth endpoints
        // refuse with AUTH_METHOD_DISABLED until the prerequisites hold.
        'auth' => [
            'password_reset_enabled' => ['default' => false, 'rules' => ['required', 'boolean'], 'public' => true],
            'google_enabled' => ['default' => false, 'rules' => ['required', 'boolean'], 'public' => true],
            'facebook_enabled' => ['default' => false, 'rules' => ['required', 'boolean'], 'public' => true],
            // Comma-separated OAuth2 audiences: the Android, iOS and web
            // client ids this deployment's apps sign in with. The server
            // refuses a Google token minted for anybody else's app.
            //
            // Public, and safely so: client ids and app ids are public
            // identifiers by design — they ship inside every app binary —
            // and the phone needs them to *start* the native flow. The
            // secret half (the Facebook app secret below) never leaves the
            // server.
            'google_client_ids' => ['default' => '', 'rules' => ['nullable', 'string', 'max:2000'], 'public' => true],
            'facebook_app_id' => ['default' => '', 'rules' => ['nullable', 'string', 'max:100'], 'public' => true],
            'facebook_app_secret' => ['default' => null, 'rules' => ['nullable', 'string', 'max:255'], 'secret' => true],
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
        // ADR-0029 §3: what the platform keeps from a walk-in fare. The rate
        // in force at completion is written into the ledger entry, so
        // changing this never restates what a driver already earned.
        'billing' => [
            'driver_commission_percent' => [
                'default' => 20,
                'rules' => ['required', 'integer', 'min:0', 'max:100'],
            ],
        ],
        /**
         * Maps and routing (ADR-0031 pending).
         *
         * The driver app draws its maps with MapLibre against CARTO's free
         * tiles and needs no key for that — this group is only about
         * **routing**: the road-following line between two points, the road
         * distance, and the arrival estimate that comes with it.
         *
         * `api_key` is `secret`, which is not a formality. Google bills
         * Directions per request, so a leaked key is somebody else's traffic
         * on this operator's invoice. Being secret means it is encrypted at
         * rest, never returned by GET, and masked in audit (ADR-0014 §3) —
         * and it is emphatically **not** `public`, so it can never reach the
         * browser bundle or a handset. Routing is therefore a server-side
         * endpoint rather than a call from the app.
         *
         * `routing_enabled` defaults to **false**, and the default is the
         * point: configuring a key must never silently start a bill. It is a
         * separate switch from the key so an operator can stop the spend
         * without destroying the credential, and turn it back on without
         * finding it again.
         */
        'maps' => [
            'routing_enabled' => ['default' => false, 'rules' => ['required', 'boolean']],
            'routing_provider' => [
                // **OSRM by default, and the default is the useful part.** It
                // needs no key and costs nothing, so routing works the moment
                // the switch is turned on rather than after somebody has
                // opened a billing account. Google is the upgrade — better
                // traffic data, a real meter — and switching is one field.
                'default' => 'osrm',
                'rules' => ['required', 'in:google,osrm'],
            ],
            /**
             * Where OSRM lives.
             *
             * Defaults to the project's public demo server, which is free and
             * keyless and is **explicitly not for production use** under
             * OSRM's own usage policy — it is rate-limited and offered for
             * development. Point this at a self-hosted instance before any
             * real fleet depends on it: a Docker container and the Uganda
             * extract from Geofabrik, and the URL below is the only thing
             * that changes.
             */
            'osrm_base_url' => [
                'default' => 'https://router.project-osrm.org',
                'rules' => ['required', 'url', 'max:255'],
            ],
            'api_key' => ['default' => null, 'rules' => ['nullable', 'string', 'max:255'], 'secret' => true],
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

    /**
     * The two consent documents, for the unauthenticated reader.
     *
     * Separate from `publicSubset()` on purpose — see the `legal` group's
     * note in the catalogue. These are long, and they are wanted rarely.
     *
     * @return array{terms: string, privacy: string}
     */
    public function legalDocuments(): array
    {
        $all = $this->all();

        return [
            'terms' => (string) ($all['legal']['terms'] ?? ''),
            'privacy' => (string) ($all['legal']['privacy'] ?? ''),
        ];
    }

    public function get(string $group, string $key): mixed
    {
        return $this->all()[$group][$key] ?? null;
    }

    /**
     * Whether the platform can actually send email right now: the switch is
     * on and the transport has enough fields to try.
     */
    /**
     * Whether road routing can actually be asked for.
     *
     * Both halves, and the `secret()` read is why this lives here rather than
     * in a caller: `all()` deliberately never returns the key, so nothing
     * outside this service can tell a configured provider from an empty one.
     *
     * Callers treat `false` as "draw the direct line instead" rather than as
     * an error. A dropped key or a switched-off toggle must degrade the map,
     * never break the screen — a driver with a passenger in the car needs the
     * addresses far more than they need the polyline.
     */
    public function routingConfigured(): bool
    {
        $maps = $this->all()['maps'];

        if ($maps['routing_enabled'] !== true) {
            return false;
        }

        // Only Google needs a credential. OSRM is an open server and asking it
        // for a key it does not want would leave routing switched on and
        // silently dead — which is exactly the state a driver reports as "the
        // line is still straight".
        if ($maps['routing_provider'] === 'osrm') {
            return ! blank($maps['osrm_base_url']);
        }

        return ! blank($this->secret('maps', 'api_key'));
    }

    public function mailConfigured(): bool
    {
        $mail = $this->all()['mail'];

        return $mail['enabled'] === true && ! blank($mail['host']) && ! blank($mail['from_address']);
    }

    /**
     * A mailer built from the stored SMTP settings, plus the from-address it
     * must send as.
     *
     * Built at send time, never at boot (ADR-0014's `mail` note: a boot-time
     * read would make `migrate` on a fresh database depend on the table it
     * is about to create). One code path for the settings screen's test
     * send and every real mail the platform sends, so "the test email
     * worked" and "the reset email works" can never drift apart.
     *
     * @return array{mailer: Mailer, from_address: string, from_name: ?string}
     */
    public function smtpMailer(): array
    {
        $mail = $this->all()['mail'];

        return [
            'mailer' => Mail::build([
                'transport' => 'smtp',
                'host' => $mail['host'],
                'port' => $mail['port'],
                'username' => $mail['username'] ?: null,
                'password' => $this->secret('mail', 'password'),
                'encryption' => $mail['encryption'] === 'tls' ? 'tls' : null,
                'timeout' => 10,
            ]),
            'from_address' => (string) $mail['from_address'],
            'from_name' => $mail['from_name'] ?: null,
        ];
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
