<?php

namespace Modules\Notifications\Notifications;

use Modules\Notifications\Enums\NotificationType;
use Modules\Trips\Models\TripStop;

/**
 * Tells the driver their passenger has asked to go further (ADR-0045 §4
 * amendment).
 *
 * ## Why this class exists at all
 *
 * Because the request is one half of a conversation and this is the half
 * that reaches somebody. A passenger's extension lands `proposed` and does
 * nothing until the driver answers it — nothing is routed through, nothing
 * is billed, and the trip will not wait for it at completion. Until this
 * notification existed, the only way a driver learned of one was by opening
 * the trip and noticing, with the passenger sitting beside them.
 *
 * ## What it is not
 *
 * Not an offer. `TripOfferedNotification` rings on `offers.call.v2`, takes
 * over a locked screen and counts down, because a job goes to another driver
 * in forty-five seconds if nobody answers. Nothing here expires: the driver
 * is already carrying the person who asked, and the answer can wait the few
 * seconds it takes them to look at the phone. Dressing this as a call would
 * spend the one sound the fleet has learned means *"a job is leaving"* on a
 * question that is not one — and a driver who is startled by that sound
 * twice for something that was not urgent stops trusting it.
 *
 * Carries ids and the label rather than the models, for the reason every
 * notification here does: a queued job reads the world as it runs, not as it
 * was when the decision was made.
 */
class TripExtensionRequestedNotification extends KangaruNotification
{
    public function __construct(
        private readonly int $tripId,
        private readonly int $extensionId,
        private readonly string $label,
    ) {}

    public static function for(TripStop $extension): self
    {
        return new self($extension->trip_id, $extension->id, $extension->label);
    }

    public function type(): NotificationType
    {
        return NotificationType::TRIP_EXTENSION_REQUESTED;
    }

    public function subject(): string
    {
        return 'Your passenger wants to go further';
    }

    /**
     * The place, and what to do about it.
     *
     * The label is the passenger's own words for where they want to go, and
     * it is the only thing a driver needs to decide. No name and no number:
     * this reaches a lock screen, and ADR-0025 §5 keeps that surface to what
     * the decision requires — the driver already knows who is in the car.
     */
    public function body(): string
    {
        return "They have asked to be taken on to {$this->label}. Open the app to accept or decline.";
    }

    /** A driver-app message; `url()` is an SPA path and means nothing here. */
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
            'trip_id' => $this->tripId,
            // Named `extension_id` rather than `offer_id` on purpose. The app
            // reads `offer_id` to mean "raise the call screen for a job"
            // (`routing.ts`), and a payload that borrowed the key would put
            // an incoming-call screen in front of a driver for a question
            // their passenger just asked out loud.
            'extension_id' => $this->extensionId,
            'label' => $this->label,
        ];
    }

    /**
     * Delivery, not content (ADR-0046 §2).
     *
     * Four hours, matching `DriverTripAssignedNotification`: long enough to
     * survive a tunnel or a flat battery swapped mid-shift, short enough
     * that a handset coming back after a day does not announce a request
     * about a journey that ended long ago.
     *
     * No `channelId` and no `sound`, so it lands on the app's default
     * channel with the handset's ordinary notification tone. The offer
     * ringtone belongs to the forty-five-second question; see the class
     * docblock for why this is not one.
     *
     * @return array<string, mixed>
     */
    public function pushOptions(): array
    {
        return ['ttl' => 4 * 60 * 60];
    }
}
