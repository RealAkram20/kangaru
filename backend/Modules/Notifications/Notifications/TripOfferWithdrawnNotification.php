<?php

namespace Modules\Notifications\Notifications;

use Modules\Dispatch\Models\DispatchOffer;
use Modules\Notifications\Enums\NotificationType;

/**
 * Tells a handset to stop ringing (ADR-0046 §4).
 *
 * The only notification in this platform that shows nothing. It is not a
 * message to the driver at all — it is an instruction to the app, and the
 * driver's experience of it is a phone that goes quiet a few seconds sooner
 * than it otherwise would have.
 *
 * ## Why it says nothing
 *
 * Because there is nothing worth saying. "A job you did not answer has been
 * withdrawn" is a sentence about a non-event, generated once per cancelled
 * ride and once per driver in a wave — and a notification shade full of those
 * is exactly the fatigue AGENTS.md asks us to avoid. The driver finds out the
 * useful way: the ringing stops and the offer is gone from the screen.
 *
 * ## Why it is allowed to fail
 *
 * Because the guarantee lives on the device. `Ringtone` arms a deadline from
 * the offer's own window when it starts, so a handset falls silent shortly
 * after the offer could no longer be live whether or not this ever arrives —
 * and Android will not deliver a data-only push to an app it has killed
 * anyway (expo/expo#38223).
 *
 * That is not a caveat, it is the design: this is an accelerator, exactly as
 * `dispatch:advance-offers` is an accelerator for an expiry that is really a
 * clock (ADR-0024 §5). The case it serves is a *running* app — which is the
 * case that exists, because the app is ringing.
 */
class TripOfferWithdrawnNotification extends KangaruNotification
{
    public function __construct(private readonly int $offerId) {}

    public static function for(DispatchOffer $offer): self
    {
        return new self($offer->id);
    }

    public function type(): NotificationType
    {
        return NotificationType::TRIP_OFFER_WITHDRAWN;
    }

    /**
     * **Stays on the queue, and this is the deliberate half of a pair.**
     *
     * `TripOfferedNotification` took its push off the queue: a 45-second
     * countdown cannot wait for a worker, and `ring()` is called from
     * `offerWave()`, which holds no transaction — so an inline HTTP call there
     * costs a slower response and nothing else.
     *
     * **This one is the opposite case and the symmetry is a trap.** The
     * withdrawal is sent from `withdraw()`, which `accept()` calls *inside* its
     * `DB::transaction` — after a `lockForUpdate()` on the offer row and after
     * the trip has been created. Put on `sync`, this would run a three-second
     * HTTP call to a third party while holding those locks, once per losing
     * driver in the wave, sequentially. A push service having a slow minute
     * would become lock contention on `dispatch_offers` and `trips` for every
     * ride being accepted at the time.
     *
     * That is a worse failure than the one it would fix, and the reason it is
     * worse is what the class docblock already argues: **this notification is
     * an accelerator, not a guarantee.** `Ringtone` arms its own deadline from
     * the offer's window, so the handset falls silent shortly after the offer
     * could still have been live whether this arrives promptly, late, or never.
     * Nothing depends on its latency. The offer push has a passenger standing
     * at the end of it; this has a sound that was going to stop anyway.
     *
     * Written down rather than left as an absence, because the obvious next
     * edit to this file is to make it match its sibling.
     *
     * @return array<string, string|null>
     */
    public function viaConnections(): array
    {
        return parent::viaConnections();
    }

    /**
     * Never rendered — `pushIsSilent()` keeps both this and `body()` off the
     * wire. They exist because the base class requires them, and they are
     * written as though they might be shown rather than left as empty
     * strings: if a future channel ever does render this, "Job taken" is a
     * true sentence and "" is a broken screen.
     */
    public function subject(): string
    {
        return 'Job taken';
    }

    public function body(): string
    {
        return 'That job is no longer available.';
    }

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
            // What separates this from the offer push that named the same id.
            // The app reads it as an explicit true and treats everything else
            // as an ordinary offer — because the failure in that direction is
            // silencing a job it was supposed to announce.
            'withdrawn' => true,
        ];
    }

    public function pushIsSilent(): bool
    {
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function pushOptions(): array
    {
        return [
            // **The same key the offer was sent under**, so this replaces the
            // ring on the shade rather than landing beside it.
            'collapseId' => 'offer-'.$this->offerId,

            // Explicitly silent. `ExpoPushChannel` defaults every push to
            // `'default'`, which would have this one make a noise to announce
            // that a noise should stop.
            'sound' => null,

            // Short. A withdrawal delivered late is worthless — the device's
            // own deadline will have fired long before — and a stale one
            // arriving during a *later* offer is not merely useless but
            // wrong: same driver, different job, and the `collapseId` differs
            // so it would not even replace it.
            'ttl' => 60,

            // iOS needs this to wake the app for a message with no alert.
            '_contentAvailable' => true,
        ];
    }
}
