<?php

namespace Modules\Clients\Services;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Modules\Clients\Models\ClientPlace;
use Modules\Clients\Models\ClientRoute;

/**
 * Building and rewriting a client's routes (ADR-0045 §1).
 *
 * Everything here happens inside one transaction, because a route is only
 * meaningful as a whole: a circuit half-reordered is not a shorter circuit,
 * it is a wrong one, and a driver would be sent round it.
 */
class ClientRouteService
{
    /**
     * @param  array<string, mixed>  $attributes
     */
    public function create(array $attributes, User $actor): ClientRoute
    {
        return DB::transaction(function () use ($attributes, $actor) {
            $route = ClientRoute::query()->create([
                'name' => $attributes['name'],
                'reference' => $attributes['reference'] ?? null,
                'notes' => $attributes['notes'] ?? null,
                'is_active' => $attributes['is_active'] ?? true,
                'created_by_user_id' => $actor->id,
            ]);

            $this->replaceStops($route, $attributes['stops'] ?? []);
            $this->replaceMembers($route, $attributes['member_ids'] ?? []);

            return $route->load(['stops.place', 'members']);
        });
    }

    /**
     * @param  array<string, mixed>  $attributes
     */
    public function update(ClientRoute $route, array $attributes): ClientRoute
    {
        return DB::transaction(function () use ($route, $attributes) {
            $route->fill(array_intersect_key($attributes, array_flip([
                'name', 'reference', 'notes', 'is_active',
            ])));
            $route->save();

            // Absent means "not part of this edit"; present-and-empty means
            // "the client emptied it". `array_key_exists` is what tells the
            // two apart, and conflating them is how renaming a route would
            // silently delete its stops.
            if (array_key_exists('stops', $attributes)) {
                $this->replaceStops($route, $attributes['stops']);
            }

            if (array_key_exists('member_ids', $attributes)) {
                $this->replaceMembers($route, $attributes['member_ids']);
            }

            return $route->load(['stops.place', 'members']);
        });
    }

    /**
     * Rewrite the whole stop list, in the order given.
     *
     * ## Why delete-and-reinsert rather than shuffling rows
     *
     * `client_route_stops` has a unique key on `(client_route_id,
     * sequence)`, which is what makes an ordered list actually ordered.
     * Moving stop 5 to position 2 by updating rows in place transiently
     * violates that key no matter which order the updates are issued in,
     * and the usual dodge — offsetting everything by a thousand first — is
     * two extra writes and a magic number to explain forever.
     *
     * The list is small (a circuit is stops, not GPS pings), the parent row
     * carries the audit trail, and nothing anywhere references a stop id.
     * So the honest operation is: this route's stops are now exactly this.
     *
     * @param  array<int, array<string, mixed>>  $stops
     */
    private function replaceStops(ClientRoute $route, array $stops): void
    {
        $route->stops()->delete();

        if ($stops === []) {
            return;
        }

        $placeIds = array_values(array_unique(array_map(
            static fn (array $stop) => (int) $stop['client_place_id'],
            $stops,
        )));

        // The isolation guard, and it is not decoration. The request layer
        // validated that these ids *exist*; the tenant scope on this query
        // is what decides whether they exist **for this client**. A route
        // carrying another client's ATM would be a cross-tenant read
        // dressed as a coordinate — ADR-0001's worst bug, arriving through
        // an integer in a JSON array.
        $owned = ClientPlace::query()
            ->whereIn('id', $placeIds)
            ->pluck('id')
            ->all();

        if (count($owned) !== count($placeIds)) {
            throw ClientRouteReferenceException::places(
                array_values(array_diff($placeIds, $owned)),
            );
        }

        // Sequence is assigned from the array's order rather than trusted
        // from the payload: the client sent a list, and a list already has
        // an order. Accepting a caller's `sequence` would admit duplicates
        // and gaps that the unique key would then reject with a database
        // error instead of a sentence.
        $rows = [];
        foreach (array_values($stops) as $index => $stop) {
            $rows[] = [
                'tenant_id' => $route->tenant_id,
                'client_route_id' => $route->id,
                'client_place_id' => (int) $stop['client_place_id'],
                'sequence' => $index + 1,
                'expected_dwell_minutes' => $stop['expected_dwell_minutes'] ?? null,
                'driver_notes' => $stop['driver_notes'] ?? null,
                'created_at' => now(),
                'updated_at' => now(),
            ];
        }

        $route->stops()->insert($rows);
    }

    /**
     * @param  array<int, int>  $userIds
     */
    private function replaceMembers(ClientRoute $route, array $userIds): void
    {
        if ($userIds === []) {
            $route->members()->sync([]);

            return;
        }

        // `User` is deliberately **not** `BelongsToTenant` — login has to
        // find an account before a tenant is known (see the model's
        // docblock) — so there is no global scope doing this for us here.
        // This `where` is the whole isolation guard for membership, and its
        // absence would let a client pin a stranger to their route.
        $owned = User::query()
            ->whereIn('id', $userIds)
            ->where('tenant_id', $route->tenant_id)
            ->pluck('id')
            ->all();

        // Refused, not filtered — for the reason the exception's own
        // docblock gives about a silently shortened circuit. A team that
        // saves as two people when three were named is the same class of
        // lie, noticed later and by somebody else.
        if (count($owned) !== count(array_unique($userIds))) {
            throw ClientRouteReferenceException::members(
                array_values(array_diff(array_unique($userIds), $owned)),
            );
        }

        // The pivot carries `tenant_id` (ADR-0001 applies to join tables
        // too), and `sync()` will not invent it — a bare `sync($ids)` fails
        // on the NOT NULL column. Passing it per row is what fills it.
        $route->members()->sync(array_fill_keys($owned, ['tenant_id' => $route->tenant_id]));
    }
}
