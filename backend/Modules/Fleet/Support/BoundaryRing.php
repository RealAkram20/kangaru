<?php

namespace Modules\Fleet\Support;

/**
 * A closed ring of points, and the one question worth asking it: does it
 * contain this place? (ADR-0021)
 *
 * A value object rather than a method on `Zone`, because the geometry is
 * where the bugs live and geometry is testable in isolation. Every edge
 * case below — a point exactly on an edge, a point level with a vertex, a
 * concave shape's notch — is asserted against a known answer in
 * `BoundaryRingTest`.
 */
final class BoundaryRing
{
    /**
     * @param  array<int, array{lat: float, lng: float}>  $points
     */
    private function __construct(private readonly array $points) {}

    /**
     * @param  array<int, array<string, mixed>>  $raw
     */
    public static function fromArray(array $raw): self
    {
        return new self(array_values(array_map(
            fn (array $point) => ['lat' => (float) $point['lat'], 'lng' => (float) $point['lng']],
            $raw,
        )));
    }

    /**
     * Ray casting: count how many edges a ray heading east from the point
     * crosses. Odd means inside.
     *
     * ## The two traps
     *
     * **Vertices.** A ray passing exactly through a vertex must not count
     * the two edges meeting there twice. The half-open comparison
     * `(yi > lat) !== (yj > lat)` counts each edge only for the half it
     * owns, so a shared vertex is counted once.
     *
     * Worth knowing if you touch this: `>=` on both sides is *equivalent*
     * here — mutating one to the other leaves every test green, and that is
     * correct rather than a gap in the tests. What breaks it is mixing the
     * two, or using `<=` on one side; the diamond and concave cases below
     * fail immediately if the crossing test is wrong in any way that
     * matters.
     *
     * **Edges.** A point lying exactly on the boundary is genuinely
     * ambiguous, and ray casting will answer arbitrarily depending on which
     * side the rounding lands. `containsOrTouches` settles it explicitly:
     * a point on the boundary is **inside**. For a service area that is the
     * kinder answer — refusing an order because the pin landed on the line
     * is not something anyone can act on — and for pricing it makes zone
     * membership deterministic rather than a coin flip.
     */
    public function contains(float $lat, float $lng): bool
    {
        if ($this->touchesEdge($lat, $lng)) {
            return true;
        }

        $inside = false;
        $count = count($this->points);

        for ($i = 0, $j = $count - 1; $i < $count; $j = $i++) {
            $yi = $this->points[$i]['lat'];
            $xi = $this->points[$i]['lng'];
            $yj = $this->points[$j]['lat'];
            $xj = $this->points[$j]['lng'];

            if (($yi > $lat) !== ($yj > $lat)
                && $lng < ($xj - $xi) * ($lat - $yi) / ($yj - $yi) + $xi) {
                $inside = ! $inside;
            }
        }

        return $inside;
    }

    /**
     * Whether the point lies on the ring itself, within a tolerance of
     * roughly a metre.
     *
     * The tolerance is not fussiness: a boundary drawn on a map and a GPS
     * fix will never agree to the seventh decimal place, and a zone whose
     * edge is a hairline nobody can land on is a zone that behaves
     * randomly at its border.
     */
    private function touchesEdge(float $lat, float $lng): bool
    {
        $tolerance = 0.00001; // ~1.1 m
        $count = count($this->points);

        for ($i = 0, $j = $count - 1; $i < $count; $j = $i++) {
            if ($this->distanceToSegment(
                $lat, $lng,
                $this->points[$j]['lat'], $this->points[$j]['lng'],
                $this->points[$i]['lat'], $this->points[$i]['lng'],
            ) <= $tolerance) {
                return true;
            }
        }

        return false;
    }

    private function distanceToSegment(
        float $lat, float $lng,
        float $aLat, float $aLng,
        float $bLat, float $bLng,
    ): float {
        $dLat = $bLat - $aLat;
        $dLng = $bLng - $aLng;

        $lengthSquared = $dLat * $dLat + $dLng * $dLng;

        // A degenerate edge — two identical consecutive points, which a
        // hand-drawn boundary produces easily — is just the point itself.
        if ($lengthSquared === 0.0) {
            return sqrt(($lat - $aLat) ** 2 + ($lng - $aLng) ** 2);
        }

        $t = max(0.0, min(1.0, (($lat - $aLat) * $dLat + ($lng - $aLng) * $dLng) / $lengthSquared));

        return sqrt(($lat - ($aLat + $t * $dLat)) ** 2 + ($lng - ($aLng + $t * $dLng)) ** 2);
    }

    /**
     * @return array<int, array{lat: float, lng: float}>
     */
    public function points(): array
    {
        return $this->points;
    }
}
