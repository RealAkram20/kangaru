<?php

namespace Modules\Trips\Console;

use Illuminate\Console\Command;
use Modules\Trips\Distance\DistancePolicy;
use Modules\Trips\Distance\DistanceResolutionService;
use Modules\Trips\Models\Trip;

/**
 * Runs the measured-distance algorithm against one trip's stored trace and
 * prints every witness and the decision (ADR-0045; `docs/measured-distance-
 * plan.md` §6).
 *
 * The tool for arguing with a fare. A driver disputes their pay, a client
 * queries an invoice line, an operator wants to know what a tighter corridor
 * would have done — this answers from stored data, under today's thresholds,
 * and **writes nothing** unless `--commit` is passed. That flag is the
 * console's "resolve now" for a trip whose pings will never come.
 */
class ReplayTripDistance extends Command
{
    protected $signature = 'trips:replay-distance
        {trip : The trip id}
        {--policy= : gps_primary, route_capped or odometer; omitted, the rate card of the trip decides}
        {--commit : Record the outcome as a new evidence row and update the trip}';

    protected $description = 'Re-run the distance resolver on a trip and show every witness and the decision';

    public function handle(DistanceResolutionService $resolution): int
    {
        $option = $this->option('policy');
        $policy = is_string($option) && $option !== '' ? DistancePolicy::tryFrom($option) : null;

        if (is_string($option) && $option !== '' && $policy === null) {
            $this->error('Unknown policy. Use gps_primary, route_capped or odometer.');

            return self::INVALID;
        }

        // A console command has no actor and no tenant bound, which is the
        // case `allTenants()` exists for (BelongsToTenant docblock).
        $trip = Trip::allTenants()->find((int) $this->argument('trip'));

        if ($trip === null) {
            $this->error('No such trip.');

            return self::FAILURE;
        }

        $outcome = $resolution->inspect($trip, $policy);
        $trace = $outcome->trace;
        $w = $outcome->witnesses;
        $d = $outcome->decision;

        $this->line(sprintf('Trip #%d  %s → %s  status %s', $trip->id, $trip->origin, $trip->destination, $trip->status->value));
        $this->newLine();

        $this->table(['Witness', 'Value'], [
            ['Odometer', $this->km($w->odometerKm)],
            ['Trace (billable)', $this->km($w->gpsKm)],
            ['  matched by engine', $this->km($trace->gpsKm === null ? null : $trace->matchedKm)],
            ['  inferred across gaps', $this->km($trace->gpsKm === null ? null : $trace->inferredKm)],
            ['  raw haversine', $trace->cleaned->kept() >= 2 ? $this->km($trace->haversineKm) : '—'],
            ['Reference route', $this->km($w->routeKm).($outcome->reference !== null ? " (from {$outcome->reference['source']})" : '')],
            ['Coverage', $this->pct($w->coveragePercent)],
            ['Inferred share', $this->pct($w->inferredSharePercent)],
            ['Pings kept / total', "{$trace->cleaned->kept()} / {$trace->cleaned->total}"],
            ['Dropped', $this->dropped($trace->cleaned->dropped)],
            ['Gaps routed', (string) $trace->gapsRouted],
            ['Engine', $trace->provider],
            ['Stops declared', $w->stopsDeclared ? 'yes' : 'no'],
        ]);

        $this->newLine();
        $this->info(sprintf('Decision (%s): %.2f km, grade %s — %s', $d->policy->value, $d->billedKm, $d->grade->value, $d->grade->label()));
        $this->line($d->reason);

        if (! $this->option('commit')) {
            $this->newLine();
            $this->comment('Nothing written. Pass --commit to record this as the trip\'s resolution.');

            return self::SUCCESS;
        }

        $evidence = $resolution->resolve($trip, $policy);

        if ($evidence === null) {
            $this->error('Not recorded: only a completed trip can be resolved.');

            return self::FAILURE;
        }

        $this->newLine();
        $this->info("Recorded as evidence #{$evidence->id}; trip updated.");

        return self::SUCCESS;
    }

    private function km(?float $value): string
    {
        return $value === null ? '—' : sprintf('%.2f km', $value);
    }

    private function pct(?float $value): string
    {
        return $value === null ? '—' : sprintf('%.1f%%', $value);
    }

    /**
     * @param  array<string, int>  $dropped
     */
    private function dropped(array $dropped): string
    {
        $parts = [];

        foreach ($dropped as $reason => $count) {
            if ($count > 0) {
                $parts[] = "{$reason} {$count}";
            }
        }

        return $parts === [] ? 'none' : implode(', ', $parts);
    }
}
