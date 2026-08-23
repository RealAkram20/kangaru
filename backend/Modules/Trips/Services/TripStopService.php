<?php

namespace Modules\Trips\Services;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Modules\Clients\Models\ClientPlace;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Enums\TripStopSource;
use Modules\Trips\Enums\TripStopStatus;
use Modules\Trips\Models\Trip;
use Modules\Trips\Models\TripStop;

/**
 * The only writer of `trip_stops` (ADR-0045).
 *
 * Two kinds of write and nothing else: the add (§4 — a driver at a kerb, or
 * an office through the same endpoint), and the arrive/depart stamps that
 * ride on the transitions §2 reuses. Stops are evidence; there is no update
 * path and no delete path, and a skip (§6) will be its own narrow act when a
 * surface needs it.
 */
class TripStopService
{
    /**
     * The statuses during which a run's itinerary may grow — the journey
     * itself, exactly the three `TripInProgressScreen` owns. Mirrored by the
     * candidates endpoint: §10 bounds what a driver sees to the client whose
     * trip they are *currently driving*.
     */
    public const ACTIVE_STATUSES = [
        TripStatus::TRIP_STARTED,
        TripStatus::WAITING,
        TripStatus::TRIP_RESUMED,
    ];

    /**
     * Appends a stop to a live run.
     *
     * `$attributes` is `StoreTripStopRequest::validated()`: either a
     * `client_place_id` (the saved-place pick — label and pin are copied from
     * the register, §1's copy-not-reference), or a free-text `label` with an
     * optional coordinate pair.
     *
     * Sequence is assigned under a lock on the trip row, so two adds racing
     * each other queue rather than colliding on the unique `(trip_id,
     * sequence)` key. `unplanned_stop_count` counts `ADDED_BY_DRIVER` only —
     * §4's flag is about the driver departing from the plan, and an office
     * adding a stop mid-run *is* the plan changing.
     *
     * @param  array<string, mixed>  $attributes
     */
    public function add(Trip $trip, array $attributes, User $actor, TripStopSource $source): TripStop
    {
        $place = $this->resolvePlace($trip, $attributes);

        return DB::transaction(function () use ($trip, $attributes, $place, $source) {
            // Serialises concurrent adds on one trip. The stops themselves
            // cannot be locked — a first add has no rows to lock.
            Trip::query()->withoutGlobalScopes()->whereKey($trip->getKey())->lockForUpdate()->first();

            $sequence = ((int) TripStop::query()->forTrip($trip)->max('sequence')) + 1;

            $stop = TripStop::query()->create([
                'tenant_id' => $trip->tenant_id,
                'trip_id' => $trip->id,
                'client_place_id' => $place?->id,
                'sequence' => $sequence,
                'label' => $place->name ?? $attributes['label'],
                'latitude' => $place->latitude ?? $attributes['latitude'] ?? null,
                'longitude' => $place->longitude ?? $attributes['longitude'] ?? null,
                'source' => $source,
                'status' => TripStopStatus::PENDING,
            ]);

            if ($source === TripStopSource::ADDED_BY_DRIVER) {
                $trip->newQueryWithoutScopes()->whereKey($trip->getKey())->increment('unplanned_stop_count');
            }

            return $stop;
        });
    }

    /**
     * The §2 side effects, called by `TripStateMachine` inside its
     * transaction and nowhere else.
     *
     * - `waiting` with a `stop_id` → the stop is arrived at.
     * - `trip_resumed` → whichever stop is currently `arrived` is departed
     *   from.
     *
     * **There is deliberately no `trip_completed` branch.** The graph's only
     * exit from `waiting` is `trip_resumed` — `TripInProgressScreen` renders
     * around exactly that edge — so an arrived stop cannot survive to
     * completion; the resume that legalised completing already closed it. A
     * *pending* stop can, and stays pending: a run that ended before its
     * itinerary did is evidence, not a loose end to tidy (§6's posture).
     *
     * Returns the timeline remark and the stop id the `trip_events` row
     * should carry — both null when the transition had nothing to do with
     * stops, which is every transition on every point-to-point trip.
     *
     * A `stop_id` that is no longer pending is ignored rather than refused:
     * the pause it rides on is a billable act (`WaitingTimeCalculator`), and
     * a driver's hold must not be refused over a stop row a concurrent write
     * beat it to. The request layer has already validated it existed.
     *
     * @return array{0: string|null, 1: int|null}
     */
    public function applyTransition(Trip $trip, TripStatus $to, ?int $stopId): array
    {
        if ($to === TripStatus::WAITING && $stopId !== null) {
            $stop = TripStop::query()->forTrip($trip)
                ->whereKey($stopId)
                ->where('status', TripStopStatus::PENDING)
                ->first();

            if ($stop === null) {
                return [null, null];
            }

            $stop->forceFill(['status' => TripStopStatus::ARRIVED, 'arrived_at' => now()])->save();

            return ['Arrived at '.$stop->label.'.', $stop->id];
        }

        if ($to === TripStatus::TRIP_RESUMED) {
            $stop = TripStop::query()->forTrip($trip)
                ->where('status', TripStopStatus::ARRIVED)
                ->first();

            if ($stop === null) {
                return [null, null];
            }

            $stop->forceFill(['status' => TripStopStatus::DONE, 'departed_at' => now()])->save();

            return ['Departed '.$stop->label.'.', $stop->id];
        }

        return [null, null];
    }

    /**
     * The saved place behind an add, validated to be the trip's own client's.
     *
     * A 422 with a sentence rather than a 404: the id arrived in a request
     * body, not a route, and the message deliberately does not distinguish
     * "not yours" from "does not exist" — the same masking rule ADR-0001
     * applies to routes. Queried past the tenant scope because the caller is
     * a driver with no tenant bound; the explicit `tenant_id` filter *is* the
     * isolation, and a walk-in trip (null tenant) matches no place at all.
     *
     * @param  array<string, mixed>  $attributes
     */
    private function resolvePlace(Trip $trip, array $attributes): ?ClientPlace
    {
        $placeId = $attributes['client_place_id'] ?? null;

        if ($placeId === null) {
            return null;
        }

        $place = ClientPlace::query()
            ->withoutGlobalScopes()
            ->whereKey($placeId)
            ->where('tenant_id', $trip->tenant_id)
            ->whereNull('deleted_at')
            ->active()
            ->first();

        // A walk-in trip (null tenant) matches no place above — `tenant_id`
        // is NOT NULL on `client_places` — so it lands here with the rest.
        if ($place === null) {
            throw ValidationException::withMessages([
                'client_place_id' => 'That saved place is not available for this trip.',
            ]);
        }

        return $place;
    }
}
