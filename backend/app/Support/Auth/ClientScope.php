<?php

namespace App\Support\Auth;

/**
 * Which routes a token issued to a particular client app may reach
 * (ADR-0022).
 *
 * AGENTS.md: *"Sanctum tokens with expiry; token abilities scoped per client
 * app when the driver app ships."* It ships now, so this does.
 *
 * ## Why an allow-list, and why here
 *
 * A token on a driver's phone is the most losable credential this platform
 * issues. Role permissions already stop a driver reading the invoice
 * ledger, but they are about *who the person is*; this is about *what the
 * token is for*. A phone in a taxi and a browser on a desk deserve
 * different reach even when the same person holds both.
 *
 * The list is by **route name**, in one file, and it is **fail-closed**: a
 * scoped token may reach exactly what is named here and nothing else. Add a
 * route to the API and it is automatically closed to the driver app until
 * somebody decides otherwise — which is the safe direction for that
 * decision to default in. A deny-list would have the opposite property, and
 * the failure would be silent.
 *
 * Console tokens hold `*` and are unaffected. That keeps this additive: the
 * staff web app behaves exactly as it did, and only a client that asks to
 * be scoped is.
 */
final class ClientScope
{
    /** The staff web console. Holds `*` — every route, as before. */
    public const CONSOLE = 'console';

    /** The Driver's Application (React Native). Narrow by design. */
    public const DRIVER = 'driver';

    /**
     * @return array<int, string>
     */
    public static function clients(): array
    {
        return [self::CONSOLE, self::DRIVER];
    }

    /**
     * The abilities a token gets for a client.
     *
     * `*` for the console is deliberate rather than lazy. Enumerating every
     * console route would be a second copy of the route table, drifting
     * every time somebody adds a screen — and the console runs in a browser
     * behind the same session the person is already sitting at, so the
     * token buys an attacker nothing the browser did not already have.
     *
     * @return array<int, string>
     */
    public static function abilitiesFor(string $client): array
    {
        return $client === self::DRIVER ? [self::DRIVER] : ['*'];
    }

