<?php

namespace Database\Seeders;

use App\Enums\UserRole;
use App\Models\Customer;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Database\Seeder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Hash;
use Modules\Bookings\Models\Booking;
use Modules\Dispatch\Services\DispatchService;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Services\DriverAccountService;
use Modules\Drivers\Services\DriverLedgerService;
use Modules\Fleet\Support\DriverPresence;
use Modules\Fleet\Support\DriverPresenceStore;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Trips\Models\TripRating;
use Modules\Trips\Services\TripStateMachine;
use Modules\Vehicles\Models\Vehicle;
use RuntimeException;

/**
 * One driver who can actually sign in to the Driver's Application, with work
 * in front of them.
 *
 * ## Why this exists
 *
 * `DemoFleetSeeder` creates driver *profiles* through `Driver::factory()`.
 * ADR-0016 made a profile and a sign-in account two different things, and
 * nothing seeds the second — so `php artisan migrate:fresh --seed` produces a
 * database with fourteen drivers and **no driver who can log in**. Testing the
 * mobile app then begins with ten minutes of console clicking, before every
 * run, which is how a mobile client stops being tested.
 *
 * Not folded into `DemoFleetSeeder`: that seeder's job is a fleet and a spread
 * of trips for the *console*, and it is called from `DatabaseSeeder` on every
 * environment that seeds at all. This one mints a credential from a password
 * committed to the repository, which is a thing that should be asked for by
 * name and refused everywhere it does not belong.
 *
 * ## Run it
 *
 * ```
 * php artisan db:seed --class=DriverAppSeeder
 * ```
 *
 * Re-runnable. It reuses the account it made last time and will not stack a
 * second live trip on a driver who already has one — the assignment guard
 * would refuse that anyway (`DriverUnavailableException`), and a seeder that
 * fails on its second run is a seeder people stop trusting.
 */
class DriverAppSeeder extends Seeder
{
    /**
     * The demo driver's sign-in.
     *
     * ## Why it is this short
     *
     * It is typed by hand, on a phone keyboard, every time somebody tests the
     * driver app — which is the whole reason this seeder exists. The previous
     * value, `driver-demo-password`, was twenty characters of thumb-typing
     * before every run.
     *
     * ## Why it is safe to commit
     *
     * **`refuseOutsideDevelopment()` is what makes this safe, not the
     * password's strength.** Nothing else does, and nothing else should be
     * relied on: a credential committed to a repository is a known credential
     * whatever it says, so the only real control is refusing to mint it where
     * it would matter.
     *
     * ## Why gitleaks does not fire on it
     *
     * The scanner's `generic-api-key` rule needs entropy of 3.5 bits per
     * character; "password" measures 2.75, and it is also on gitleaks' own
     * default stopword list. Both point the same way, and it is a *weaker*
     * trigger than the value it replaces — that one leant on the same
     * "password" stopword plus "demo", exactly as `DatabaseSeeder`'s TOTP
     * secret leans on "DEMO".
     *
     * This was reasoned rather than run: gitleaks is not installed here and
     * could not be fetched. CI is the check that actually counts.
     */
    private const ACCOUNT_EMAIL = 'driver@kangaruride.test';

    private const ACCOUNT_PASSWORD = 'password';

    /**
     * A second driver, free and on duty, so automatic dispatch has somebody
     * to offer a ride to (ADR-0024).
     *
     * Not the same account, and that took a run against a live server to
     * discover. The driver above is deliberately left holding a live trip so
     * the app has a lifecycle to walk through — and a live trip *occupies*
     * them (`TripStatus::occupiesVehicle`), so `AvailabilityService` excludes
     * them from dispatch, correctly. Seeding one driver produced a database
     * where a walk-in order created no offer at all, and the seeder cheerfully
     * printed that it would.
     *
     * The two accounts answer the two halves of the app: sign in as this one
     * to be offered work, as the one above to see work in progress.
     */
    private const DISPATCH_EMAIL = 'driver.free@kangaruride.test';

