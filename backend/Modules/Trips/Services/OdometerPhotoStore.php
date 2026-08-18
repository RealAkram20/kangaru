<?php

namespace Modules\Trips\Services;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;

/**
 * Stores the dashboard photo that accompanies an odometer reading.
 *
 * PROJECT.md, on the anchor client's requirement: "Opening odometer reading
 * is captured at Trip Started; closing reading at Trip Completed.
 * Driver-entered value plus a dashboard photo." The reading on its own is a
 * number a driver typed; the photo is what makes it checkable.
 *
 * Paths are tenant-prefixed per ADR-0001, so a stray path can never address
 * another client's evidence:
 *
 *     tenants/{tenant}/trips/{trip}/odometer/{start|end}-{uuid}.{ext}
 *
 * The uuid rather than a fixed name means a re-submitted photo never
 * silently overwrites the one already on the record — the trip points at
 * exactly the file that was uploaded with the reading it carries.
 */
class OdometerPhotoStore
{
    /**
     * Stores the photo carried by a transition, if there is one.
     *
     * Returns null when the transition takes no photo, or when the driver
     * did not supply one — see the class notes in Modules/Trips/README.md
     * on why a missing photo does not block the trip.
     */
    public function storeForTransition(Trip $trip, TripStatus $to, ?UploadedFile $photo): ?string
    {
        if ($photo === null) {
            return null;
        }

        $moment = match ($to) {
            TripStatus::TRIP_STARTED => 'start',
            TripStatus::TRIP_COMPLETED => 'end',
            // Every other transition captures no reading, so a photo
            // attached to one is meaningless and is dropped rather than
            // stored somewhere nothing will ever look for it.
            default => null,
        };

        if ($moment === null) {
            return null;
        }

        $extension = $photo->extension() ?: 'jpg';
        $name = sprintf('%s-%s.%s', $moment, Str::uuid7(), $extension);

        return $photo->storeAs($this->directoryFor($trip), $name) ?: null;
    }

    /**
     * Where a trip's photos live, by owner (ADR-0024 §1).
     *
     * A walk-in trip has no tenant, and `sprintf('%d', null)` renders it as
     * `0` — so every walk-in photo in the platform would have piled into
     * `tenants/0/`, a directory named after a client that does not exist.
     * That is not a crash, which is exactly what makes it worth a branch:
     * it would have worked, silently, until somebody went looking for a
     * disputed odometer reading.
     *
     * The two prefixes are siblings rather than nested so that a retention
     * or export job can address either owner's files without pattern
     * matching on a path.
     */
    private function directoryFor(Trip $trip): string
    {
        return $trip->customer_id !== null
            ? sprintf('customers/%d/trips/%d/odometer', $trip->customer_id, $trip->id)
            : sprintf('tenants/%d/trips/%d/odometer', $trip->tenant_id, $trip->id);
    }

    /**
     * Removes a photo whose transition did not survive.
     *
     * Storing happens outside the database transaction — a file write is
     * not transactional, and holding a row lock open for the length of a
     * mobile upload to object storage would be worse than the orphan it
     * avoids. So the caller cleans up explicitly when the transaction it
     * belonged to rolls back.
     */
    public function discard(?string $path): void
    {
        if ($path !== null && Storage::exists($path)) {
            Storage::delete($path);
        }
    }
}
