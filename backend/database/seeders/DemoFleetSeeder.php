<?php

namespace Database\Seeders;

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Illuminate\Database\Seeder;
use Illuminate\Support\Carbon;
use Modules\Billing\Services\CreditNoteService;
use Modules\Billing\Services\InvoiceService;
use Modules\Billing\Services\RateCardService;
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

        // Billing is Finance's job, not the dispatcher's (InvoicePolicy), so
        // the demo needs a user who is actually allowed to raise an invoice.
        $finance = User::factory()->create([
            'tenant_id' => $tenant->id,
            'name' => 'Finance Officer',
            'email' => 'finance@'.$tenant->slug.'.test',
            'role' => UserRole::FINANCE,
        ]);

        $this->seedRateCard($tenant, $finance);

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

            $this->drive($machine, $trip, $dispatcher, $finance, $plan);
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
     * The tenant's default rate card: one immutable version pricing each
     * vehicle category the fleet above actually uses, in whole shillings.
     *
     * Written through RateCardService rather than straight to the tables,
     * for the same reason the trips go through the state machine — seed
     * data the product could not itself have produced demos a system that
     * does not exist.
     */
    private function seedRateCard(Tenant $tenant, User $finance): void
    {
        app(RateCardService::class)->create([
            'name' => 'Corporate Standard',
            'description' => 'Default corporate rates: distance-based with a night surcharge after 22:00.',
            'is_default' => true,
            'version' => [
                // Well before any seeded trip, so every one of them resolves.
                'effective_from' => '2026-01-01',
                'rounding_mode' => 'half_up',
                'free_waiting_minutes' => 15,
                'night_starts_at' => '22:00',
                'night_ends_at' => '06:00',
                // 12500 bp = 1.25x.
                'night_multiplier_bp' => 12_500,
                'rates' => [
                    ['vehicle_category' => 'sedan', 'base_fare_minor' => 15_000, 'per_km_minor' => 2_500,
                        'per_waiting_minute_minor' => 500, 'minimum_charge_minor' => 30_000],
                    ['vehicle_category' => 'suv', 'base_fare_minor' => 25_000, 'per_km_minor' => 3_500,
                        'per_waiting_minute_minor' => 700, 'minimum_charge_minor' => 50_000],
                    ['vehicle_category' => 'van', 'base_fare_minor' => 30_000, 'per_km_minor' => 4_000,
                        'per_waiting_minute_minor' => 800, 'minimum_charge_minor' => 60_000],
                ],
            ],
        ], $finance);
    }

    /**
     * @param  array{stop: TripStatus, minutes: int, odometer: array{0: ?int, 1: ?int}}  $plan
     */
    private function drive(TripStateMachine $machine, Trip $trip, User $actor, User $finance, array $plan): void
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

        // The trip reaches Invoice Generated by being invoiced, not by
        // being told it was: InvoiceService applies that transition inside
        // the transaction that issues the invoice, so the demo data has a
        // real priced document behind the status rather than a bare label.
        $invoice = app(InvoiceService::class)->generateForTrip(
            $trip,
            // Deterministic, so re-running the seeder against an existing
            // database replays rather than raising a second invoice.
            'seed-invoice-trip-'.$trip->id,
            $finance,
        );

        // One credit note, so the correction path is visible in the demo
        // and not just in the tests. AGENTS.md: corrections are credit
        // notes, never edits to an issued invoice.
        Carbon::setTestNow(now()->addMinutes(4));
        app(CreditNoteService::class)->issue(
            $invoice,
            [['description' => 'Goodwill adjustment for a delayed pickup', 'amount_minor' => 10_000]],
            'Driver arrived 25 minutes late; agreed goodwill credit with the client.',
            'seed-credit-note-trip-'.$trip->id,
            $finance,
        );

        Carbon::setTestNow(now()->addMinutes(11));
        // InvoiceService moved the trip to Invoice Generated on its own
        // re-read of the row, so this instance is still holding the status
        // it had before. Closing without refreshing asks the state machine
        // to go Trip Completed -> Closed, which it correctly refuses.
        $machine->transition($trip->refresh(), TripStatus::CLOSED, $actor, [
            'notes' => 'Settled on the monthly statement.',
        ]);
    }
}