    public function run(): void
    {
        $this->refuseOutsideDevelopment();

        $tenant = Tenant::query()->orderBy('id')->first();

        if ($tenant === null) {
            throw new RuntimeException(
                'No tenant exists. Run `php artisan migrate:fresh --seed` first — this seeder adds a '
                .'driver sign-in to an already-seeded platform, it does not build one.'
            );
        }

        $driver = $this->driverWithAccount();

        // Same reason DemoFleetSeeder does it: TripStateMachine refreshes
        // through TenantScope, which fails closed when nothing is bound, and a
        // console command never passes through IdentifyTenant.
        app(TenantContext::class)->set($tenant->id);

        try {
            $this->seedWork($tenant, $driver);
        } finally {
            Carbon::setTestNow();
            app(TenantContext::class)->set(null);
        }

        $this->seedEarningsAndRatings($driver);

        $onDuty = $this->freeDriverOnDuty();

        $this->report($driver, $onDuty);
    }

    /**
     * Walk-in rides this driver already finished, so the home screen has
     * something to show.
     *
     * ## Why this is real data and not a fixture
     *
     * The home screen renders earnings, wallet balance and rating from
     * `GET /me/stats`. On a freshly seeded database all three are empty —
     * not because the app is wrong, but because nothing seeded
     * `driver_ledger_entries` (ADR-0029) or `trip_ratings` (ADR-0030).
     *
     * The tempting shortcut is a fixture in the app behind a flag.
     * `docs/screen-rules.md` §1 forbids it, and the practical reason is
     * better than the principle: a flag that shows invented money is a flag
     * that ships. Seeding the database instead means the screen is driven by
     * the real payload down the real endpoint — which is also the only thing
     * that would have caught the bug where the app read a field the server
     * had renamed and printed `undefined NaN` where the money goes.
     *
     * ## Why walk-ins specifically
     *
     * Neither figure can come from the corporate trips seeded above, and that
     * is the platform working correctly rather than a gap:
     *
     * - **The ledger only records fares the platform priced** (ADR-0029 §4).
     *   A corporate trip is invoiced to the client and carries no
     *   `fare_minor`; inventing one would double-bill them.
     * - **Only a customer may rate** (ADR-0030 §1), and a corporate trip has
     *   no customer — the passenger is the client's business.
     *
     * ## What the numbers come out as
     *
     * Entries are written by `DriverLedgerService::recordCompletedTrip()`,
     * never by hand, so the commission split is whatever that service says it
     * is and a change to the rule changes this demo data with it.
     *
     * Note the balance lands **negative**, and that is correct rather than a
     * seeding mistake: the passenger handed over the whole fare in cash, so
     * the driver holds the platform's money until they settle (ADR-0029 §5).
     * One settlement is recorded so the wallet shows a remittance having
     * happened rather than a single unbroken debt.
     *
     * Six rated rides, because ADR-0030 §3 withholds the score below five —
     * five would sit exactly on the boundary and make a passing screen look
     * like a coincidence.
     */
    private function seedEarningsAndRatings(Driver $driver): void
    {
        // Re-runnable, like everything else here — and the *trips* are what
        // that question has to be asked about, not the ledger entries.
        //
        // Guarding on `driver_ledger_entries` was the first attempt and it
        // was wrong in a way only a second run exposes: clear the ledger to
        // re-test and the guard opens, but the trips and the vehicle from the
        // previous run are still there, so it piles up six more rides and
        // then dies on the vehicle's unique registration. The trips are
        // written first, so they are the honest record of "this already ran".
        $alreadySeeded = Trip::query()
            ->withoutGlobalScopes()
            ->where('driver_id', $driver->getKey())
            ->whereNull('tenant_id')
            ->whereNotNull('fare_minor')
            ->exists();

        if ($alreadySeeded) {
            return;
        }

        $customer = Customer::factory()->create([
            'first_name' => 'Sarah',
            'last_name' => 'Nakato',
        ]);

        // Look first, then fall back to the factory — not `firstOrCreate`.
        //
        // `registration_number` is unique, so a plain `create` turns any
        // partially-cleaned database into a seeder that cannot run at all.
        // But `firstOrCreate`'s second argument is a bare attribute list, and
        // `vehicles.make` is NOT NULL with no default: it inserts a row the
        // schema rejects. That passed here and failed in CI, because locally
        // the vehicle already existed and only the *found* branch ever ran —
        // the created branch was written, shipped and never executed once.
        //
        // Going through the factory keeps the columns a vehicle needs in the
        // one place that knows them, which is the same reason every other
        // vehicle in this file comes from it.
        $vehicle = Vehicle::query()->firstWhere('registration_number', 'UDD 004D')
            ?? Vehicle::factory()->create([
                'category' => 'sedan',
                'registration_number' => 'UDD 004D',
            ]);

        $ledger = app(DriverLedgerService::class);
        $realNow = now();

        // Two today so "Earnings today" is not zero, and four spread over the
        // preceding days so the rating has enough behind it. `rating` is the
        // mean of the recent 50 (§4), so the older ones count towards the
        // score without touching today's earnings.
        $rides = [
            ['hoursAgo' => 2, 'fare' => 12_500, 'stars' => 5, 'from' => 'Acacia Mall', 'to' => 'Kololo Airstrip'],
            ['hoursAgo' => 4, 'fare' => 8_000, 'stars' => 5, 'from' => 'Garden City', 'to' => 'Ntinda'],
            ['hoursAgo' => 27, 'fare' => 21_000, 'stars' => 4, 'from' => 'Entebbe Road', 'to' => 'Munyonyo'],
            ['hoursAgo' => 30, 'fare' => 6_500, 'stars' => 5, 'from' => 'Wandegeya', 'to' => 'Makerere'],
            ['hoursAgo' => 51, 'fare' => 15_000, 'stars' => 4, 'from' => 'Kabalagala', 'to' => 'Nakawa'],
            ['hoursAgo' => 74, 'fare' => 9_500, 'stars' => 5, 'from' => 'Bugolobi', 'to' => 'Kampala Road'],
        ];

        foreach ($rides as $ride) {
            $at = $realNow->copy()->subHours($ride['hoursAgo']);

            $trip = Trip::factory()
                ->forCustomer($customer)
                ->forDriver($driver)
                ->forVehicle($vehicle)
                ->create([
                    'origin' => $ride['from'],
                    'destination' => $ride['to'],
                    'status' => TripStatus::TRIP_COMPLETED,
                    'started_at' => $at->copy()->subMinutes(25),
                    'completed_at' => $at,
                    // What `WalkInFareService::settle()` would have written at
                    // completion. Whole shillings — UGX is zero-decimal, and
                    // this is exactly the figure the app must not divide.
                    'fare_minor' => $ride['fare'],
                    'fare_currency' => 'UGX',
                    'fare_computed_at' => $at,
                ]);

            // Stamped at the trip's own moment, so "earnings today" counts the
            // two that happened today rather than all six.
            Carbon::setTestNow($at);
            $ledger->recordCompletedTrip($trip);
            Carbon::setTestNow();

            TripRating::query()->create([
                'trip_id' => $trip->getKey(),
                'customer_id' => $customer->getKey(),
                'driver_id' => $driver->getKey(),
                'stars' => $ride['stars'],
            ]);
        }

        // Yesterday's cash handed in. Positive because it reduces what the
        // driver owes (ADR-0029 §5).
        //
        // **10,000, and the size is the point.** Each ride nets the driver
        // `earned - fare`, which is exactly minus the commission — they took
        // the whole fare in cash and owe the platform its cut. Across these
        // six that is 14,500, so a part-remittance leaves the balance a few
        // thousand short and the wallet reads "you are holding the office's
        // cash". That is the state ADR-0029 §5 calls the ordinary one for a
        // driver taking cash all day.
        //
        // The first draft remitted 40,000 and pushed the balance to +25,500 —
        // the office owing the driver, which cash rides alone cannot produce.
        // It rendered fine and was quietly impossible, which is the sort of
        // demo figure that teaches somebody the wrong thing about the screen.
        $ledger->recordSettlement(
            $driver,
            10_000,
            $this->dispatcher(),
            'Cash remitted at the depot',
        );
    }

