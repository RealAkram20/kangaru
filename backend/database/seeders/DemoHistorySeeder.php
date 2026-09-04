<?php

namespace Database\Seeders;

use App\Enums\Permission;
use App\Enums\RoleAudience;
use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Carbon\Carbon;
use Illuminate\Database\Seeder;
use Modules\Administration\Models\Role;
use Modules\Billing\Services\CreditNoteService;
use Modules\Billing\Services\InvoiceService;
use Modules\Bookings\Models\Booking;
use Modules\Bookings\Services\BookingService;
use Modules\Dispatch\Services\DispatchService;
use Modules\Drivers\Models\Driver;
use Modules\Fleet\Models\VehicleAllocation;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Trips\Services\TripStateMachine;
use Modules\Vehicles\Models\Vehicle;

/**
 * Three months of operating history, so the product can be demonstrated
 * rather than described.
 *
 * `DemoFleetSeeder` seeds five trips in one afternoon, which is the right
 * shape for proving the lifecycle works and the wrong shape for showing
 * anybody the reports: a monthly financial report over a single day has one
 * row, and a trip report has five. This adds the volume and the time spread
 * those screens need.
 *
 * Everything here goes through the same services the application uses —
 * bookings, the pessimistic-lock dispatcher, the trip state machine, the
 * invoice and credit-note services. Seed data the product could not have
 * produced itself demonstrates a system that does not exist, and the
 * timelines, durations and odometer readings a bank is shown have to be
 * real for the six acceptance criteria to mean anything.
 *
 * Not run by the test suite: `TestCase` seeds `RoleSeeder` only, so the
 * cost here is paid by `migrate:fresh --seed` and by nobody else.
 */
class DemoHistorySeeder extends Seeder
{
    /** Completed, invoiced and closed trips per tenant, over the prior months. */
    private const HISTORIC_TRIPS = 18;

    /**
     * Trips inside the current calendar month, on top of the history above.
     *
     * ReportsPage opens on the current month because that is the billing
     * period, so on the 2nd of a month a purely historical seed leaves the
     * first screen anybody opens almost bare. A working operator has done
     * several runs this month whatever the date, and these are them.
     */
    private const CURRENT_MONTH_TRIPS = 5;

    /**
     * Realistic Ugandan corporate runs, paired with a plausible distance in
     * kilometres. Distance drives the invoice through the odometer pair, so
     * these are what make the money on screen defensible.
     *
     * @var array<int, array{0: string, 1: string, 2: int}>
     */
    private const ROUTES = [
        ['Head Office, Kampala', 'Entebbe International Airport', 42],
        ['Head Office, Kampala', 'Jinja Branch', 81],
        ['Nakawa Branch', 'Mbarara Branch', 266],
        ['Head Office, Kampala', 'Gulu Branch', 333],
        ['Head Office, Kampala', 'Mukono Branch', 21],
        ['Kololo', 'Entebbe International Airport', 38],
        ['Head Office, Kampala', 'Masaka Branch', 132],
        ['Ntinda', 'Head Office, Kampala', 9],
        ['Head Office, Kampala', 'Mbale Branch', 236],
        ['Head Office, Kampala', 'Fort Portal Branch', 294],
    ];

    public function run(): void
    {
        $realNow = now();

        foreach (Tenant::all() as $tenant) {
            $this->seedTenantHistory($tenant, $realNow);
        }

        Carbon::setTestNow();
        app(TenantContext::class)->set(null);

        $this->seedAllocations();
        $this->seedCustomRole();

        Carbon::setTestNow();
        app(TenantContext::class)->set(null);
    }

