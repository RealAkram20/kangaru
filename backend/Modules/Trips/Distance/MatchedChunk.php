<?php

namespace Modules\Trips\Distance;

/**
 * What the map-matcher made of one chunk of trace (ADR-0045).
 *
 * `matchedKm` is road distance the engine snapped the pings to.
 * `unmatchedKm` is the straight-line distance across any breaks the engine
 * left *inside* the chunk — OSRM splits a matching where consecutive pings
 * cannot be joined by road, and the jump between two matchings is a stretch
 * it could not measure. It is returned separately so the measurer can count
 * it as inferred rather than as matched, which is the honest column for it.
 *
 * `polylines` are the engine's snapped geometries, one per matching, encoded
 * as they came — the console draws them; nothing here decodes them.
 */
final class MatchedChunk
{
    /**
     * @param  array<int, string>  $polylines
     */
    public function __construct(
        public readonly float $matchedKm,
        public readonly float $unmatchedKm,
        public readonly array $polylines,
    ) {}
}