    /**
     * Refuses to mint a published credential anywhere it would be a backdoor.
     *
     * Throws rather than skipping, following `DatabaseSeeder::enrolDemoMfa()`
     * and for the same reason: a seeder that quietly does nothing in
     * production leaves somebody believing an account exists, whereas a failed
     * seed is a fact they can act on. The difference matters more here than
     * there — this account holds `TRIPS_TRANSITION_OWN`, so a live one would
     * let anybody holding this file move real trips and write real odometer
     * readings into a bank's invoices.
     */
    private function refuseOutsideDevelopment(): void
    {
        if (! app()->environment(['local', 'testing', 'staging'])) {
            throw new RuntimeException(
                'Refusing to seed a known driver password in the '.app()->environment().' environment. '
                .'Issue real driver accounts through POST /api/v1/drivers/{driver}/account instead.'
            );
        }
    }

    /**
     * The demo driver, with a sign-in attached.
     *
     * Goes through `DriverAccountService` rather than writing `drivers.user_id`
     * directly — the same discipline the trips below follow by going through
     * the state machine. A seeder that bypasses the service would happily
     * produce a link the product itself refuses to make, and the first thing
     * anybody would learn from it is wrong.
     */
    private function driverWithAccount(): Driver
    {
        return $this->accountFor(self::ACCOUNT_EMAIL, 'Demo Driver');
    }