    private function seedTenantHistory(Tenant $tenant, Carbon $realNow): void
    {
        // Console commands never pass through IdentifyTenant, and TenantScope
        // fails closed — without this every read below returns nothing and
        // the seeder silently produces an empty demo.
        app(TenantContext::class)->set($tenant->id);

        // Shanitah's staff, shared across every client (ADR-0006); the
        // requester and the administrator are the client's own.
        $dispatcher = PlatformStaff::dispatcher();
        $finance = PlatformStaff::finance();

        $requester = $this->userFor($tenant, UserRole::CORPORATE_EMPLOYEE);
        $admin = $this->userFor($tenant, UserRole::CORPORATE_ADMIN);

        if ($requester === null) {
            return;
        }

        // Deliberately past the first six, which DemoFleetSeeder's live demo
        // trips hold: two of those stop mid-lifecycle and a live trip
        // occupies its vehicle indefinitely, so borrowing one here fails
        // with VEHICLE_UNAVAILABLE — the assignment guard doing its job.
        //
        // Within this slice the trips are safe to chain, because each is
        // driven all the way to Closed before the next is assigned and a
        // closed trip occupies nothing.
        $reserved = 6;
        $offset = $reserved + (Tenant::query()->where('id', '<', $tenant->id)->count() * 4);

        $vehicles = Vehicle::query()->orderBy('id')->get()->slice($offset, 4)->values();
        $drivers = Driver::query()->orderBy('id')->get()->slice($offset, 4)->values();

        if ($vehicles->isEmpty() || $drivers->isEmpty()) {
            return;
        }

        $machine = app(TripStateMachine::class);
        $dispatch = app(DispatchService::class);

        // Each vehicle keeps a running odometer so consecutive trips read as
        // one vehicle's life rather than unrelated numbers. A reading that
        // went backwards between two trips is the first thing a fleet
        // manager would spot.
        $odometers = $vehicles->mapWithKeys(fn (Vehicle $v, int $i) => [$v->id => 30_000 + ($i * 11_500)])->all();

        $total = self::HISTORIC_TRIPS + self::CURRENT_MONTH_TRIPS;
        $monthStart = $realNow->copy()->startOfMonth();
        // Whole days elapsed this month; at least one so the arithmetic below
        // is safe on the 1st.
        $elapsed = max(1, $monthStart->diffInDays($realNow));

        for ($index = 0; $index < $total; $index++) {
            [$origin, $destination, $km] = self::ROUTES[$index % count(self::ROUTES)];

            $vehicle = $vehicles[$index % $vehicles->count()];
            $driver = $drivers[$index % $drivers->count()];

            if ($index < self::HISTORIC_TRIPS) {
                // The prior months, several days apart, at office hours
                // rather than at whatever time the seeder happens to run.
                // 88 days ago through to 8, so the span covers every whole
                // month between then and now. Dividing by count-1 rather
                // than count matters: the off-by-one leaves the last trip
                // short of the end and drops a whole month off the
                // financial report, which is how July went missing.
                $day = $realNow->copy()
                    ->subDays(88 - (int) floor($index * (80 / (self::HISTORIC_TRIPS - 1))))
                    ->setTime(7 + ($index % 9), ($index * 7) % 60);
            } else {
                // Inside the current month, so the report screens open on
                // something. Spread across the days elapsed so far.
                $nth = $index - self::HISTORIC_TRIPS;
                $day = $monthStart->copy()
                    ->addDays((int) floor($nth * ($elapsed / self::CURRENT_MONTH_TRIPS)))
                    ->setTime(7 + ($nth % 9), ($nth * 11) % 60);

                // Never ahead of the clock: a trip completing in the future
                // is the sort of thing that gets noticed on a projector.
                if ($day->greaterThan($realNow->copy()->subHours(3))) {
                    $day = $realNow->copy()->subHours(3 + $nth);
                }
            }

            Carbon::setTestNow($day);

            $booking = Booking::factory()->forTenant($tenant)->create([
                'requested_by_user_id' => $requester->id,
                'origin' => $origin,
                'destination' => $destination,
                'passenger_count' => 1 + ($index % 4),
            ]);

            $trip = $dispatch->assign($booking, $vehicle->id, $driver->id, $dispatcher);

            $start = $odometers[$vehicle->id];
            $end = $start + $km;
            $odometers[$vehicle->id] = $end + 3 + ($index % 7);

            $this->driveToClosed($machine, $trip, $dispatcher, $finance, $start, $end, $km, $index);
        }

        $this->seedInbox($tenant, $requester, $admin, $realNow);

        Carbon::setTestNow();
    }

