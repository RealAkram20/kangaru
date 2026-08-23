<?php

namespace Modules\Trips\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Throwable;

/**
 * Public-geocoder suggestions for a stop the register does not know.
 *
 * ADR-0045 §10 built the add-a-drop-off search over the client's own place
 * register and recorded the geocoder as "a follow-up decision, not a silent
 * addition". The owner has now made it (2026-08-22, verbatim in the
 * worklog): technicians on ATM circuits are routinely sent somewhere no
 * register lists, and a typed stop with no pin gives the itinerary a row the
 * map cannot draw and the day's record cannot measure.
 *
 * ## The privacy shape is unchanged, and that is the point of this class
 *
 * What §10 actually refused was a *handset* talking to a third party and a
 * key shipping in the app bundle. Both refusals survive: the handset asks
 * this API, this API asks komoot's keyless Photon (OSM data) server-side —
 * the same engine the console's own booking form has always used from the
 * browser — and what Photon receives is the typed query alone: no driver
 * identity, no trip, no client, no coordinates other than the fixed Kampala
 * bias. `docs/data-inventory.md` names the transfer.
 *
 * ## Everything fails soft, exactly like the console's search
 *
 * A geocoder outage, a timeout, a malformed answer — all return an empty
 * list. The screen's free-text row is the floor and it never goes away; what
 * a driver loses is the pin, which is precisely what they lose today on
 * every typed stop.
 */
class PlaceSuggestionService
{
    /**
     * Kampala centre — the same bias constant the console's search uses
     * (`frontend/src/pages/public/places.ts`), so "Acacia" finds Acacia Mall
     * before anything abroad on both surfaces.
     */
    private const BIAS_LAT = 0.3476;

    private const BIAS_LON = 32.5825;

    /**
     * Sixty seconds, keyed on the folded query. Drivers on one circuit type
     * the same handful of site names; the cache is what keeps a fleet from
     * hammering a free public service with identical questions — and it is
     * deliberately short, because OSM edits are not this platform's data to
     * hold on to.
     */
    private const CACHE_SECONDS = 60;

    /**
     * @return list<array{name: string, detail: string|null, latitude: float, longitude: float}>
     */
    public function search(string $query): array
    {
        $folded = mb_strtolower(trim($query));

        if ($folded === '') {
            return [];
        }

        /** @var list<array{name: string, detail: string|null, latitude: float, longitude: float}> */
        return Cache::remember(
            'place-suggestions:'.md5($folded),
            self::CACHE_SECONDS,
            fn (): array => $this->fetch($query),
        );
    }

    /**
     * @return list<array{name: string, detail: string|null, latitude: float, longitude: float}>
     */
    private function fetch(string $query): array
    {
        try {
            // Three seconds, the same budget ExpoPushChannel runs on: this
            // sits on a request a driver is waiting for at a kerb, and a slow
            // suggestion is worth less than the free-text row already on
            // screen.
            $response = Http::timeout(3)->get('https://photon.komoot.io/api/', [
                'q' => $query,
                'lat' => self::BIAS_LAT,
                'lon' => self::BIAS_LON,
                'limit' => 6,
            ]);

            if (! $response->ok()) {
                return [];
            }

            return $this->mapFeatures($response->json('features') ?? []);
        } catch (Throwable) {
            return [];
        }
    }

    /**
     * The console's `fromPhoton` mapping, ported — same name fallback, same
     * detail composition, same "Uganda goes without saying" rule — so a place
     * reads identically whether a dispatcher found it or a driver did.
     *
     * @param  array<int, mixed>  $features
     * @return list<array{name: string, detail: string|null, latitude: float, longitude: float}>
     */
    private function mapFeatures(array $features): array
    {
        $hits = [];

        foreach ($features as $feature) {
            if (! is_array($feature)) {
                continue;
            }

            $properties = is_array($feature['properties'] ?? null) ? $feature['properties'] : [];
            $coordinates = $feature['geometry']['coordinates'] ?? null;

            // GeoJSON order: longitude first. A feature without a usable pair
            // is skipped outright — a suggestion's whole value over the
            // free-text row is the pin.
            if (! is_array($coordinates) || ! is_numeric($coordinates[0] ?? null) || ! is_numeric($coordinates[1] ?? null)) {
                continue;
            }

            $name = $properties['name']
                ?? trim(implode(' ', array_filter([$properties['street'] ?? null, $properties['housenumber'] ?? null])));

            if (! is_string($name) || $name === '') {
                continue;
            }

            $detail = implode(', ', array_values(array_filter(
                [
                    $properties['district'] ?? null,
                    $properties['city'] ?? null,
                    ($properties['country'] ?? null) === 'Uganda' ? null : ($properties['country'] ?? null),
                ],
                fn ($part) => is_string($part) && $part !== '' && $part !== $name,
            )));

            $key = mb_strtolower($name.'|'.$detail);

            // Photon answers with near-duplicates (the POI and its address
            // node); first wins, matching the console's dedupe.
            if (isset($hits[$key])) {
                continue;
            }

            $hits[$key] = [
                'name' => $name,
                'detail' => $detail === '' ? null : $detail,
                'latitude' => (float) $coordinates[1],
                'longitude' => (float) $coordinates[0],
            ];
        }

        return array_values($hits);
    }
}