    /**
     * A driver with a sign-in, by email, made once and reused after that.
     *
     * Generalised from the single demo account when ADR-0024 needed a second
     * one — see `DISPATCH_EMAIL`. Both go through `DriverAccountService`
     * rather than writing `drivers.user_id` directly, the same discipline the
     * trips below follow by going through the state machine: a seeder that
     * bypasses the service would happily produce a link the product itself
     * refuses to make, and the first thing anybody learns from it is wrong.
     */
    private function accountFor(string $email, string $name): Driver
    {
        $existing = Driver::query()->whereHas(
            'user',
            fn ($query) => $query->where('email', $email),
        )->first();

        if ($existing !== null) {
            $this->restorePassword($existing);

            return $existing;
        }

        $driver = Driver::factory()->create([
            'name' => $name,
            // Distinct per account, because `drivers.phone` is what
            // ADR-0024 §7 hands a passenger to ring. Two demo drivers
            // sharing a number would make the call button untestable.
            'phone' => '+2567000000'.substr(md5($email), 0, 2),
        ]);

        app(DriverAccountService::class)->open($driver, [
            'email' => $email,
            'password' => self::ACCOUNT_PASSWORD,
            'role' => UserRole::DRIVER->value,
            'name' => $driver->name,
        ]);

        return $driver->refresh();
    }

    /**
     * Two finished trips for depth, then one waiting to be accepted.
     *
     * Order matters. A completed trip releases its driver
     * (`TripStatus::occupiesVehicle()` is false past Trip Completed) but an
     * assigned one does not, so the live trip has to come last — build it
     * first and the guard refuses the two behind it with
     * `DriverUnavailableException`.
     */
    private function seedWork(Tenant $tenant, Driver $driver): void
    {
        if ($this->hasLiveTrip($driver)) {
            return;
        }

        $requester = $this->requesterFor($tenant);
        $dispatcher = $this->dispatcher();
        $realNow = now();

        // Its own vehicles, never a slice of the demo pool. Two of
        // DemoFleetSeeder's trips deliberately stop mid-lifecycle and hold
        // their vehicle indefinitely, so borrowing from that pool would make
        // this seeder fail depending on which other seeders had run.
        $vehicles = collect(['sedan', 'suv', 'van'])->map(
            fn (string $category, int $index) => Vehicle::factory()->create([
                'category' => $category,
                'registration_number' => sprintf('UDD %03dD', $index + 1),
            ]),
        );

        $finished = [
            ['Kampala', 'Entebbe Airport', [104_200, 104_243]],
            ['Nakawa Branch', 'Mukono', [104_243, 104_271]],
        ];

        foreach ($finished as $index => [$origin, $destination, $odometer]) {
            // The whole trip is written under a wound-back clock, including
            // its opening event — `trip_events` is ordered by `created_at`,
            // and stamping the Assigned event at real "now" would put it
            // after the transitions that follow it.
            Carbon::setTestNow($realNow->copy()->subHours(6 - $index));

            $trip = $this->dispatch($tenant, $requester, $dispatcher, $driver, $vehicles[$index], $origin, $destination);

            $this->drive($trip, $dispatcher, $odometer);
        }

        // The trip the app opens on. Left at Assigned so a first test walks
        // the whole lifecycle — accept, drive, arrive, board, capture the
        // opening odometer — which is the flow the app exists for.
        Carbon::setTestNow($realNow->copy()->subMinutes(15));

        $this->dispatch(
            $tenant,
            $requester,
            $dispatcher,
            $driver,
            $vehicles[2],
            'Kampala Road',
            'Jinja',
        );
    }

