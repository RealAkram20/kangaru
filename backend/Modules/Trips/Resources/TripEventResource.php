<?php

namespace Modules\Trips\Resources;

use Carbon\CarbonInterface;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Modules\Administration\Resources\UserResource;
use Modules\Administration\Services\SettingsService;
use Modules\Trips\Models\TripEvent;

/**
 * @mixin TripEvent
 */
class TripEventResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'trip_id' => $this->trip_id,
            'from_status' => $this->from_status?->value,
            'to_status' => $this->to_status->value,
            'user_id' => $this->user_id,
            'user' => new UserResource($this->whenLoaded('user')),
            'notes' => $this->notes,
            'created_at' => $this->created_at,
            /*
             * The same instant in the fleet's own zone, as a clock reading.
             *
             * **`created_at` is UTC and must not be turned into a time of day on
             * a handset.** `config/app.php` is UTC, so a phone deriving 08:30
             * from it shows a Kampala driver 05:30; and a phone that has picked
             * up a neighbouring country's zone shows a third answer. The driver
             * app's trip record puts these times on a route rail beside a
             * pickup address, where being an hour out reads as a record of a
             * different journey.
             *
             * This is the pattern `DriverTripResource` already established for
             * the trips-history screen, for the same reason and with the same
             * two keys: the *server* renders the fleet-zone parts, the app only
             * formats them (`timeLabel` in `trips/history.ts`). Hermes' `Intl`
             * data also varies by platform and build, so two handsets in one
             * fleet would otherwise disagree about one trip.
             *
             * `settings.regional.timezone`, so the next market changes it in the
             * console rather than in a release. Cached — `SettingsService::get`
             * reads a `rememberForever` cache, so this is not a query per row.
             */
            'local_day' => $this->localMoment()?->format('Y-m-d'),
            'local_time' => $this->localMoment()?->format('H:i'),
        ];
    }

    /**
     * `created_at` in the fleet's zone, or null when the row has no timestamp.
     *
     * Nullable because `created_at` is: a model built in memory and never saved
     * has none, and this resource is rendered in tests over exactly that.
     */
    private function localMoment(): ?CarbonInterface
    {
        // Read as a raw attribute rather than through the `@property`
        // annotation, which declares it non-null. The *contract* disagrees —
        // `TripEvent.created_at` is served as a `NullableTimestamp` — and this
        // method has to answer for what the contract admits, not for what the
        // docblock hopes. Reading the property directly also makes the null
        // branch unreachable to PHPStan, which then reports the guard as dead.
        $createdAt = $this->getAttribute('created_at');

        if (! $createdAt instanceof CarbonInterface) {
            return null;
        }

        $configured = app(SettingsService::class)->get('regional', 'timezone');

        return $createdAt
            ->copy()
            ->setTimezone(is_string($configured) && $configured !== '' ? $configured : 'Africa/Kampala');
    }
}
