<?php

namespace Modules\Notifications\Notifications;

use Modules\Dispatch\Models\DispatchOffer;
use Modules\Notifications\Channels\ExpoPushChannel;
use Modules\Notifications\Enums\NotificationType;

/**
 * Tells a driver a job is waiting for them (ADR-0024 §3, ADR-0025 §5).
 *
 * Carries scalars rather than the model, for the queue-safety reason every
 * other notification here gives: a serialised model is re-fetched by a worker
 * that may run after the row has moved on, and the offer this describes lives
 * for under a minute (`dispatch.offer_ttl_seconds`).
 *
 * ## What it deliberately does not say
 *
 * The passenger's name and number. ADR-0025 §5 is explicit: a push lands on a
 * lock screen readable by whoever is holding the phone, and ADR-0024 §7
 * releases those details only *after* the driver accepts. A driver who
 * declines should learn nothing about the person they declined.
 *
 * The pickup **is** here, because a driver cannot judge a job without knowing
 * where it starts — that is the trade ADR-0025 §5 records making explicitly.
 */
class TripOfferedNotification extends KangaruNotification
{
    public function __construct(
        private readonly int $offerId,
        private readonly ?string $pickup,
        private readonly ?float $distanceKm,
        private readonly int $expiresInSeconds,
    ) {}

    public static function for(DispatchOffer $offer): self
    {
        return new self(
            $offer->id,
            $offer->orderRequest?->pickup_location,
            $offer->pickup_distance_km === null ? null : (float) $offer->pickup_distance_km,
            // Computed here rather than sent as a timestamp: a push is read
            // on a handset whose clock may be minutes out, and "45 seconds"
            // survives that where "expires at 14:03:12" does not. The same
            // reasoning as `DispatchOfferResource::expires_in_seconds`.
            max(0, (int) now()->diffInSeconds($offer->expires_at, false)),
        );
    }

    public function type(): NotificationType
    {
        return NotificationType::TRIP_OFFERED;
    }

    public function subject(): string
    {
        // Short enough to survive a lock screen's truncation, and the
        // distance is the single most useful fact for deciding.
        return $this->distanceKm === null
            ? 'New job'
            : sprintf('New job — %.1f km away', $this->distanceKm);
    }

    public function body(): string
    {
        $where = $this->pickup === null ? 'A passenger is waiting' : "Pickup at {$this->pickup}";

        return "{$where}. Tap to accept within {$this->expiresInSeconds} seconds.";
    }

    /**
     * Null, deliberately.
     *
     * `url()` is a path into the *SPA*, and a driver holding this
     * notification is not in a browser. The app routes from `context()`
     * below — `offer_id` is what its tap handler opens.
     */
    public function url(): ?string
    {
        return null;
    }

    /**
     * @return array<string, mixed>
     */
    public function context(): array
    {
        return [
            'offer_id' => $this->offerId,
            'expires_in_seconds' => $this->expiresInSeconds,
            'pickup_distance_km' => $this->distanceKm,
        ];
    }

    /**
     * **The push goes out during the request, not from a worker.**
     *
     * The base class queues every channel but the in-app row, and for
     * everything else in the platform that is right — mail crosses a network
     * and nothing waiting on it has a clock.
     *
     * This does. `dispatch.offer_ttl_seconds` is 45, and until this override
     * the one message in the platform with a countdown on it was the one that
     * waited in a queue: `database` connection, a worker on `--sleep=2`, behind
     * whatever report export or mail batch happened to be in front of it. A
     * driver would be rung for a job with half its window already spent, or —
     * when `queue:work` was not running at all — never, while the in-app row
     * appeared normally and made it look as though the notification had been
     * sent.
     *
     * ## Why this is safe to run inline, stated rather than assumed
     *
     * Three things, and all three were already true before this line:
     *
     * - `ExpoPushChannel` swallows its own transport errors and is documented
     *   as never allowed to throw;
     * - `DispatchOfferService::ring()` wraps the `notify()` call in its own
     *   catch, for the express purpose of keeping a passenger's ride alive
     *   when push fails;
     * - `ring()` is called from `offerWave()`, which is **not** inside a
     *   transaction — so a slow Expo service delays a response, it does not
     *   hold a lock.
     *
     * The HTTP timeout is 3 seconds, which is the ceiling this adds to a
     * dispatch. `ring()`'s own docblock already claimed this connection; it was
     * describing an intention the code did not carry out.
     *
     * @return array<string, string|null>
     */
    public function viaConnections(): array
    {
        return parent::viaConnections() + [ExpoPushChannel::class => 'sync'];
    }