    /**
     * Whether the driver is already holding work this seeder would collide
     * with. Reuses `TripStatus::occupyingValues()` rather than listing
     * statuses again — the assignment guard asks exactly this question, and
     * two copies of it would disagree the day a status changes sides.
     */
    private function hasLiveTrip(Driver $driver): bool
    {
        return Trip::allTenants()
            ->where('driver_id', $driver->id)
            ->whereIn('status', TripStatus::occupyingValues())
            ->exists();
    }

    /**
     * Puts the documented password back on an existing demo account.
     *
     * Not redundant with minting it. The first thing anybody testing the app
     * does to this account is exercise `PATCH /auth/password`, which is one of
     * the driver surface's nineteen routes — and that leaves the credential
     * printed by this seeder, and written in `mobile/README.md`, simply wrong.
     * There is no self-service reset (ADR-0016), so without this the recovery
     * path for a *demo* account is a database console.
     *
     * Tokens are deliberately left alone. The real change revokes them, and a
     * seeder is not that flow — reproducing half of it here would teach the
     * behaviour wrong. A stale token on a development database costs nothing.
     */
    private function restorePassword(Driver $driver): void
    {
        $account = $driver->user;

        if ($account === null) {
            return;
        }

        $account->forceFill(['password' => Hash::make(self::ACCOUNT_PASSWORD)])->save();
    }

    /**
     * The dispatch desk that records the assignment — reused if one exists,
     * created if not.
     *
     * Deliberately **not** `PlatformStaff::dispatcher()`, which throws. That
     * loudness is right for the demo seeders: a missing dispatcher there means
     * every tenant's demo silently seeds as nothing, and a developer reads
     * "success" over an empty database. Here the dispatcher is a signature on
     * one assignment, not the subject of the seed, and refusing to run because
     * a *different* seeder has not run is precisely the friction this class
     * exists to remove — a half-seeded development database is the normal
     * state of one.
     *
     * Creating a platform account carries the same risk as the driver
     * password above and is covered by the same environment guard.
     */
    private function dispatcher(): User
    {
        $existing = User::query()
            ->whereNull('tenant_id')
            ->where('role', UserRole::DISPATCHER->value)
            ->first();

        if ($existing !== null) {
            return $existing;
        }

        return User::factory()->create([
            'tenant_id' => null,
            'name' => 'Dispatch Desk',
            'email' => 'dispatch@kangaruride.test',
            'role' => UserRole::DISPATCHER,
        ]);
    }

    private function requesterFor(Tenant $tenant): User
    {
        return User::query()->firstOrCreate(
            ['email' => 'staff@'.$tenant->slug.'.test'],
            [
                'tenant_id' => $tenant->id,
                'name' => 'Staff Requester',
                'role' => UserRole::CORPORATE_EMPLOYEE,
                'password' => bcrypt(self::ACCOUNT_PASSWORD),
            ],
        );
    }

