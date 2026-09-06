<?php

namespace Modules\Trips\Routing;

/**
 * A road route between two points (ADR-0031).
 *
 * Immutable, and deliberately small: a shape to draw, a distance to state, and
 * — only when the provider supplied one — a duration.
 */
class Route
{
    /**
     * @param  string  $polyline  Google's encoded polyline. Passed through
     *                            rather than decoded server-side: it is an
     *                            order of magnitude smaller than the point
     *                            array on a handset's connection, and the map
     *                            library decodes it anyway.
     * @param  float  $distanceKm  Road distance, not the crow's flight.
     * @param  int|null  $durationSeconds  **Null unless the provider said so.**
     *                                     ADR-0031 §6: nothing derives a
     *                                     duration locally, whatever distance
     *                                     it holds — that is the invention
     *                                     ADR-0020 §3 refused, wearing a
     *                                     better number.
     */
    public function __construct(
        public readonly string $polyline,
        public readonly float $distanceKm,
        public readonly ?int $durationSeconds,
        public readonly string $provider,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'polyline' => $this->polyline,
            'distance_km' => round($this->distanceKm, 2),
            'duration_seconds' => $this->durationSeconds,
            'provider' => $this->provider,
            // Said in the payload, not only on the screen. A client that
            // receives this must label it an estimate (ADR-0031 §6), and a
            // flag travelling with the number is harder to forget than a rule
            // written in a docblock somewhere else.
            'is_estimate' => true,
        ];
    }
}
