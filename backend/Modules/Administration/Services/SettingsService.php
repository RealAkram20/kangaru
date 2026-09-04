<?php

namespace Modules\Administration\Services;

use App\Models\Operator;
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
            'safety' => [
                'default' => "If you feel unsafe, your safety comes before the trip. You may end a journey and leave at any time; nothing on this platform penalises you for it, and the office would rather answer a question about a cancelled trip than an ambulance.

In an emergency, call the emergency number first. Then call the office, so a dispatcher knows where you are and can send help or send somebody to the vehicle.

While you are on duty this app reports your position to the office, so a dispatcher can already see where you are without you doing anything. **That stops when you go off duty.** If you are off duty and in trouble, say where you are on the phone — nobody can see it.

Before every trip, check the passenger's name and destination against what the app shows you. If they do not match, ring the office before you set off.

Never carry more passengers than your vehicle is licensed for, and never let somebody else drive on your account. Both put your licence and your cover at risk.

This is a short-form notice. Ask the office for the full safety policy.",
                'rules' => ['nullable', 'string', 'max:40000'],
            ],
            'privacy' => [
                'default' => "KangaruRide collects your name, phone number, email address, licence and vehicle details so that we can offer you work, dispatch you to it, and pay you for it.\n\nWhile you are on duty the app records your location, so that dispatch can offer you nearby work and so that a completed trip's distance can be checked against your odometer readings. Location is not recorded while you are off duty.\n\nWe share what we must with the client whose trip you are carrying out — typically your name, phone number and vehicle registration — and with nobody else, except where the law requires it.\n\nYou may ask us what we hold about you, ask us to correct it, and ask us to delete it when it is no longer needed for a trip record or a tax obligation. Write to the contact address published in the app.\n\nThis is a short-form notice, issued under Uganda's Data Protection and Privacy Act, 2019. A full policy will be provided before your account is activated.",
                'rules' => ['nullable', 'string', 'max:40000'],
            ],
        ],
        /*
         * Getting help when something goes wrong (ADR-0040).
         *
         * **`emergency_number` is public and short**, so the Safety screen can
         * offer it on a cold start with no token — a driver in trouble is the
         * worst possible moment to discover the app needed a round trip first.
         * It is a *setting* rather than a constant because 999 is Uganda's and
         * this platform is built to run elsewhere; PRODUCT.md's international
         * readiness means no emergency number is ever hardcoded.
         *
         * Empty by default, deliberately. An operator who has not published
         * one gets a screen that says so, and the alternative — shipping a
         * plausible default — is a driver dialling a number that does not
         * answer in their country.
         *
         * The **guidance** is in the `legal` group below rather than here,
         * for exactly the reason that group's docblock gives: it is a document,
         * it is fetched only when somebody opens the screen, and riding it
         * along with every cold start would be a cost paid by people who never
         * opened it.
         */
        'safety' => [
            'emergency_number' => [
                'default' => '',
                'rules' => ['nullable', 'string', 'max:32'],
                'public' => true,
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
            // ADR-0061. The platform-wide half of the second-factor
            // requirement; the other half is `roles.requires_mfa`.
            //
            // **Deliberately not public.** Every other flag in this group
            // is, because the login screen has to know which buttons to
            // draw. This one tells an anonymous visitor whether the
            // platform's second factor is switched off, which is a
            // sentence worth saying to nobody.
            //
            // Default true: a fresh installation behaves exactly as it
            // did before this setting existed (AGENTS.md Security).
            'mfa_enforced' => ['default' => true, 'rules' => ['required', 'boolean']],
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
            /*
             * The weekly target bonus (ADR-0034 §4).
             *
             * **Off by default**, and not because the feature is risky. It
             * creates a liability against every driver on the platform, and a
             * scheme that switches itself on at deploy is an unbudgeted bill
             * — the same argument that defaults `maps.routing_enabled` off,
             * where the cost was a metered API rather than payroll.
             *
             * The target and the amount live here rather than in a constant
             * or in the app for the reason the audit agent's finding 5 gives:
             * a threshold shipped inside a handset goes on asserting the old
             * number after the office changes it, on devices nobody can
             * reach. The driver app is never told either figure — it reads the
             * bonus that was actually awarded, and the amount is written into
             * that entry's description so an old award still explains itself.
             *
             * 40 trips and UGX 20,000 are starting values, not a policy: the
             * amount is the one the mockup drew, and the target is a week of
             * roughly six trips a day. An operator turning this on should set
             * both deliberately.
             */
            'bonus_enabled' => [
                'default' => false,
                'rules' => ['required', 'boolean'],
            ],
            'bonus_weekly_trip_target' => [
                'default' => 40,
                'rules' => ['required', 'integer', 'min:1', 'max:1000'],
            ],
            'bonus_weekly_amount_minor' => [
                'default' => 20000,
                'rules' => ['required', 'integer', 'min:0'],
            ],
            /*
             * Peak hours (ADR-0036 §2).
             *
             * A daily window in which the driver's share of a completed fare
             * is topped up by a percentage. The uplift is the platform's own
             * money — the passenger pays the ordinary tariff, so nothing here
             * changes what anybody is charged.
             *
             * **The window is modelled on `rate_card_versions.night_starts_at`
             * / `night_ends_at`** rather than given a shape of its own: same
             * `HH:MM` strings, same wrap past midnight, same resolution
             * against the fleet's timezone. A second way of writing "a window
             * of the day" is a second way of getting the wrap wrong.
             *
             * Off by default, for `bonus_enabled`'s reason exactly: switching
             * on at deploy is an unbudgeted bill against every trip on the
             * platform, and this one bills continuously rather than weekly.
             *
             * 17:00–20:00 at 20% are the mockup's figures and are starting
             * values, not policy.
             */
            'peak_enabled' => [
                'default' => false,
                'rules' => ['required', 'boolean'],
            ],
            'peak_starts_at' => [
                'default' => '17:00',
                'rules' => ['required', 'date_format:H:i'],
            ],
            'peak_ends_at' => [
                'default' => '20:00',
                'rules' => ['required', 'date_format:H:i'],
            ],
            /*
             * A percentage *of the driver's share*, not of the fare. Capped at
             * 100 because a driver earning more than double their share of a
             * fare is far likelier to be a typed extra zero than a policy, and
             * this setting spends real money on every trip until somebody
             * notices.
             */
            'peak_uplift_percent' => [
                'default' => 20,
                'rules' => ['required', 'integer', 'min:1', 'max:100'],
            ],
            /*
             * Referrals (ADR-0037 §3).
             *
             * A driver who introduces somebody is paid once, after the person
             * they introduced has completed `referral_trip_target` trips. The
             * target is what makes the scheme affordable: it pays for a driver
             * who actually works, not for a sign-up.
             *
             * Off by default, and this one has a second reason beyond cost —
             * ADR-0037 §5 makes the office's approval of every application the
             * fraud control, so an operator switching this on is also taking
             * on the job of reading the applications it will attract.
             */
            'referral_enabled' => [
                'default' => false,
                'rules' => ['required', 'boolean'],
            ],
            'referral_trip_target' => [
                'default' => 10,
                'rules' => ['required', 'integer', 'min:1', 'max:1000'],
            ],
            'referral_reward_amount_minor' => [
                'default' => 10000,
                'rules' => ['required', 'integer', 'min:0'],
            ],
        ],
        /*
         * Distance integrity — the two numbers that decide whether an
         * odometer reading is believed (ADR-0035).
         *
         * Here rather than in `config/tracking.php` because both are operator
         * policy, and an env var is not something an office can change: it
         * needs a deploy, it is invisible in the console, and it is not
         * audited. The rest of `config/tracking.php` stays where it is —
         * retention, partition headroom, the live-position TTL and the GPS
         * noise floor are engineering tuning that no office has an opinion
         * about, and a noise floor in an admin form is an invitation to break
         * distance measurement for the whole fleet.
         *
         * Both defaults match what `config/tracking.php` shipped, so an
         * existing deployment behaves identically until somebody changes them.
         */
        'tracking' => [
            /*
             * Whether drivers record opening and closing odometer readings
             * at all (ADR-0047).
             *
             * **On by default, and turning it off has a contractual cost the
             * settings screen states in words.** PROJECT.md lists "opening and
             * closing odometer (mileage) readings" as the Bank's **acceptance
             * criterion #4** for the Phase 1 MVP. A deployment that turns this
             * off stops producing that figure for every trip, corporate ones
             * included. The owner asked for a platform-wide switch knowing
             * that, having been offered a walk-in-only version; the honest
             * implementation is therefore to make it work and to make the
             * consequence impossible to miss, not to quietly narrow it.
             *
             * **`public`, because the Driver's Application renders from it.**
             * With the odometer off, Start Trip and Complete Trip are single
             * taps and the odometer screens leave the flow entirely — a field
             * that looks required and is not is worse than no field.
             *
             * When this is off the billable distance comes from the recorded
             * GPS trace, bounded by what the road allows — see
             * `TripDistanceResolver`, which is where the real design of this
             * feature lives. Nothing invents a distance: a trip with no usable
             * trace completes with a null distance and a flag, because a fare
             * guessed from nothing is worse than a fare somebody has to look
             * at.
             */
            'odometer_enabled' => [
                'default' => true,
                'rules' => ['required', 'boolean'],
                'public' => true,
            ],
            /*
             * How far past the road route a measured trace may run before it
             * stops being believable, as a percentage (ADR-0047).
             *
             * Only consulted when `odometer_enabled` is off, and it is the
             * ceiling that makes a GPS-priced fare safe to bill. Real drives
             * genuinely run longer than the route: traffic diversions, a
             * one-way system, a passenger asking for a stop. Thirty percent
             * covers that comfortably while still catching the failure that
             * matters — a jittery or spoofed trace inflating a fare with
             * nothing to check it against.
             *
             * A trace over the ceiling is **billed at the ceiling and
             * flagged**, never refused: the passenger is standing at the kerb
             * and the driver did drive somewhere. The flag is what a human
             * looks at.
             */
            'trace_route_ceiling_percent' => [
                'default' => 30,
                'rules' => ['required', 'numeric', 'min:0', 'max:200'],
            ],
            /*
             * PROJECT.md: "variances beyond a configurable threshold are
             * flagged for review." This is that threshold, as a percentage of
             * the odometer distance.
             *
             * Loose on purpose. GPS traces are noisy, and PROJECT.md's success
             * metric — flagged trips reviewed within two business days — only
             * survives while the flag stays rare and means one thing.
             */
            'variance_threshold_percent' => [
                'default' => 10,
                'rules' => ['required', 'numeric', 'min:1', 'max:100'],
            ],
            /*
             * The ceiling on a single trip's odometer delta, in kilometres.
             *
             * A refusal, not a flag: it is checked at the transition, so an
             * impossible reading never becomes a trip and therefore never
             * becomes a fare. The floor (closing below opening) has always
             * been refused this way; this is the other end of the same rule.
             *
             * 2,000 km is deliberately generous — far beyond any single
             * journey this platform dispatches, so it catches mistyped digits
             * rather than adjudicating long-distance work. An operator running
             * genuine cross-border runs should raise it; one running city work
             * only can drop it a long way and catch far more.
             *
             * It exists because a driver typed 100005 against an opening of
             * 10001 and priced a 90,004 km journey at UGX 198,013,800.
             */
            'odometer_max_km_per_trip' => [
                'default' => 2000,
                'rules' => ['required', 'integer', 'min:1', 'max:100000'],
            ],

            /*
             * Measured distance (ADR-0045, `docs/measured-distance-plan.md`).
             *
             * The knobs the distance resolver turns on. Every one is an
             * operator's business rule about when a trace is believed, not a
             * property of the receiver — the noise floor stays in
             * `config/tracking.php` for the reason ADR-0035 gives. Each row
             * of `trip_distance_evidence` records these as they stood when
             * the trip was resolved, so changing one tomorrow does not
             * restate what yesterday's fare was decided on.
             *
             * `trace_matching_enabled` defaults to **false**, like every
             * scheme in this catalogue that costs something or calls
             * somebody. Here what it calls is the OSRM server at
             * `maps.osrm_base_url` — whose default is the project's public
             * demo, rate-limited and explicitly not for production. Matching
             * every completed trip against it would be a breach of that
             * policy, so the switch is off until an operator has pointed the
             * URL at their own box. With it off the resolver still runs: it
             * measures by haversine, treats the whole trace as unmatched, and
             * grades accordingly — which is honest, and is what the shadow
             * report will show until the box exists.
             */
            'trace_matching_enabled' => ['default' => false, 'rules' => ['required', 'boolean']],
            /*
             * A trace is trustworthy — billed as measured — only when it
             * covers at least this share of the trip's duration with kept
             * pings, and at most this share of its distance was inferred by
             * routing across gaps rather than matched from pings.
             */
            'min_coverage_percent' => [
                'default' => 80,
                'rules' => ['required', 'numeric', 'min:1', 'max:100'],
            ],
            'max_inferred_share_percent' => [
                'default' => 25,
                'rules' => ['required', 'numeric', 'min:0', 'max:100'],
            ],
            /*
             * Cleaning. A ping the device itself rated less accurate than
             * this is dropped; a ping implying a faster move than this from
             * the previous kept one is a teleport and dropped; more than
             * this many teleports and the trace is not believed at all. Two
             * kept pings further apart in time than `gap_seconds` open a gap,
             * which is routed rather than assumed straight.
             */
            'max_ping_accuracy_metres' => [
                'default' => 50,
                'rules' => ['required', 'numeric', 'min:1', 'max:1000'],
            ],
            'max_plausible_speed_kph' => [
                'default' => 160,
                'rules' => ['required', 'numeric', 'min:10', 'max:400'],
            ],
            'max_teleports' => [
                'default' => 2,
                'rules' => ['required', 'integer', 'min:0', 'max:100'],
            ],
            'gap_seconds' => [
                'default' => 120,
                'rules' => ['required', 'integer', 'min:10', 'max:3600'],
            ],
            /*
             * The road's opinion. A trustworthy trace within this share of
             * the routed reference (plus half a kilometre, so a short hop is
             * not graded on a rounding error) is grade A; further out it is
             * grade B — a detour, or a road the map lacks — and still billed.
             * When the trace is *not* trustworthy the odometer stands in,
             * held between floor and ceiling of the reference; a reading
             * inside the corridor is grade B, one that had to be clamped is
             * grade C and held for review.
             */
            'route_tolerance_percent' => [
                'default' => 15,
                'rules' => ['required', 'numeric', 'min:0', 'max:100'],
            ],
            'corridor_floor_percent' => [
                'default' => 90,
                'rules' => ['required', 'numeric', 'min:1', 'max:100'],
            ],
            'corridor_ceiling_percent' => [
                'default' => 125,
                'rules' => ['required', 'numeric', 'min:100', 'max:300'],
            ],
            /*
             * Only under the `route_capped` policy: the billed figure may not
             * exceed the reference by more than this. It is a commercial
             * term — "you never pay for a detour" — and lives here so its
             * value is the operator's while its *application* is the rate
             * card version's.
             */
            'detour_cap_percent' => [
                'default' => 15,
                'rules' => ['required', 'numeric', 'min:0', 'max:100'],
            ],
            /*
             * How long after Trip Completed the resolver waits before
             * measuring. Pings arrive through a queue and the completion
             * itself through the handset's outbox, so at the moment the trip
             * completes the last batch may not have landed. Late pings after
             * this re-run the resolution; the wait just makes the first
             * answer usually the final one.
             */
            'resolution_grace_seconds' => [
                'default' => 120,
                'rules' => ['required', 'integer', 'min:0', 'max:3600'],
            ],
            /*
             * Whether a trip graded C — held — is stopped from billing
             * (Phase 2 of the plan; ADR-0045 §2). On, a held trip cannot be
             * invoiced and its walk-in fare is not settled until a person
             * with `trips.transition.finance` clears it with a reason. Off,
             * the grade is recorded and shown and the trip bills anyway.
             * Defaults on — controls default on — and is a switch rather than
             * a constant so an operator drowning in a review queue they did
             * not expect can let money move while they retune the corridor.
             */
            'held_blocks_billing' => ['default' => true, 'rules' => ['required', 'boolean']],
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
            // ADR-0040. Here rather than in the `safety` group for that
            // group's stated reason: this is a document, it is read when
            // somebody opens the Safety screen, and riding it along with
            // every cold start would be a cost paid by people who never
            // opened it.
            'safety' => (string) ($all['legal']['safety'] ?? ''),
        ];
    }

    /**
     * Settings groups that belong to Kangaru and to no fleet (ADR-0059).
     *
     * A fleet's settings write is already scoped to that fleet — `setGroup`
     * resolves `operator_id` from the `AccessContext`, so nobody can change
     * Kangaru's own defaults by accident. That makes this an **information
     * architecture** rule rather than a security one, and it is worth being
     * precise about which: the danger is not a leak, it is a fleet being
     * offered controls that make no sense for it and quietly overriding the
     * platform's identity for its own console.
     *
     * The four below are Kangaru's copy of itself:
     *
     * - `branding` — the app's name, tagline and marks. "One app, one brand,
     *   for now" is settled (`docs/platform-plan.md` §7), so a fleet
     *   rebranding KangaruRide is a feature nobody decided to build.
     * - `legal` — the terms, privacy notice and safety page a member of the
     *   public reads before handing over their data. Kangaru is the
     *   controller of that relationship, not the fleet that drove the car.
     * - `ordering` — the public order page, which is Kangaru's walk-in
     *   economy end to end.
     * - `auth` — how people sign in, and since ADR-0061 whether a second
     *   factor is asked for at all. §5 of that decision already refuses a
     *   fleet the per-role switch; leaving them the group it lives in would
     *   have been the same control by another door.
     *
     * Everything else — regional formats, booking rules, distance checks, the
     * driver app, maps, mail, SMS, payments — is genuinely a fleet's to set,
     * and a fleet overriding those is the whole point of `F1`.
     *
     * @var list<string>
     */
    public const KANGARU_ONLY_GROUPS = ['branding', 'legal', 'ordering', 'auth'];

    public function get(string $group, string $key): mixed
    {
        return $this->all()[$group][$key] ?? null;
    }

    /**
     * Whether the platform is asking for a second factor at all (ADR-0061).
     *
     * **Only `User::requiresMfa()` may call this.** It is the platform-wide
     * half of a two-part rule, and a caller that read it alongside
     * `roles.requires_mfa` and combined them itself would be a second copy of
     * a decision that has already drifted once — a person in the half-state
     * signs in with a 200 and a token and is then refused every route but
     * five, which resembles nothing.
     *
     * A missing row means **true**, and the guarantee is the catalogue default
     * above rather than the null-coalesce below: `all()` fills every key from
     * the catalogue, so `get()` returning null is already unreachable. The
     * coalesce stays as cheap defence against `all()` changing shape, and it
     * is deliberately **not** what the test pins — mutating it changes
     * nothing, which is how it was found to be unreachable.
     *
     * Either way the failure direction is the same: a settings table that
     * cannot be read must never be a way to switch authentication off.
     */
    public function mfaEnforced(): bool
    {
        $value = $this->get('auth', 'mfa_enforced');

        return $value === null ? true : (bool) $value;
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
                /*
                 * Always `smtp` in a real deployment. Overridable only so a
                 * test can reach this method at all.
                 *
                 * **`Mail::fake()` does not intercept `Mail::build()`.** It
                 * swaps the manager's resolved mailers; a mailer built here
                 * from an explicit config array is a different object and
                 * opens a real socket. So before this seam existed there was
                 * no way to assert anything about the settings mail path
                 * without an SMTP server, and a test that tried got a DNS
                 * failure rather than an assertion.
                 *
                 * That is very likely why nobody noticed that the notification
                 * `mail` channel and this method were two different paths for
                 * the whole life of the feature: the one that mattered could
                 * not be covered.
                 *
                 * `MAIL_SETTINGS_TRANSPORT` is set to `array` in phpunit.xml
                 * and nowhere else. Production reads the default.
                 */
                'transport' => (string) config('mail.settings_transport', 'smtp'),
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

        $operatorId = Setting::actingFleetId();

        foreach ($values as $key => $value) {
            $spec = $keys[$key] ?? null;

            if ($spec === null) {
                throw ValidationException::withMessages([$key => ["Unknown setting '$group.$key'."]]);
            }

            // A fleet editing a setting writes **its own override**, beside
            // Kangaru's default rather than over it (ADR-0055 §5). Reads
            // resolve the override first, so the fleet sees what it chose and
            // every other fleet keeps the default.
            //
            // Kangaru itself has a null fleet here, so head office editing a
            // setting edits the default — which is exactly the asymmetry the
            // ADR asks for: one party can change what everybody inherits, and
            // it is not a fleet.
            Setting::query()->updateOrCreate(
                ['operator_id' => $operatorId, 'group' => $group, 'key' => $key],
                [
                    'value' => ($spec['secret'] ?? false) && $value !== null
                        ? Crypt::encryptString((string) $value)
                        : $value,
                    'is_secret' => $spec['secret'] ?? false,
                ],
            );
        }

        Cache::forget(self::cacheKeyFor($operatorId));

        // A change to a **default** changes what every fleet inherits, so each
        // fleet's entry is stale too — and forgetting only the writer's key
        // would leave them serving the old value indefinitely, because these
        // entries are remembered forever.
        //
        // Enumerated rather than tagged: the cache driver here is `database`,
        // which does not support tags, and a fleet count that makes this loop
        // expensive is a fleet count this platform does not have. It cannot
        // fire today — F0 created no Kangaru accounts, so nothing can reach
        // this branch — which is precisely why it is written now rather than
        // discovered later by a fleet reading a price nobody set.
        if ($operatorId === null) {
            Operator::query()->pluck('id')
                ->each(fn ($id) => Cache::forget(self::cacheKeyFor((int) $id)));
        }
    }

    /**
     * A secret's plaintext, for the code that consumes it (a mailer, a
     * gateway client) — never for an HTTP response. Phase 1 has no
     * secret keys; the seam exists so later phases inherit the rule
     * instead of negotiating it.
     */
    public function secret(string $group, string $key): ?string
    {
        // Resolved the same way `stored()` resolves a value: the acting
        // fleet's own row first, Kangaru's default behind it. Ordering by
        // `operator_id` descending puts the fleet's row ahead of the null,
        // because a secret a fleet has set is the one that fleet's mailer or
        // gateway must use — reading everybody's default here would sign a
        // fleet's traffic with somebody else's key.
        $row = Setting::query()
            ->visibleToFleet(Setting::actingFleetId())
            ->where(['group' => $group, 'key' => $key])
            ->orderByDesc('operator_id')
            ->first();

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
        $operatorId = Setting::actingFleetId();

        /** @var array{values: array<string, mixed>, secrets: array<int, string>} */
        return Cache::rememberForever(self::cacheKeyFor($operatorId), function () use ($operatorId) {
            // Kangaru's defaults plus this fleet's overrides, with the fleet's
            // own row winning (ADR-0055 §5).
            //
            // The sort is what implements "winning" and it is doing real work:
            // `keyBy` keeps the **last** row it sees for a repeated key, so
            // putting the defaults first means a fleet's row overwrites the
            // default it shadows. Reverse the sort and every override silently
            // stops applying — which is why `FleetReferenceDataTest` asserts
            // the resolved value rather than the presence of two rows.
            $rows = Setting::query()
                ->visibleToFleet($operatorId)
                ->get()
                ->sortBy(fn (Setting $s) => $s->operator_id === null ? 0 : 1)
                ->keyBy(fn (Setting $s) => "{$s->group}.{$s->key}");

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

    /**
     * One cache entry per fleet, because one entry for everybody would serve
     * Shanitah's overrides to every other fleet (ADR-0055 §5).
     *
     * Follows ADR-0001's own convention for the client axis — *"cache keys are
     * prefixed `tenant:{id}:`"* — one level up. Kangaru gets a named key rather
     * than a bare `settings.all`, so a key that resolves to the defaults is
     * visibly the defaults and not a fleet's entry somebody forgot to scope.
     */
    private static function cacheKeyFor(?int $operatorId): string
    {
        return self::CACHE_KEY.':'.($operatorId === null ? 'kangaru' : "operator:{$operatorId}");
    }
}