    /**
     * Booking → dispatch, the real path. Writing a Trip row directly would
     * skip the pessimistic lock and leave the trip with no booking behind it,
     * which is a shape the product cannot produce.
     */
    private function dispatch(
        Tenant $tenant,
        User $requester,
        User $dispatcher,
        Driver $driver,
        Vehicle $vehicle,
        string $origin,
        string $destination,
    ): Trip {
        $booking = Booking::factory()->forTenant($tenant)->create([
            'requested_by_user_id' => $requester->id,
            'origin' => $origin,
            'destination' => $destination,
        ]);

        return app(DispatchService::class)->assign($booking, $vehicle->id, $driver->id, $dispatcher);
    }

    /**
     * Walks a trip from Assigned to Trip Completed through the state machine,
     * capturing the odometer pair on the two transitions that take one.
     *
     * No photo. The reading is the acceptance criterion and the photo is not
     * (`TransitionTripRequest`), and a seeded placeholder image would make
     * every demo trip look like one where the camera worked — which is not the
     * case the app most needs to be tested against.
     *
     * @param  array{int, int}  $odometer
     */
    private function drive(Trip $trip, User $dispatcher, array $odometer): void
    {
        $machine = app(TripStateMachine::class);

        foreach ([
            TripStatus::ACCEPTED,
            TripStatus::DRIVER_EN_ROUTE,
            TripStatus::DRIVER_ARRIVED,
            TripStatus::PASSENGER_ONBOARD,
        ] as $status) {
            $trip = $machine->transition($trip, $status, $dispatcher);
        }

        $trip = $machine->transition($trip, TripStatus::TRIP_STARTED, $dispatcher, [
            'odometer_start' => $odometer[0],
        ]);

        Carbon::setTestNow(now()->addMinutes(75));

        $machine->transition($trip, TripStatus::TRIP_COMPLETED, $dispatcher, [
            'odometer_end' => $odometer[1],
        ]);
    }

    /**
     * Says what the tester now has, including where the live trip already is.
     *
     * The status line matters on a re-run: the seeder leaves an existing live
     * trip alone, so a developer who walked one to Driver Arrived yesterday
     * and re-seeds today needs to know the app will not open on Assigned.
     * Reporting "seeded" and nothing else would have them hunting for a button
     * that is two states behind them.
     */
    /**
     * Signs the demo driver on, in Kampala, so a walk-in order dispatches
     * (ADR-0024 §2).
     *
     * Without this the whole of ADR-0024 is unobservable from a fresh
     * database. Everything works — the matcher runs, the ranking is correct —
     * and it ranks an empty pool, because presence is an explicit act and a
     * seeder is the only thing here that never taps a toggle. Somebody
     * following `mobile/README.md` would place an order, see nothing happen,
     * and reasonably conclude the feature is broken.
     *
     * Written through `DriverPresenceStore`, not straight into the table, for
     * the same reason the account above goes through `DriverAccountService`:
     * a seeder that bypasses the service can produce a state the product
     * itself refuses to make.
     *
     * The position is the city centre, and the coordinates are the ones every
     * fixture in this codebase uses — 0.3476 N, 32.5825 E. Deliberately the
     * same, so a walk-in order raised from the public form's default map
     * centre lands metres away and the distance scoring is visibly doing
     * something.
     */
    private function freeDriverOnDuty(): Driver
    {
        $driver = $this->accountFor(self::DISPATCH_EMAIL, 'Demo Driver (free)');

        $this->releaseLiveTrips($driver);

        $presence = app(DriverPresenceStore::class);

        // A vehicle nobody else is on, or the guard refuses the accept even
        // though the offer went out. `occupyingValues()` is the same
        // predicate `TripAssignmentGuard` uses, so this asks exactly the
        // question the accept path will ask.
        $vehicle = Vehicle::query()
            ->where('status', 'active')
            ->whereNotIn('id', Trip::allTenants()
                ->whereIn('status', TripStatus::occupyingValues())
                ->pluck('vehicle_id'))
            ->orderBy('id')
            ->first();

        $presence->setDuty($driver->id, true, $vehicle?->id);

        // `now()`, not a fixed instant: presence goes stale after
        // `dispatch.presence_ttl_seconds`, so a hardcoded timestamp would
        // seed a driver who is already invisible — the exact failure this
        // method exists to prevent, reintroduced by the fixture.
        $presence->heartbeat(new DriverPresence(
            driverId: $driver->id,
            onDuty: true,
            vehicleId: $vehicle?->id,
            latitude: 0.3476,
            longitude: 32.5825,
            accuracyMetres: 10.0,
            recordedAt: CarbonImmutable::now(),
        ));

        return $driver;
    }