    /**
     * True, and this is the only notification in the platform that says so.
     *
     * A driver on duty with no registered handset will be offered this job and
     * will not hear it. See `KangaruNotification::pushIsCritical()` for why
     * that one case is worth a log line when every other empty-device case is
     * not.
     */
    public function pushIsCritical(): bool
    {
        return true;
    }

    /**
     * The one message in this platform that is allowed to ring (ADR-0046 §2).
     *
     * AGENTS.md asks for an argument rather than a use case, and ADR-0025 §5
     * already made it: this is a message with a countdown on it, which the
     * recipient must act on within seconds, and which is the only reason the
     * app is installed. Everything below follows from that sentence.
     *
     * @return array<string, mixed>
     */
    public function pushOptions(): array
    {
        return [
            // **The Android notification channel, and therefore the ringtone.**
            // The sound, importance and vibration all belong to the channel
            // rather than to the message — Android has worked that way since
            // Oreo, and a `sound` on the ticket is ignored without it.
            //
            // Versioned because **a channel is immutable once created**: past
            // its name and description, the OS refuses changes so a user's own
            // settings cannot be overridden. Changing the ringtone therefore
            // means a new id, created alongside, and this string is the half
            // of that pair the server holds. It must match
            // `mobile/src/push/channels.ts`.
            //
            // **`v2` since ADR-0049 §4**, and the reason is the immutability
            // above rather than anything wrong with `v1`. The owner asked for
            // a ring that falls silent under silent mode and Do Not Disturb;
            // `offers.v1` was created with `bypassDnd: true` and no call can
            // change that on a handset that has already run the app. So the
            // id moved, the app creates `v2` and deletes `v1` in the same
            // release, and this line moved with it.
            //
            // **These two ends have to ship together.** A server naming a
            // channel the installed app has not created does not fail — the
            // push is delivered on the default channel, silently and at
            // ordinary importance, which presents as "push works, it just
            // never rings". `TripOfferedPushTest` asserts this string; it
            // cannot assert the app's half.
            'channelId' => 'offers.v2',
            // iOS, where there are no channels and the sound rides on the
            // message. Bundled by the `expo-notifications` config plugin,
            // named without its path.
            'sound' => 'offer_ring.wav',

            // **Dies with the offer.** Expo keeps a message deliverable for
            // long enough that a push held while a handset was in a dead zone
            // would arrive afterwards and ring for a job somebody else has
            // been driving for ten minutes. That is worse than never ringing:
            // the driver reaches for a phone, reads a pickup, taps, and is
            // told they were too late for something they were never offered
            // in time.
            //
            // The same number the countdown is seeded from, so the push and
            // the screen agree about the window (ADR-0024 §5 — expiry is a
            // clock, and this is that clock expressed to the transport).
            'ttl' => $this->expiresInSeconds,
            'expiration' => now()->addSeconds($this->expiresInSeconds)->getTimestamp(),

            // One live offer per notification, replacing rather than stacking.
            // Without this a driver who was out of coverage during two waves
            // comes back to a column of job offers, all but one of them dead,
            // and has to work out which. It is also what lets a withdrawal
            // replace the ring rather than sit under it.
            'collapseId' => 'offer-'.$this->offerId,

            // iOS: breaks through a Focus mode, which is what a driver at the
            // wheel will have on. Requires the time-sensitive entitlement on
            // the provisioning profile; without it APNs downgrades the level
            // rather than refusing the push, so a build that lost the
            // entitlement degrades quietly instead of failing loudly — worth
            // checking on a real handset rather than trusting.
            'interruptionLevel' => 'time-sensitive',
        ];
    }
}
