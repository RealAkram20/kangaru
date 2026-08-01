<?php

namespace Database\Seeders;

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Illuminate\Database\Seeder;
use Illuminate\Support\Carbon;
use Modules\Bookings\Models\Booking;
use Modules\Dispatch\Services\DispatchService;
use Modules\Drivers\Models\Driver;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Trips\Services\TripStateMachine;
use Modules\Vehicles\Models\Vehicle;

/**
 * Local/staging demo data: a small fleet and a spread of trips across the
 * lifecycle, including one fully closed trip carrying all six of the Bank's
 * acceptance criteria (PROJECT.md).
 *
 * Trips are driven through the real TripStateMachine rather than inserted
 * at a chosen status, so every seeded trip has a truthful, correctly
 * ordered trip_events timeline. Seed data that skipped the state machine
 * would demo a timeline the product cannot actually produce.
 */
class DemoFleetSeeder extends Seeder
{
    public function run(): void
    {
        foreach (Tenant::all() as $tenant) {
            $this->seedTenant($tenant);
        }
    }

    private function seedTenant(Tenant $tenant): void
    {
        // TripStateMachine::transition() calls $trip->refresh(), which goes
        // through TenantScope — and that scope fails closed when no tenant
        // is bound. Console commands never pass through IdentifyTenant, so
        // the context is set by hand here.
        app(TenantContext::class)->set($tenant->id);

        $dispatcher = User::factory()->create([
            'tenant_id' => $tenant->id,
            'name' => 'Dispatch Desk',
            'email' => 'dispatch@'.$tenant->slug.'.test',
            'role' => UserRole::DISPATCHER,
        ]);

        $requester = User::factory()->create([
            'tenant_id' => $tenant->id,
            'name' => 'Staff Requester',
            'email' => 'staff@'.$tenant->slug.'.test',
            'role' => UserRole::CORPORATE_EMPLOYEE,
        ]);

        $vehicles = collect([
            Vehicle::factory()->forTenant($tenant)->van()->create(),
            Vehicle::factory()->forTenant($tenant)->create(['category' => 'sedan']),
            Vehicle::factory()->forTenant($tenant)->create(['category' => 'suv', 'model' => 'Land Cruiser']),
        ]);

        $drivers = collect([
            Driver::factory()->forTenant($tenant)->create(),
            Driver::factory()->forTenant($tenant)->create(),
            Driver::factory()->forTenant($tenant)->create(),
        ]);

        $machine = app(TripStateMachine::class);
        $dispatchService = app(DispatchService::class);

        $routes = [
            ['Kampala', 'Entebbe Airport'],
            ['Kampala', 'Jinja'],
            ['Nakawa Branch', 'Mbarara'],
            ['Kampala', 'Gulu'],
            ['Kampala', 'Mukono'],
        ];

        // Each entry: how far through the lifecycle to drive, how long the
        // trip ran, and the odometer pair. Enough variety that the trips
        // list shows several distinct statuses at a glance.
        $plans = [
            ['stop' => TripStatus::CLOSED, 'minutes' => 95, 'odometer' => [42_180, 42_222]],
            ['stop' => TripStatus::TRIP_COMPLETED, 'minutes' => 140, 'odometer' => [18_400, 18_487]],
            ['stop' => TripStatus::TRIP_STARTED, 'minutes' => 0, 'odometer' => [7_920, null]],
            ['stop' => TripStatus::DRIVER_ARRIVED, 'minutes' => 0, 'odometer' => [null, null]],
            ['stop' => TripStatus::CANCELLED, 'minutes' => 0, 'odometer' => [null, null]],
        ];

        $realNow = now();

        foreach ($plans as $index => $plan) {
            [$origin, $destination] = $routes[$index];

            // The whole trip — row, opening event and every transition —
            // is written under a wound-back clock. Creating the trip at
            // real "now" and only the transitions in the past would stamp
            // the opening Assigned event *after* the transitions that
            // follow it, and trip_events is ordered by created_at.
            Carbon::setTestNow($realNow->copy()->subHours(8 - $index));

            // Goes through the real Bookings -> Dispatch path rather than
            // writing a Trip directly, so the demo data exercises the
            // pessimistic-lock assignment and every seeded trip has the
            // booking it came from.
            $booking = Booking::factory()->forTenant($tenant)->create([
                'requested_by_user_id' => $requester->id,
                'origin' => $origin,
                'destination' => $destination,
            ]);

            $trip = $dispatchService->assign(
                $booking,
                $vehicles[$index % $vehicles->count()]->id,
                $drivers[$index % $drivers->count()]->id,
                $dispatcher,
            );

            $this->drive($machine, $trip, $dispatcher, $plan);
        }

        // One booking left unassigned per tenant so the dispatch queue is
        // not empty when the page is opened.
        Carbon::setTestNow($realNow->copy()->subMinutes(20));
        Booking::factory()->forTenant($tenant)->create([
            'requested_by_user_id' => $requester->id,
            'origin' => 'Kampala',
            'destination' => 'Masaka',
            'passenger_count' => 3,
        ]);

        Carbon::setTestNow();
        app(TenantContext::class)->set(null);
    }

    /**
     * @param  array{stop: TripStatus, minutes: int, odometer: array{0: ?int, 1: ?int}}  $plan
     */
    private function drive(TripStateMachine $machine, Trip $trip, User $actor, array $plan): void
    {
        [$odometerStart, $odometerEnd] = $plan['odometer'];

        // The caller has already wound the clock back to this trip's
        // dispatch time; each step below nudges it forward so the timeline
        // reads as elapsed minutes rather than one instant. The duration
        // figure on a completed trip is a Bank acceptance criterion and
        // must be a real elapsed time, not a fabricated column.
        if ($plan['stop'] === TripStatus::CANCELLED) {
            Carbon::setTestNow(now()->addMinutes(4));
            $machine->transition($trip, TripStatus::CANCELLED, $actor, [
                'notes' => 'Passenger cancelled before dispatch.',
                'cancellation_charge_applicable' => false,
            ]);

            return;
        }

        foreach ([TripStatus::ACCEPTED, TripStatus::DRIVER_EN_ROUTE, TripStatus::DRIVER_ARRIVED] as $step) {
            Carbon::setTestNow(now()->addMinutes(8));
            $machine->transition($trip, $step, $actor);
        }

        if ($plan['stop'] === TripStatus::DRIVER_ARRIVED) {
            return;
        }

        Carbon::setTestNow(now()->addMinutes(3));
        $machine->transition($trip, TripStatus::PASSENGER_ONBOARD, $actor);

        Carbon::setTestNow(now()->addMinutes(2));
        $machine->transition($trip, TripStatus::TRIP_STARTED, $actor, ['odometer_start' => $odometerStart]);

        if ($plan['stop'] === TripStatus::TRIP_STARTED) {
            return;
        }

        Carbon::setTestNow(now()->addMinutes($plan['minutes']));
        $machine->transition($trip, TripStatus::TRIP_COMPLETED, $actor, ['odometer_end' => $odometerEnd]);

        if ($plan['stop'] === TripStatus::TRIP_COMPLETED) {
            return;
        }

        Carbon::setTestNow(now()->addMinutes(6));
        $machine->transition($trip, TripStatus::INVOICE_GENERATED, $actor);

        Carbon::setTestNow(now()->addMinutes(11));
        $machine->transition($trip, TripStatus::CLOSED, $actor, ['notes' => 'Settled on the monthly statement.']);
    }
}