    /**
     * Cancels anything this driver is still holding, so the demo repeats.
     *
     * Accepting an offer occupies the driver, and an occupied driver is
     * excluded from dispatch by `AvailabilityService` — correctly. The
     * consequence is that the walk-in demo works exactly once: run it, accept
     * a ride, and every subsequent order is offered to nobody, with the
     * seeder still printing that it would be offered here.
     *
     * Found by doing it twice. The first run was proof the chain works; the
     * second was silence.
     *
     * Through `TripStateMachine`, so `trip_events` shows the cancellation
     * rather than a row mutating under the timeline. A trip already past
     * `trip_started` cannot be cancelled — the graph does not allow it — and
     * is left alone rather than forced: this is a convenience for a demo
     * database, not a licence to rewrite a lifecycle.
     */
    private function releaseLiveTrips(Driver $driver): void
    {
        $dispatcher = $this->dispatcher();

        $live = Trip::allTenants()
            ->where('driver_id', $driver->id)
            ->whereIn('status', TripStatus::occupyingValues())
            ->get();

        foreach ($live as $trip) {
            if (! $trip->status->canTransitionTo(TripStatus::CANCELLED)) {
                continue;
            }

            app(TenantContext::class)->set($trip->tenant_id);

            try {
                app(TripStateMachine::class)->transition(
                    $trip,
                    TripStatus::CANCELLED,
                    $dispatcher,
                    ['notes' => 'Released by DriverAppSeeder so the walk-in demo can be re-run.'],
                );
            } finally {
                app(TenantContext::class)->set(null);
            }
        }
    }

    private function report(Driver $driver, Driver $onDuty): void
    {
        // `isset`, not a null check: `Seeder::$command` is an untyped property
        // that is simply never assigned when a seeder is constructed directly
        // rather than through `db:seed` — which is how the tests run it. This
        // is the framework's own idiom for the same question (see
        // `Seeder::callWith`).
        if (! isset($this->command)) {
            return;
        }

        $command = $this->command;

        $live = Trip::allTenants()
            ->where('driver_id', $driver->id)
            ->whereIn('status', TripStatus::occupyingValues())
            ->first();

        $command->newLine();
        $command->info('Driver App sign-in ready.');
        $command->line('  Email:    '.self::ACCOUNT_EMAIL);
        $command->line('  Password: '.self::ACCOUNT_PASSWORD);
        $command->line('  Driver:   #'.$driver->id.' '.$driver->name);
        $command->line('  Live trip: '.(
            $live === null
                ? 'none — every trip is finished'
                : '#'.$live->id.' at '.$live->status->value
        ));
        $command->newLine();
        $command->newLine();
        $command->info('A second driver, free and on duty, for automatic dispatch.');
        $command->line('  Email:    '.self::DISPATCH_EMAIL);
        $command->line('  Password: '.self::ACCOUNT_PASSWORD);
        $command->line('  Driver:   #'.$onDuty->id.' '.$onDuty->name);
        $command->line('  On duty at 0.3476, 32.5825 (Kampala centre)');
        $command->newLine();
        $command->line('  Two accounts because the driver above holds a live trip, which');
        $command->line('  occupies them — availability excludes them from dispatch, and an');
        $command->line('  order would be offered to nobody. Sign in as this one to be');
        $command->line('  offered work, as the one above to see work in progress.');
        $command->newLine();
        $command->line('  Send client: "driver" at login (ADR-0022). See mobile/README.md.');
        $command->newLine();
        $command->line('  Order at POST /api/v1/public/order-requests with a pickup near that');
        $command->line('  point and it is offered within seconds. Duty lapses after');
        $command->line('  dispatch.presence_ttl_seconds — re-run this seeder to refresh it.');
        $command->newLine();
    }
}