    /**
     * Route names a driver-app token may reach.
     *
     * Read this as the Driver's Application's entire API surface. If the
     * mobile team needs something not on it, that is a conversation, not a
     * config tweak — several of the omissions below are deliberate.
     *
     * @return array<int, string>
     */
    public static function routesFor(string $client): array
    {
        return match ($client) {
            self::DRIVER => [
                // Their own session and account.
                'auth.me',
                'auth.logout',
                'auth.password.change',

                // The work. `trips.index` is already scoped server-side to
                // trips assigned to them (TripController), and
                // `trips.store` is deliberately absent — creating a trip is
                // dispatch's act, not a driver's.
                'trips.index',
                'trips.show',
                'trips.events.index',
                // The road ahead (ADR-0031). Read-only, and null far more
                // often than not — no key, no signal, no pins.
                'trips.route.show',
                'trips.transitions.store',
                'trips.odometer-photo.show',

                // GPS, which is the whole point of the device being there.
                'trips.locations.store',
                'trips.locations.index',

                // Their own time off (ADR-0017 §6).
                'me.availability-requests.index',
                'me.availability-requests.store',
                'me.availability-requests.destroy',

                // Jobs offered to them, and their answer (ADR-0024 §3).
                // `me.offers.index` is the source of truth the app polls;
                // push only shortens the latency (ADR-0025 §3).
                'me.offers.index',
                'me.offers.acceptance.store',
                'me.offers.decline.store',

                // Their own numbers, for the home screen: trips and fares
                // today, acceptance and completion rate. Counted from rows
                // that already exist; nothing here is another driver's.
                'me.stats.show',

                // How they are doing over thirty days, and where they are in
                // the current bonus week (ADR-0038). Named here rather than
                // left to be discovered, because **this list fails closed and
                // no backend test can see the omission** — every test signs in
                // without a `client`, minting an unscoped console token, so an
                // endpoint passes its own suite while being 403 to the only
                // app with a screen for it. Four money endpoints shipped that
                // way; see the block below.
                'me.performance.show',

                // Who they are on the platform, and their papers (ADR-0033).
                // All three are keyed off the token — `me.documents.file`
                // takes a document id, but its policy grants a driver their
                // own row only, so an id belonging to somebody else is a 403
                // rather than a leak.
                //
                // There is no counterpart for verifying: a driver who could
                // accept their own licence is the feature inverting itself,
                // and the `drivers.documents.*` routes are absent from this
                // list for that reason rather than by omission.
                'me.profile.show',
                // Their own photograph (ADR-0041). All three are keyed off the
                // token — there is no id in any path, so none can name another
                // driver's portrait.
                'me.photo.show',
                'me.photo.store',
                'me.photo.destroy',
                'me.documents.index',
                'me.documents.store',
                'me.documents.file',

                // The money screens, and **all four of these were missing.**
                // The routes shipped; the allow-list did not follow, and this
                // list fails closed — so `GET /me/earnings` and
                // `GET /me/ledger-entries` were 403 to the only client that
                // has a screen for them. Nothing catches it but a handset:
                // every backend test signs in without a `client`, which mints
                // an unscoped console token, so the endpoints pass their own
                // suites while being unreachable from the app.
                //
                // Earnings answers *how much*, the ledger answers *why is my
                // balance that*, and `me.trips.index` answers *what did I
                // do*. All three are reads keyed off the token — there is no
                // id in any path, so none of them can name another driver.
                'me.earnings.show',
                'me.ledger-entries.index',
                'me.trips.index',
                // What is currently on offer — the Promotions screen
                // (ADR-0036, ADR-0037). A read keyed off the token like the
                // three above, so it cannot name another driver; it is on this
                // list rather than absent from it because this list fails
                // closed, and four endpoints have already shipped 403 to the
                // only client with a screen for them by being left off.
                'me.promotions.index',
                // Asking the office to settle (ADR-0032). A request, not a
                // payment: it moves no money and cannot change a balance, so
                // the write is as safe as the read beside it.
                'me.settlement-requests.index',
                'me.settlement-requests.store',

                // Going on duty, and saying where they are (ADR-0024 §2).
                // The app cannot be offered work without these, and the
                // fail-closed rule above is why they have to be named: they
                // were invisible to a driver token the moment they existed.
                'me.duty.show',
                'me.duty.update',
                'me.presence.store',

                // Where the platform operates, so the app can draw it.
                'zones.index',
                'zones.resolve',

                // Where to push a job offer (ADR-0025 §4). Registered on
                // sign-in, deleted on sign-out — a shared depot handset that
                // kept the previous driver's token would put their pickup
                // addresses on somebody else's lock screen.
                'me.devices.store',
                'me.devices.destroy',

                // Their inbox.
                'notifications.index',
                'notifications.read',
                'notifications.read-all',

                // Scoped to trips they can see, so a driver gets their own
                // vehicle and nothing else (ADR-0019).
                'live-positions.index',
            ],
            default => [],
        };
    }

    /**
     * Whether a token holding these abilities may reach this route.
     *
     * A token with `*` passes everything — that is Sanctum's own convention
     * and what every console token holds. Anything else is checked against
     * the list.
     *
     * A null `$routeName` — an unnamed route, or none matched — falls
     * through the loop and is refused, which is the wanted answer and needs
     * no branch of its own: a route with no name cannot be on a list of
     * names. There was an explicit guard here; it was deleted because no
     * mutation of it could fail a test, which is the definition of code
     * that is not doing anything.
     *
     * @param  array<int, string>  $abilities
     */
    public static function permits(array $abilities, ?string $routeName): bool
    {
        if (in_array('*', $abilities, true)) {
            return true;
        }

        foreach ($abilities as $ability) {
            if (in_array($routeName, self::routesFor($ability), true)) {
                return true;
            }
        }

        return false;
    }
}
