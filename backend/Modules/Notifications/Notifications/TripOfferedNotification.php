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
            // Either owner (ADR-0068). `DispatchOffer::pickup()` is what
            // knows that a walk-in calls this `pickup_location` and a
            // booking calls it `origin`; asking here would put a second
            // opinion about that in a second file, and the ring is the one
            // path where the two channels must stay identical.
            $offer->pickup(),
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
     * Headless, so the only thing a driver ever sees is the call screen.
     *
     * ## The decision this records (owner, 31 August 2026, asked twice)
     *
     * The offer used to go out as a *pair*: a visible "New job — tap to
     * accept" push as the floor, and an invisible companion that woke the
     * app's JavaScript to raise the answerable incoming-call notification,
     * which then withdrew the visible one. The owner watched that replacement
     * fail on a handset — wake-up delayed, call screen skipped, the plain
     * banner sitting there un-answerable — and made the call the design had
     * been avoiding: **no plain push at all.** One headless message *is* the
     * wake-up; the call screen, with Decline and Accept on it, is the only
     * surface an offer ever has.
     *
     * ## What was knowingly given up
     *
     * The floor. A handset whose JavaScript cannot run — force-stopped, an
     * OEM battery manager, expo/expo#38223 on a terminated process — used to
     * at least ring with the plain banner. It now gets nothing until the app
     * is next opened, where `GET /me/offers` still has the job (ADR-0025 §3).
     * Do not quietly reinstate a visible variant to soften that: it is the
     * exact notification the owner asked to see gone.
     */
    public function pushIsSilent(): bool
    {
        return true;
    }

    /**
     * How the one headless message is delivered (ADR-0046 §2, ADR-0049 §3).
     *
     * No `channelId` and no ringtone here: nothing is rendered from this
     * message, so Android never consults a channel for it. The ring now
     * belongs entirely to the app's own call notification —
     * `mobile/src/push/channels.ts` creates `offers.call.v2`, and
     * `showCallNotification` loops the sound on it.
     *
     * @return array<string, mixed>
     */
    public function pushOptions(): array
    {
        return [
            // Explicitly silent. `ExpoPushChannel` defaults every push to
            // `'default'`, and a headless message must not carry a noise.
            'sound' => null,

            // **Dies with the offer.** Expo keeps a message deliverable for
            // long enough that a push held while a handset was in a dead zone
            // would arrive afterwards and wake the app for a job somebody
            // else has been driving for ten minutes. `raiseOfferCall` would
            // find nothing live and stay silent — battery spent, no harm —
            // but there is no reason to deliver it at all.
            //
            // The same number the countdown is seeded from, so the push and
            // the screen agree about the window (ADR-0024 §5 — expiry is a
            // clock, and this is that clock expressed to the transport).
            'ttl' => $this->expiresInSeconds,
            'expiration' => now()->addSeconds($this->expiresInSeconds)->getTimestamp(),

            // One live offer per handset, replacing rather than stacking, and
            // **the same key `TripOfferWithdrawnNotification` sends under** —
            // that is what lets a withdrawal replace an undelivered wake-up
            // in FCM's queue instead of landing beside it.
            'collapseId' => 'offer-'.$this->offerId,

            // iOS: the flag that makes APNs deliver a payload with nothing to
            // show. Without it a body-less push is simply dropped. Same line
            // the withdrawal carries, for the same reason.
            '_contentAvailable' => true,
        ];
    }
}
