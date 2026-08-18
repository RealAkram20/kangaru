<?php

namespace Database\Seeders;

use App\Enums\UserRole;
use App\Models\Customer;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use App\Support\Tenancy\TenantScope;
use Carbon\CarbonImmutable;
use Illuminate\Database\Seeder;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Modules\Administration\Services\SettingsService;
use Modules\Bookings\Models\Booking;
use Modules\Dispatch\Services\DispatchService;
use Modules\Drivers\Enums\DriverApplicationStatus;
use Modules\Drivers\Enums\DriverDocumentType;
use Modules\Drivers\Enums\LedgerEntryKind;
use Modules\Drivers\Enums\PayoutAccountKind;
use Modules\Drivers\Enums\SettlementRequestKind;
use Modules\Drivers\Enums\SettlementRequestStatus;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Models\DriverApplication;
use Modules\Drivers\Models\DriverClosureRequest;
use Modules\Drivers\Models\DriverDocument;
use Modules\Drivers\Models\DriverLedgerEntry;
use Modules\Drivers\Models\DriverPayoutAccount;
use Modules\Drivers\Models\DriverSettlementRequest;
use Modules\Drivers\Services\DriverAccountService;
use Modules\Drivers\Services\DriverClosureService;
use Modules\Drivers\Services\DriverDocumentService;
use Modules\Drivers\Services\DriverEarningsService;
use Modules\Drivers\Services\DriverLedgerService;
use Modules\Drivers\Services\DriverSettlementRequestService;
use Modules\Drivers\Services\ReferralService;
use Modules\Fleet\Enums\AvailabilityKind;
use Modules\Fleet\Enums\AvailabilityResource;
use Modules\Fleet\Enums\AvailabilityStatus;
use Modules\Fleet\Enums\ZoneKind;
use Modules\Fleet\Models\AvailabilityBlock;
use Modules\Fleet\Models\DriverShiftWindow;
use Modules\Fleet\Models\Zone;
use Modules\Fleet\Services\DutySessionService;
use Modules\Fleet\Support\DriverPresence;
use Modules\Fleet\Support\DriverPresenceStore;
use Modules\Notifications\Enums\NotificationType;
use Modules\Notifications\Models\Notification;
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

        $this->assignOwnVehicle($driver);

        $this->seedDocuments($driver);

        $this->seedRosterAndShifts($driver);

        // ADR-0036 and ADR-0037. Last, because it needs the driver to exist
        // and it mints their referral code.
        $this->promotions($driver, app(SettingsService::class), app(ReferralService::class));

        // The rest of the demo estate: the office's contact details, the
        // safety number, an inbox with something in it, and a settlement
        // request mid-flight — so every screen the drawer reaches shows its
        // populated state, not its empty one.
        $this->officeAndInbox($driver, app(SettingsService::class));

        $onDuty = $this->freeDriverOnDuty();

        // ADR-0042 and ADR-0043, the two youngest surfaces and the two this
        // seeder had no answer for: Bank Details and the profile's danger zone
        // both rendered their empty state on a fully seeded database.
        $this->payoutAccount($driver);
        $this->closureRequests($driver, $onDuty);

        // Three console sections that a fully seeded platform still left
        // empty — found by counting rows per table after `migrate:fresh
        // --seed`, not by opening screens, because an empty section looks the
        // same as a section nobody has scrolled to.
        $this->driverApplications();
        $this->timeOff($driver);
        $this->zones($tenant);

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
            // **Not a plain return.** The tip and the bonus carry their own
            // guards and were added to this seeder later, so a database seeded
            // before ADR-0034 has the six rides and neither of the two rows the
            // wallet mockup draws — and would never gain them, because this
            // guard is about the *trips*. They are idempotent on their own
            // terms; let them run.
            $this->tipAndBonus($driver, app(DriverLedgerService::class));

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

        /**
         * The start of the driver's *local* day, as an instant.
         *
         * "Earnings today" is measured in `settings.regional.timezone`, not in
         * UTC — so anchoring today's demo rides with `subHours` alone is not
         * enough. Run this seeder shortly after local midnight and a ride "2
         * hours ago" lands in yesterday's local day, the demo home screen
         * shows `UGX 0` under "Earnings today", and the test that guards this
         * fails depending on what time of day CI happens to run. The two
         * today rides are therefore placed *inside* the elapsed part of the
         * local day rather than counted backwards from now.
         */
        $localMidnight = $realNow->copy()
            ->setTimezone(app(DriverEarningsService::class)->timezone())
            ->startOfDay()
            ->utc();

        $elapsedToday = max(2, $localMidnight->diffInMinutes($realNow));

        // Two today so "Earnings today" is not zero, and four spread over the
        // preceding days so the rating has enough behind it. `rating` is the
        // mean of the recent 50 (§4), so the older ones count towards the
        // score without touching today's earnings.
        //
        // `dayFraction` places a ride that far through today so far — 0.3 is
        // mid-morning on a normal run and is still inside today at 00:03.
        // `hoursAgo` is only for the older rides, which have no such
        // constraint because no boundary sits between them and now.
        $rides = [
            ['dayFraction' => 0.3, 'fare' => 12_500, 'stars' => 5, 'from' => 'Acacia Mall', 'to' => 'Kololo Airstrip'],
            ['dayFraction' => 0.7, 'fare' => 8_000, 'stars' => 5, 'from' => 'Garden City', 'to' => 'Ntinda'],
            ['hoursAgo' => 27, 'fare' => 21_000, 'stars' => 4, 'from' => 'Entebbe Road', 'to' => 'Munyonyo'],
            ['hoursAgo' => 30, 'fare' => 6_500, 'stars' => 5, 'from' => 'Wandegeya', 'to' => 'Makerere'],
            ['hoursAgo' => 51, 'fare' => 15_000, 'stars' => 4, 'from' => 'Kabalagala', 'to' => 'Nakawa'],
            ['hoursAgo' => 74, 'fare' => 9_500, 'stars' => 5, 'from' => 'Bugolobi', 'to' => 'Kampala Road'],
        ];

        foreach ($rides as $ride) {
            $at = isset($ride['dayFraction'])
                ? $localMidnight->copy()->addMinutes((int) round($elapsedToday * $ride['dayFraction']))
                : $realNow->copy()->subHours($ride['hoursAgo']);

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

        $this->tipAndBonus($driver, $ledger);
    }

    /**
     * One tip and one weekly bonus (ADR-0034), so the wallet and the earnings
     * breakdown show the rows the mockups draw.
     *
     * **Written through the real services, not as rows.** The tip therefore
     * gets its commission split from `DriverLedgerService::recordTip()` and the
     * bonus its wording from `recordBonus()`, so a change to either rule
     * changes this demo data with it — the same reason the fares above go
     * through `recordCompletedTrip()`.
     *
     * The tip hangs off the most recent completed trip because a tip belongs
     * to a journey: `tip_earned` and `tip_cash_collected` carry its id, and a
     * `trip_id` of null would be a row the Trips History screen cannot place.
     *
     * **The bonus is written directly rather than through
     * `WeeklyBonusService`.** That service is correctly gated on
     * `billing.bonus_enabled`, and this writes one demo credit rather than
     * running the rule.
     *
     * **The switch itself is now flipped by `promotions()` below, and that
     * reverses the reasoning this docblock used to give.** It argued that
     * seeding `bonus_enabled` to true would leave a development database with
     * a live scheme nobody switched on — right at the time, when the flag only
     * decided whether a scheduled command paid out. ADR-0036 gave the flag a
     * second job: it now also decides whether the **Promotions screen draws a
     * Weekly Challenge card at all**, so leaving it false means that screen
     * cannot be seen working in development. The original concern survives
     * where it matters — the defaults are still false everywhere, and only a
     * seeder that already refuses to run outside development changes them.
     */
    private function tipAndBonus(Driver $driver, DriverLedgerService $ledger): void
    {
        /*
         * One of **this seeder's own** six rides, identified by the rating it
         * writes for each of them.
         *
         * "The newest completed trip" was the first attempt and it picked up a
         * walk-in from the live demo whose settled fare is UGX 198,013,800 —
         * a real figure in the development database and, at roughly fifty
         * thousand dollars for a cross-town run, a real bug in something. A
         * demo tip hanging off it would have made this seeder's output depend
         * on whatever else happened to be in the database.
         */
        $trip = Trip::query()
            ->withoutGlobalScope(TenantScope::class)
            ->where('driver_id', $driver->getKey())
            ->where('status', TripStatus::TRIP_COMPLETED)
            ->whereNull('tenant_id')
            ->whereNotNull('fare_minor')
            ->whereExists(fn ($q) => $q->select(DB::raw(1))
                ->from('trip_ratings')
                ->whereColumn('trip_ratings.trip_id', 'trips.id'))
            ->orderByDesc('id')
            ->first();

        if ($trip !== null && ! DriverLedgerEntry::query()
            ->where('trip_id', $trip->getKey())
            ->where('kind', LedgerEntryKind::TIP_EARNED)
            ->exists()
        ) {
            // 2,000 — the mockup's figure. At 20% the driver keeps 1,600 and
            // owes 400, so the pair reads correctly on the statement and the
            // balance moves by the commission rather than by the tip.
            $ledger->recordTip(
                $driver,
                $trip,
                2_000,
                'UGX',
                $this->dispatcher(),
                'Passenger rounded up',
            );
        }

        // Guarded like everything else in this seeder, which is re-runnable by
        // contract — its own docblock promises it, and a previous draft broke
        // that promise in a way that only a second run revealed.
        $alreadyAwarded = DriverLedgerEntry::query()
            ->where('driver_id', $driver->getKey())
            ->where('kind', LedgerEntryKind::BONUS)
            ->exists();

        if (! $alreadyAwarded) {
            $ledger->recordBonus(
                $driver,
                20_000,
                'UGX',
                'Weekly bonus for last week: 41 trips against a target of 40',
            );
        }
    }

    /**
     * Switches the three incentive schemes on, and gives the referral one
     * somebody to have introduced (ADR-0036, ADR-0037).
     *
     * **Every one of them defaults to off in production**, deliberately, so a
     * freshly seeded database shows a Promotions screen reading *"There are no
     * promotions running at the moment"* — which is the screen behaving
     * correctly and looking broken. This is the seeder's job: the schemes are
     * off because switching them on is a commercial act, and a developer
     * looking at the screen needs to see the case that has something in it.
     *
     * Guarded by `refuseOutsideDevelopment()` like the rest of this file.
     *
     * ## The referral is written through the real service, not as a row
     *
     * So the demo data is whatever `ReferralService` says it is, including the
     * frozen figures and the qualifying rule — the same reason the fares go
     * through `recordCompletedTrip()` and the tip through `recordTip()`. It
     * also means the *second* referral below stays pending exactly as long as
     * that driver has fewer than the target completed trips, rather than
     * because the seeder decided it should look that way.
     */
    /**
     * What the office screens show — contact details, the emergency number,
     * an inbox, and a settlement request the office has not answered yet.
     *
     * ## Why these are seeded at all
     *
     * Every one of these surfaces renders an *honest empty state* on a fresh
     * database — Support says the office has published no number, Safety warns
     * there is no emergency line, the inbox says nothing has arrived. All
     * correct, and all useless for judging whether the screens work. The demo
     * exists to show the populated branch; the empty branches keep their tests.
     *
     * ## The numbers are demo numbers on purpose
     *
     * `999` is Uganda's real emergency number and stays. The office phone is a
     * reserved-looking placeholder a developer cannot accidentally dial into
     * somebody's pocket. An operator setting up a real deployment replaces
     * both in the console.
     *
     * Notifications are guarded per subject rather than wholesale, so a
     * re-run refreshes nothing and duplicates nothing — the same
     * look-then-create shape the rest of this seeder settled on after two
     * re-runnability bugs.
     */
    private function officeAndInbox(Driver $driver, SettingsService $settings): void
    {
        $settings->setGroup('branding', [
            'contact_phone' => '+256 700 123 456',
        ]);

        $settings->setGroup('safety', [
            'emergency_number' => '999',
        ]);

        $user = $driver->user;

        if ($user === null) {
            return;
        }

        // Three messages, two of them read, so the screen shows both visual
        // states and the drawer's dot has exactly one thing to count.
        $inbox = [
            [
                'subject' => 'New job: Acacia Mall to Kololo Airstrip',
                'body' => 'A ride pickup at Acacia Mall was offered to you.',
                'read' => true,
                'at' => Carbon::now()->subDays(2)->setTime(9, 12),
            ],
            [
                'subject' => 'New job: Garden City to Ntinda',
                'body' => 'A delivery pickup at Garden City was offered to you.',
                'read' => true,
                'at' => Carbon::now()->subDay()->setTime(15, 40),
            ],
            [
                'subject' => 'New job: Lugogo Mall to Bukoto',
                'body' => 'A ride pickup at Lugogo Mall was offered to you.',
                'read' => false,
                'at' => Carbon::now()->subHours(2),
            ],
        ];

        foreach ($inbox as $message) {
            $exists = Notification::query()
                ->where('user_id', $user->getKey())
                ->where('subject', $message['subject'])
                ->exists();

            if ($exists) {
                continue;
            }

            $notification = new Notification([
                // Null tenant: a driver is the platform's, not a client's
                // (ADR-0005), and the platform-scoped migration made the
                // column nullable for exactly this shape of recipient.
                'tenant_id' => null,
                'user_id' => $user->getKey(),
                'type' => NotificationType::TRIP_OFFERED,
                'subject' => $message['subject'],
                'body' => $message['body'],
                'url' => null,
                'context' => null,
                'read_at' => $message['read'] ? $message['at']->copy()->addMinutes(30) : null,
            ]);
            $notification->created_at = $message['at'];
            $notification->save();
        }

        // One settlement request the office has not answered, so the Wallet
        // shows the pending band. Through the real service so the one-open
        // rule and the request shape stay whatever ADR-0032 says they are;
        // guarded first because that same rule refuses a second open request.
        $hasOpen = DriverSettlementRequest::query()
            ->where('driver_id', $driver->getKey())
            ->where('status', SettlementRequestStatus::PENDING)
            ->where('kind', SettlementRequestKind::REMITTANCE)
            ->exists();

        if (! $hasOpen) {
            app(DriverSettlementRequestService::class)->raise(
                $driver,
                SettlementRequestKind::REMITTANCE,
                10_000,
                'Cash handed to the depot on Friday evening',
            );
        }
    }

    private function promotions(Driver $driver, SettingsService $settings, ReferralService $referrals): void
    {
        $settings->setGroup('billing', [
            // The mockup's figures, so the demo screen reads as it was drawn.
            'bonus_enabled' => true,
            'bonus_weekly_trip_target' => 30,
            'bonus_weekly_amount_minor' => 50_000,
            'peak_enabled' => true,
            'peak_starts_at' => '17:00',
            'peak_ends_at' => '20:00',
            'peak_uplift_percent' => 20,
            'referral_enabled' => true,
            'referral_trip_target' => 10,
            'referral_reward_amount_minor' => 10_000,
        ]);

        // Minted here rather than left to the first screen open, so the code
        // is stable across runs and can be read off the database.
        $referrals->codeFor($driver);

        // Somebody they introduced who is already driving. `attach()` is a
        // no-op on a second run — `driver_referrals.referred_driver_id` is
        // unique — so this is re-runnable without a guard of its own.
        $recruit = $this->accountFor('driver.recruit@kangaruride.test', 'Recruited Rider');

        $referrals->attach($recruit, (string) $driver->refresh()->referral_code);
    }

    /**
     * A roster, and the shifts worked against it — so the Performance screen
     * has an online-hours dial with something to be a fraction of (ADR-0038).
     *
     * ## Both halves are needed, and neither is optional
     *
     * The dial draws online hours against **rostered** hours. Seed the duty
     * sessions alone and the arc is absent (no denominator); seed the roster
     * alone and it is empty. A driver looking at the demo would see a screen
     * that is working correctly and looks broken either way.
     *
     * Sessions are written through `DutySessionService`, not as rows, for the
     * reason the ledger seeding gives: the demo data is then whatever the
     * service's rules say it is, and a change to those rules changes this with
     * it. In particular the `ended_at`-before-`started_at` guard and the
     * one-open-session invariant apply here exactly as they do in the app.
     *
     * ## Re-runnable, which this file has broken twice
     *
     * Guarded on the shift windows rather than on the sessions: the windows
     * are written first, so a guard on the sessions would let a second run
     * stack seven more shift rows before it noticed. Both previous
     * re-runnability bugs in this seeder were exactly this shape — a guard
     * checking something written after the thing that collides.
     */
    private function seedRosterAndShifts(Driver $driver): void
    {
        if (DriverShiftWindow::query()->where('driver_id', $driver->getKey())->exists()) {
            return;
        }

        $timezone = app(DriverEarningsService::class)->timezone();
        $weekStart = CarbonImmutable::now($timezone)->startOfWeek()->startOfDay();

        // Monday to Saturday, 07:00–17:00. Ten hours a day, sixty a week —
        // a plausible Kampala roster, and deliberately not seven days: a
        // driver with a day off is the ordinary case and makes the dial read
        // as a roster rather than as a formula.
        foreach (range(1, 6) as $weekday) {
            DriverShiftWindow::create([
                'driver_id' => $driver->getKey(),
                'weekday' => $weekday,
                'starts_at' => '07:00:00',
                'ends_at' => '17:00:00',
            ]);
        }

        $sessions = app(DutySessionService::class);
        $now = CarbonImmutable::now($timezone);

        // One closed shift per elapsed day of the week so far, a little
        // shorter than the roster — which is what makes the arc partial and
        // therefore worth drawing. A shift that exactly matched the roster
        // would render a full ring and prove nothing about the arithmetic.
        for ($day = 0; $day < 6; $day++) {
            $start = $weekStart->addDays($day)->setTime(7, 30);

            // Never seed the future. A shift ending tomorrow would count
            // hours nobody has worked, which is the one thing this figure
            // must never do.
            if ($start->greaterThanOrEqualTo($now)) {
                break;
            }

            $end = $start->addHours(8)->addMinutes(20);

            $sessions->open($driver->getKey(), $driver->vehicle_id, $start);
            $sessions->close($driver->getKey(), $end->lessThan($now) ? $end : $now);
        }
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
        //
        // **Look first, then fall back to the factory** — the same pattern,
        // and the same reason, as the vehicle in `seedEarningsAndRatings()`
        // below. `registration_number` is unique, so a plain `create` made
        // this whole seeder unrunnable a second time: it threw on
        // `UDD 001D` before reaching anything after it, which on this branch
        // meant the tip and bonus demo rows could never land on a database
        // that had already been seeded once.
        //
        // Not `firstOrCreate`: its second argument is a bare attribute list
        // and `vehicles.make` is NOT NULL with no default, so the created
        // branch inserts a row the schema rejects. That trap is written up at
        // the other call site — it passed locally, where only the *found*
        // branch ever ran, and failed in CI.
        $vehicles = collect(['sedan', 'suv', 'van'])->map(function (string $category, int $index) {
            $registration = sprintf('UDD %03dD', $index + 1);

            return Vehicle::query()->firstWhere('registration_number', $registration)
                ?? Vehicle::factory()->create([
                    'category' => $category,
                    'registration_number' => $registration,
                ]);
        });

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
    /**
     * The driver's *own* vehicle, which nothing here had ever set.
     *
     * `drivers.vehicle_id` is what `Driver::vehicle()` calls "the durable one —
     * the driver's own vehicle, which for a boda rider is not separable from
     * the driver at all". Every vehicle this seeder makes was until now
     * attached only to a *trip*, so a seeded driver had none: the Profile
     * screen reported an em dash for a fact the platform could easily hold,
     * and `AvailabilityService` had one less reason to consider them offerable.
     *
     * Assigned, never created. This is the car they have been driving on every
     * seeded trip; pointing at a second one would be a demo database
     * disagreeing with itself.
     *
     * Its own step rather than a line inside `seedEarningsAndRatings`, because
     * that method returns early once its trips exist — so on the second run,
     * which is the run everybody actually does, the line would never execute.
     * That is the exact shape of the `firstOrCreate` bug this file already
     * records: a branch written, shipped, and never run once.
     */
    /**
     * The demo driver rides a **boda**, and both the driver record and their
     * presence row are moved onto it.
     *
     * ## Why a boda and not the sedan this used to assign
     *
     * The category is not cosmetic — it is the input the walk-in tariff prices
     * against. `WalkInFareService::quote()` builds a `Vehicle` from a category
     * alone and `RateCardResolver` looks that category up in the public
     * tariff's rates, so the demo driver's vehicle decides which row of the
     * tariff every fare on the app is computed from. On a sedan the app
     * demonstrated sedan pricing, which is not the vehicle this product is
     * mostly about: PRODUCT.md's driver is on an Android handset in Kampala,
     * and the boda is the common case.
     *
     * The public tariff already prices `boda` — base 2,000, 1,000/km,
     * 200/waiting minute, minimum 3,000, maximum 150,000 (ADR-0035's backstop)
     * — so nothing about the rate card had to change for this.
     *
     * ## Why a second boda rather than reusing the fleet's
     *
     * `UEB 001B` belongs to the *free* driver, who exists so automatic
     * dispatch has somebody to offer work to. Taking their vehicle to give the
     * primary account a boda would fix one demo by breaking the other — a
     * driver on duty with no vehicle is ranked by the matcher and then dropped
     * as unofferable, which `DriverPresenceController::vehicleFor()` records
     * as a real bug found the hard way.
     *
     * ## Why this corrects an existing assignment
     *
     * The guard is on the *category*, not on `vehicle_id` being null. The old
     * version returned early for any driver who already had a vehicle, so on a
     * database seeded before this change the demo driver would have stayed on
     * the sedan forever and re-running the seeder would have looked like it
     * did nothing. Correcting the row is safe precisely because this is demo
     * data in a seeder that already refuses to run outside development.
     *
     * The live trip keeps whatever vehicle it was dispatched with. A trip
     * records the vehicle that actually did the work, and rewriting history to
     * match a driver's current bike is the opposite of what this platform is
     * for.
     */
    private function assignOwnVehicle(Driver $driver): void
    {
        $current = $driver->vehicle_id !== null
            ? Vehicle::query()->find($driver->vehicle_id)
            : null;

        if ($current !== null && $current->category === 'boda') {
            return;
        }

        // Look first, then the factory — never `firstOrCreate`. Its second
        // argument is a bare attribute list and `vehicles.make` is NOT NULL
        // with no default, so the created branch inserts a row the schema
        // rejects. That trap is documented at both other vehicle call sites in
        // this file and has already shipped once.
        $boda = Vehicle::query()->firstWhere('registration_number', 'UDD 005D')
            ?? Vehicle::factory()->create([
                'category' => 'boda',
                'registration_number' => 'UDD 005D',
                'make' => 'Bajaj',
                'model' => 'Boxer 100',
            ]);

        $driver->forceFill(['vehicle_id' => $boda->getKey()])->save();

        // Presence carries its own `vehicle_id`, and it is what dispatch ranks
        // and offers against. Leaving it on the old sedan would put the driver
        // record and the dispatch pool in disagreement about what this person
        // is driving — and the offer, not the profile, is what a fare is
        // quoted from.
        DB::table('driver_presence')
            ->where('driver_id', $driver->getKey())
            ->update(['vehicle_id' => $boda->getKey(), 'updated_at' => now()]);
    }

    /**
     * The driver's papers, in all four states the app can draw (ADR-0033).
     *
     * ## Why one of each rather than four verified
     *
     * The mockup shows **Documents — Verified**, and seeding four accepted
     * documents would reproduce that screenshot exactly. It would also mean
     * nobody ever sees the rejected row, the pending row or the empty slot
     * until a real driver hits one — and those three are where the screen's
     * behaviour actually lives. So: one verified, one verified-but-expiring,
     * one waiting, one rejected with a reason. The compliance badge therefore
     * reads *action needed* rather than *verified*, which is the honest
     * summary of that set.
     *
     * ## Written through the service, never as rows
     *
     * `DriverDocumentService` owns the rule that a replacement resets the
     * review, and `DriverDocumentStore` owns the path layout. Inserting rows
     * here would produce demo data that a change to either rule would silently
     * stop matching — the same argument the ledger seeding above makes for
     * going through `DriverLedgerService`.
     *
     * Re-runnable like everything else here: the guard is on the documents
     * themselves, and re-running would otherwise re-upload four files and
     * orphan the previous ones.
     */
    private function seedDocuments(Driver $driver): void
    {
        $alreadySeeded = DriverDocument::query()
            ->where('driver_id', $driver->getKey())
            ->exists();

        if ($alreadySeeded) {
            return;
        }

        $documents = app(DriverDocumentService::class);
        $reviewer = $this->dispatcher();

        // A tiny PDF rather than `UploadedFile::fake()->image()`, which needs
        // the GD extension — absent on plenty of development machines, and a
        // seeder that fails on somebody's laptop for a reason unrelated to the
        // data is a seeder people stop running.
        $file = fn (string $name): UploadedFile => UploadedFile::fake()
            ->create($name, 24, 'application/pdf');

        $licence = $documents->upload(
            $driver,
            DriverDocumentType::DRIVING_LICENCE,
            $file('licence.pdf'),
            // Comfortably ahead, so this row is the plain verified case.
            Carbon::now()->addYears(2)->toDateString(),
        );
        $documents->verify($licence, $reviewer);

        $identity = $documents->upload(
            $driver,
            DriverDocumentType::IDENTITY_DOCUMENT,
            $file('national-id.pdf'),
            null,
        );
        $documents->verify($identity, $reviewer);

        // Waiting on the office. Left `pending` on purpose — it is the state a
        // driver sees for however long the queue takes, and the screen has to
        // read well in it.
        $documents->upload(
            $driver,
            DriverDocumentType::VEHICLE_INSURANCE,
            $file('insurance.pdf'),
            Carbon::now()->addMonths(3)->toDateString(),
        );

        $registration = $documents->upload(
            $driver,
            DriverDocumentType::VEHICLE_REGISTRATION,
            $file('logbook.pdf'),
            null,
        );
        $documents->reject(
            $registration,
            $reviewer,
            'The photo is too dark to read the chassis number. Please send it again in daylight.',
        );
    }

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

        /*
         * **The override reason is not optional here, and finding that out
         * cost a run.** `DemoHistorySeeder` contracts vehicles to the tenant
         * for these dates (ADR-0009), and this seeder assigns the demo
         * driver's *own* car — which is not one of them. `assign()` refuses
         * that pairing without a reason, so on a freshly seeded platform this
         * seeder died on its first trip with
         * `AllocationOverrideRequiredException` and left a database with a
         * driver account and no work.
         *
         * Passing a reason rather than contracting the car: the override is
         * what actually happened, and it is recorded on the trip where a
         * dispatcher can read it. Seeding around the rule would hide the one
         * ADR-0009 field the console has to be able to display.
         */
        return app(DispatchService::class)->assign(
            $booking,
            $vehicle->id,
            $driver->id,
            $dispatcher,
            'Demo data: the driver is on their own assigned vehicle.',
        );
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
    /**
     * Where the office should send this driver's money (ADR-0042).
     *
     * **Only the demo driver gets one.** The free driver is deliberately left
     * without, because the Bank Details screen has two states worth showing and
     * a seeder that populates every account can only ever demonstrate one of
     * them — the same reason `officeAndInbox` guards its notifications per
     * subject rather than wholesale.
     *
     * `updateOrCreate` on the driver, matching the endpoint's own upsert: the
     * record is one-per-driver, and re-running this seeder must not leave a
     * driver with two destinations for their pay.
     */
    private function payoutAccount(Driver $driver): void
    {
        DriverPayoutAccount::query()->updateOrCreate(
            ['driver_id' => $driver->getKey()],
            [
                'kind' => PayoutAccountKind::BANK,
                'institution' => 'Centenary Bank',
                'account_holder' => $driver->name,
                // `last_four` is derived by the model's boot hook and the
                // number is encrypted at rest, so this is written as the
                // endpoint would write it rather than as columns.
                'account_number' => '3100047761',
            ],
        );
    }

    /**
     * Closing an account (ADR-0043), seeded as the two states a demo needs.
     *
     * **The pending one goes on the free driver, not on the demo driver**, and
     * that placement is the whole point. A pending request blocks a second
     * (`CLOSURE_REQUEST_ALREADY_OPEN`), so putting it on the account somebody
     * signs into to present the app would leave the ask-flow undemonstrable —
     * the driver would open the danger zone and find a withdraw button where
     * the walk-through expects a form. On the free driver it does the job it is
     * there for: it gives the **office queue** a request to confirm or decline
     * live.
     *
     * **The demo driver gets a declined one**, which is the richest state for
     * the screen: the office's reason renders above the form, and the form is
     * still there — a decline is not a closure, and asking again is the whole
     * reason the endpoint returns the latest request rather than only an open
     * one.
     *
     * Written through `DriverClosureService` rather than as rows, like every
     * other write in this file: the statuses, the reviewer stamp and the
     * one-open-per-driver rule are the service's, and a seeder that reproduces
     * them by hand is a second implementation that will drift.
     */
    private function closureRequests(Driver $driver, Driver $onDuty): void
    {
        $closures = app(DriverClosureService::class);

        // Idempotent: re-running must not stack a queue of identical asks in
        // front of the office, and `request()` would throw on the second.
        if (DriverClosureRequest::query()->where('driver_id', $onDuty->getKey())->doesntExist()) {
            $closures->request($onDuty, 'Moving back to Gulu at the end of the month.');
        }

        if (DriverClosureRequest::query()->where('driver_id', $driver->getKey())->doesntExist()) {
            $asked = $closures->request($driver, 'I am taking a job with a bank.');

            $closures->decline(
                $asked,
                $this->dispatcher(),
                'Settle the 45,000 UGX on your wallet first, then ask again and we will close it.',
            );
        }
    }

    /**
     * Two strangers waiting to be let in (ADR-0027).
     *
     * The console's review queue was empty on a fully seeded platform, which
     * is the one state that makes a queue impossible to demonstrate: approve
     * and decline are the whole feature, and neither has anything to act on.
     *
     * Written as rows rather than posted through the public endpoint, because
     * the endpoint is rate-limited and answers identically for known and
     * unknown emails by design (ADR-0027 §5) — a seeder cannot read back what
     * it made. The password is hashed the way the request would hash it, so an
     * approved applicant can actually sign in afterwards, which is the half of
     * this that would otherwise be a lie.
     */
    private function driverApplications(): void
    {
        foreach ([
            ['Shanitah Nabbosa', '+256 772 445 118', 'shanitah.applies@kangaruride.test'],
            ['Ronald Wasswa', '+256 701 908 233', 'ronald.applies@kangaruride.test'],
        ] as [$name, $phone, $email]) {
            DriverApplication::query()->firstOrCreate(
                ['email' => $email],
                [
                    'name' => $name,
                    'phone' => $phone,
                    'password' => Hash::make(self::ACCOUNT_PASSWORD),
                    'status' => DriverApplicationStatus::PENDING,
                    'terms_accepted_at' => CarbonImmutable::now()->subDays(2),
                ],
            );
        }
    }

    /**
     * Leave, in both the states the screen has (ADR-0017).
     *
     * One answered and one still waiting, and it has to be both: an approved
     * block is what the driver's Time off screen shows as a decision, and a
     * requested one is what the office's queue shows as a decision to make.
     * Seeding only the first leaves the console with nothing to answer;
     * seeding only the second leaves the driver's screen looking as though the
     * office never replies.
     *
     * Dates are in the **future** deliberately. A leave request that has
     * already ended is history, and history is not what either screen is for.
     */
    private function timeOff(Driver $driver): void
    {
        $approved = CarbonImmutable::now()->addDays(9)->startOfDay();
        $requested = CarbonImmutable::now()->addDays(24)->startOfDay();

        AvailabilityBlock::query()->firstOrCreate(
            [
                'resource_type' => AvailabilityResource::DRIVER,
                'resource_id' => $driver->getKey(),
                'starts_at' => $approved,
            ],
            [
                'kind' => AvailabilityKind::LEAVE,
                'status' => AvailabilityStatus::APPROVED,
                'ends_at' => $approved->addDays(2)->endOfDay(),
                'reason' => 'My sister is getting married in Masaka.',
                'created_by_user_id' => $driver->user_id,
                'answered_by_user_id' => $this->dispatcher()->getKey(),
                'answered_at' => CarbonImmutable::now()->subDay(),
            ],
        );

        AvailabilityBlock::query()->firstOrCreate(
            [
                'resource_type' => AvailabilityResource::DRIVER,
                'resource_id' => $driver->getKey(),
                'starts_at' => $requested,
            ],
            [
                'kind' => AvailabilityKind::SICK,
                'status' => AvailabilityStatus::REQUESTED,
                'ends_at' => $requested->endOfDay(),
                'reason' => 'Hospital appointment in the morning.',
                'created_by_user_id' => $driver->user_id,
            ],
        );
    }

    /**
     * A service area, a pricing zone and a depot (ADR-0009).
     *
     * Rough rectangles over Kampala rather than real boundaries, and the two
     * that would change a fare or a dispatch say **"(verify)"** in their own
     * names. Demo geography that looks authoritative is worse than demo
     * geography that admits what it is: somebody will otherwise present a
     * pricing boundary drawn by a seeder as though the office had agreed it.
     */
    private function zones(Tenant $tenant): void
    {
        foreach ([
            ['Greater Kampala', ZoneKind::SERVICE_AREA, 90, [[-0.1, 32.3], [-0.1, 32.9], [0.6, 32.9], [0.6, 32.3]]],
            ['Kampala Central (verify)', ZoneKind::PRICING, 50, [[0.28, 32.53], [0.28, 32.64], [0.39, 32.64], [0.39, 32.53]]],
            ['Nakawa depot (verify)', ZoneKind::DEPOT, 20, [[0.32, 32.6], [0.32, 32.62], [0.34, 32.62], [0.34, 32.6]]],
        ] as [$name, $kind, $priority, $corners]) {
            // Plain `query()`: `Zone` carries a `tenant_id` column but no
            // `TenantScope`, so there is no scope here to step around — and
            // `allTenants()` does not exist on it.
            Zone::query()->firstOrCreate(
                ['tenant_id' => $tenant->id, 'name' => $name],
                [
                    'kind' => $kind,
                    'priority' => $priority,
                    'active' => true,
                    'boundary' => array_map(
                        static fn (array $corner): array => ['lat' => $corner[0], 'lng' => $corner[1]],
                        $corners,
                    ),
                ],
            );
        }
    }

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
