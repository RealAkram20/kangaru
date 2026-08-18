<?php

namespace Modules\Trips\Support;

use Modules\Trips\Models\Trip;

/**
 * How the two people on a trip reach each other (ADR-0024 §7).
 *
 * ## Why an interface for something this small
 *
 * Because the implementation behind it is the decision, and it is one this
 * platform will make twice. Today a driver and a passenger exchange their
 * real numbers, which is what every operator at this scale does and what the
 * customer's ride screen was designed against — `Captain.phone` in
 * `ride.ts`, "dialled directly from the ride screen".
 *
 * Number masking through a telephony proxy (Twilio, Africa's Talking) is the
 * privacy-correct answer, and blocking the entire feature on procuring a
 * paid account would be solving a problem the operator does not have yet at
 * a scale they have not reached. So the seam exists now and the
 * implementation is one class when it is wanted: a masked channel returns a
 * proxy number and a different label, and **nothing above this interface
 * changes** — not the resources, not the mobile app, not the ride screen.
 *
 * Adding masking later without this seam would mean touching every place a
 * number is rendered, which is exactly when one gets missed.
 */
interface ContactChannel
{
    /**
     * A number the driver can dial to reach the passenger, or null when the
     * platform will not reveal one right now.
     */
    public function forPassenger(Trip $trip): ?ContactDetails;

    /** The same, in the other direction. */
    public function forDriver(Trip $trip): ?ContactDetails;
}
