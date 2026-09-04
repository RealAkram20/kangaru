<?php

namespace Modules\Administration\Services;

use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Modules\Notifications\Enums\NotificationType;
use Modules\Notifications\Notifications\SecurityEventNotification;

/**
 * "Was this browser here before?" and the email when it was not (mail plan A5).
 *
 * See the `known_devices` migration for why the key is the user agent and not
 * the IP address. The short version: an IP-keyed device would email a driver on
 * a Ugandan mobile network every morning, and a warning that arrives daily is a
 * warning nobody reads on the day it matters.
 */
class KnownDeviceService
{
    /**
     * Records this sign-in and warns if the browser is new to the account.
     *
     * ## The first device is never announced
     *
     * An account's very first sign-in is always from an unseen browser, so
     * warning on it would mean every new user's first experience of the
     * platform is a security alert about themselves. Worse, it would fire for
     * everybody at once the day this shipped, because the table starts empty
     * and every existing account's next sign-in looks new.
     *
     * So the rule is: if the account has no known devices at all, this one is
     * recorded silently. The warning starts from the second distinct browser,
     * which is the first one that could be somebody else.
     *
     * ## Best effort, and never in the way of a sign-in
     *
     * Wrapped so a failure here cannot stop somebody signing in. A broken
     * device log is an inconvenience; a login that refuses because of one is an
     * outage, and this runs on the single most load-bearing path in the
     * platform.
     */
    public function remember(User $user, Request $request): void
    {
        try {
            $agent = trim((string) $request->userAgent());

            // No user agent at all is the ordinary shape of a scripted client
            // and of some embedded webviews. There is nothing to fingerprint
            // and nothing honest to say, so nothing is recorded rather than
            // filing every such caller under one shared empty hash.
            if ($agent === '') {
                return;
            }

            $hash = hash('sha256', $agent);

            $hadAny = DB::table('known_devices')->where('user_id', $user->id)->exists();

            $isKnown = DB::table('known_devices')
                ->where('user_id', $user->id)
                ->where('user_agent_hash', $hash)
                ->exists();

            // upsert rather than read-then-write: two simultaneous sign-ins
            // from one browser must not both decide the device is new and both
            // send an email. The unique index is what settles it.
            DB::table('known_devices')->upsert(
                [[
                    'user_id' => $user->id,
                    'user_agent_hash' => $hash,
                    'user_agent_label' => mb_substr($agent, 0, 190),
                    'last_ip' => $request->ip(),
                    'last_seen_at' => now(),
                    'created_at' => now(),
                    'updated_at' => now(),
                ]],
                ['user_id', 'user_agent_hash'],
                ['user_agent_label', 'last_ip', 'last_seen_at', 'updated_at'],
            );

            if ($isKnown || ! $hadAny) {
                return;
            }

            $user->notify(new SecurityEventNotification(
                NotificationType::ACCOUNT_SIGNED_IN_NEW_DEVICE,
                array_filter([
                    __('mail.security.fact_when') => now()->isoFormat('D MMMM YYYY, HH:mm'),
                    // The IP is shown because "where from" is the first thing
                    // somebody asks when they get one of these. It is a fact
                    // about the request, not a credential.
                    __('mail.security.fact_ip') => (string) $request->ip(),
                ]),
            ));
        } catch (\Throwable) {
            // Deliberately swallowed. See the method note: this must never be
            // the reason somebody cannot sign in.
        }
    }
}