    /**
     * The full happy path, ending Closed with a priced invoice behind it.
     *
     * Every third trip also carries a credit note, so the correction path is
     * visible across the period rather than on one row.
     */
    private function driveToClosed(
        TripStateMachine $machine,
        Trip $trip,
        User $dispatcher,
        User $finance,
        int $odometerStart,
        int $odometerEnd,
        int $km,
        int $index,
    ): void {
        foreach ([TripStatus::ACCEPTED, TripStatus::DRIVER_EN_ROUTE, TripStatus::DRIVER_ARRIVED] as $step) {
            Carbon::setTestNow(now()->addMinutes(6));
            $machine->transition($trip, $step, $dispatcher);
        }

        Carbon::setTestNow(now()->addMinutes(3));
        $machine->transition($trip, TripStatus::PASSENGER_ONBOARD, $dispatcher);

        Carbon::setTestNow(now()->addMinutes(2));
        $machine->transition($trip, TripStatus::TRIP_STARTED, $dispatcher, ['odometer_start' => $odometerStart]);

        // Roughly 45 km/h through Kampala traffic, plus a few minutes of
        // variation so no two durations are identical.
        Carbon::setTestNow(now()->addMinutes((int) round($km * 1.35) + 8 + ($index % 13)));
        $machine->transition($trip, TripStatus::TRIP_COMPLETED, $dispatcher, ['odometer_end' => $odometerEnd]);

        Carbon::setTestNow(now()->addMinutes(9));
        $invoice = app(InvoiceService::class)->generateForTrip(
            $trip,
            'seed-history-invoice-'.$trip->id,
            $finance,
        );

        if ($index % 3 === 2) {
            Carbon::setTestNow(now()->addMinutes(5));
            app(CreditNoteService::class)->issue(
                $invoice,
                [['description' => 'Waiting time billed in error', 'amount_minor' => 12_000]],
                'Client disputed the waiting charge; verified against the timeline and credited.',
                'seed-history-credit-'.$trip->id,
                $finance,
            );
        }

        Carbon::setTestNow(now()->addMinutes(14));
        $machine->transition($trip->refresh(), TripStatus::CLOSED, $dispatcher, [
            'notes' => 'Settled on the monthly statement.',
        ]);
    }

    /**
     * Bookings in every state the queue can show, and the approvals and
     * rejections that put something in the notification inbox.
     *
     * Without these the Notifications page is empty on a fresh database,
     * which reads as a broken feature rather than an empty one.
     */
    private function seedInbox(Tenant $tenant, User $requester, ?User $admin, Carbon $realNow): void
    {
        if ($admin === null) {
            return;
        }

        $bookings = app(BookingService::class);

        // A decision notifies the *requester*, never the approver — so
        // seeding only the requester's bookings leaves an administrator's
        // inbox empty, which on a demo reads as a broken feature rather than
        // as correct behaviour. Both people raise transport here, because
        // both do in a bank.
        $decisions = [
            [$requester, 'Head Office, Kampala', 'Entebbe International Airport', 2, true],
            [$requester, 'Head Office, Kampala', 'Arua Branch', 1, false],
            [$admin, 'Head Office, Kampala', 'Jinja Branch', 1, true],
            [$requester, 'Kololo', 'Mukono Branch', 3, true],
            [$admin, 'Head Office, Kampala', 'Mbarara Branch', 2, false],
        ];

        foreach ($decisions as $i => [$who, $origin, $destination, $passengers, $approve]) {
            Carbon::setTestNow($realNow->copy()->subHours(9 - $i));

            $booking = Booking::factory()->forTenant($tenant)->create([
                'requested_by_user_id' => $who->id,
                'origin' => $origin,
                'destination' => $destination,
                'passenger_count' => $passengers,
            ]);

            if ($approve) {
                $bookings->approve($booking, $admin);
            } else {
                $bookings->reject($booking, $admin, 'No vehicle free for an upcountry run at this notice.');
            }
        }

        // Left pending, so the dispatch board has something to work on.
        foreach ([['Kololo', 'Entebbe International Airport', 2], ['Ntinda', 'Jinja Branch', 4]] as $i => $row) {
            Carbon::setTestNow($realNow->copy()->subMinutes(35 - ($i * 12)));
            Booking::factory()->forTenant($tenant)->create([
                'requested_by_user_id' => $requester->id,
                'origin' => $row[0],
                'destination' => $row[1],
                'passenger_count' => $row[2],
            ]);
        }
    }

