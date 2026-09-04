<?php

namespace Modules\Trips\Events;

use Illuminate\Foundation\Events\Dispatchable;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;

/**
 * A trip moved from one status to another — announced, not acted on, like
 * `TripCompleted` before it.
 *
 * `TripCompleted` stays: it is the moment a fare can exist and three
 * listeners hang off it. This is the wider signal, fired for every
 * transition (and for creation, with `$from` null) so that whoever is
 * waiting for the car — the client's employee who booked it — can be told
 * when it was assigned, when the driver arrived, and when it finished,
 * without this module knowing that anybody sends notifications.
 *
 * Dispatched inside the same transaction as the status write; a rolled-back
 * transition never reaches a listener.
 */
class TripStatusChanged
{
    use Dispatchable;

    public function __construct(
        public readonly Trip $trip,
        public readonly ?TripStatus $from,
        public readonly TripStatus $to,
    ) {}
}
