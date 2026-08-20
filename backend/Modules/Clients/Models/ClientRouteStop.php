<?php

namespace Modules\Clients\Models;

use App\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A place's position in a route (ADR-0045 §1).
 *
 * **Not `Auditable`, deliberately.** Stops are rewritten wholesale by
 * `ClientRouteService` whenever the route is saved, so a per-stop audit
 * trail would be a stream of deletes and inserts describing a drag that the
 * route's own audit row already records as one edit. Same reasoning
 * `AppServiceProvider` gives for invoice and credit-note lines: created
 * with their parent, covered by their parent.
 *
 * Carries no copy of the place's name or coordinates. Those live on
 * `ClientPlace` and are read through the relation, so moving a pin moves it
 * everywhere at once. The one place a snapshot is correct is `trip_stops`,
 * which is evidence rather than plan.
 *
 * @property int $id
 * @property int $tenant_id
 * @property int $client_route_id
 * @property int $client_place_id
 * @property int $sequence
 * @property int|null $expected_dwell_minutes
 * @property string|null $driver_notes
 */
class ClientRouteStop extends Model
{
    use BelongsToTenant;

    protected $fillable = [
        'tenant_id',
        'client_route_id',
        'client_place_id',
        'sequence',
        'expected_dwell_minutes',
        'driver_notes',
    ];

    protected function casts(): array
    {
        return [
            'sequence' => 'integer',
            'expected_dwell_minutes' => 'integer',
        ];
    }

    /**
     * @return BelongsTo<ClientRoute, $this>
     */
    public function route(): BelongsTo
    {
        return $this->belongsTo(ClientRoute::class, 'client_route_id');
    }

    /**
     * @return BelongsTo<ClientPlace, $this>
     */
    public function place(): BelongsTo
    {
        return $this->belongsTo(ClientPlace::class, 'client_place_id');
    }
}