    /**
     * "Vehicles supplied to the Bank" — Centenary Bank's letter, and the
     * thing ADR-0005 says is a contract rather than ownership.
     *
     * Nothing consults `vehicle_allocations` yet, so this is currently a
     * record and not a constraint. It is seeded anyway because the table was
     * unwritable until the morph map was fixed, and a demo of the contract
     * story needs rows in it.
     */
    private function seedAllocations(): void
    {
        $anchor = Tenant::query()->where('slug', 'centenary-bank')->first();

        if ($anchor === null) {
            return;
        }

        app(TenantContext::class)->set($anchor->id);

        $admin = $this->userFor($anchor, UserRole::CORPORATE_ADMIN)
            ?? User::query()->whereNull('tenant_id')->first();

        if ($admin === null) {
            return;
        }

        foreach (Vehicle::query()->orderBy('id')->take(3)->get() as $index => $vehicle) {
            VehicleAllocation::firstOrCreate(
                ['tenant_id' => $anchor->id, 'vehicle_id' => $vehicle->id],
                [
                    'created_by_user_id' => $admin->id,
                    'starts_on' => now()->subMonths(3)->startOfMonth()->toDateString(),
                    // One open-ended, two with an end date, so the demo shows
                    // both shapes of contract.
                    'ends_on' => $index === 0 ? null : now()->addMonths(9)->endOfMonth()->toDateString(),
                    // Explicit since ADR-0009 rather than left to the column
                    // default. These three were non-exclusive by implication
                    // when nothing consulted them; now that dispatch does,
                    // saying so is the difference between a deliberate
                    // arrangement and an unexamined one — and this is the
                    // Bank's case, which the ADR settles as non-exclusive.
                    'exclusive' => false,
                ],
            );
        }

        // One exclusive contract, so a demo can show both branches: the
        // ranked-but-overridable case above, and a vehicle that dispatch
        // simply refuses to put on anybody else's trip. Taken from further
        // down the fleet so it does not collide with the three above — an
        // exclusive allocation may not overlap another for the same vehicle,
        // and the seeder would be refused if it tried.
        $dedicated = Vehicle::query()->orderBy('id')->skip(3)->first();

        if ($dedicated !== null) {
            VehicleAllocation::firstOrCreate(
                ['tenant_id' => $anchor->id, 'vehicle_id' => $dedicated->id],
                [
                    'created_by_user_id' => $admin->id,
                    'starts_on' => now()->subMonths(3)->startOfMonth()->toDateString(),
                    'ends_on' => null,
                    'exclusive' => true,
                    'notes' => 'Dedicated executive vehicle — not to be dispatched for other clients.',
                ],
            );
        }

        app(TenantContext::class)->set(null);
    }

    /**
     * One custom role, so the role editor opens on something other than the
     * ten built-ins — the feature ADR-0004 exists to deliver is a role
     * nobody had to ship a release for.
     */
    private function seedCustomRole(): void
    {
        Role::firstOrCreate(
            ['slug' => 'regional_auditor'],
            [
                'name' => 'Regional Auditor',
                'description' => 'Reads trips, reports and the audit trail. Changes nothing.',
                'is_system' => false,
                // Everything it reads — trips, vehicles, drivers, the fleet's
                // own audit trail — is a fleet's, so this is a fleet role.
                // Named rather than defaulted: a role with no audience appears
                // in nobody's picker while looking perfectly healthy.
                'audience' => RoleAudience::FLEET,
                'permissions' => [
                    Permission::AUDIT_VIEW->value,
                    Permission::REPORTS_VIEW->value,
                    Permission::TRIPS_VIEW_ALL->value,
                    Permission::BOOKINGS_VIEW_ALL->value,
                    Permission::VEHICLES_VIEW->value,
                    Permission::DRIVERS_VIEW->value,
                ],
            ],
        );
    }

    private function userFor(Tenant $tenant, UserRole $role): ?User
    {
        return User::query()
            ->where('tenant_id', $tenant->id)
            ->where('role', $role->value)
            ->first();
    }
}
