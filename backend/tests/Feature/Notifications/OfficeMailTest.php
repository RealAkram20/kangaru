<?php

use App\Enums\AccessLevel;
use App\Enums\UserRole;
use App\Models\Operator;
use App\Models\User;
use Illuminate\Support\Facades\Mail;
use Modules\Administration\Services\SettingsService;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Services\DriverClosureService;
use Modules\Fleet\Console\AlertOnFleetsWithoutAccounts;
use Modules\Fleet\Services\OperatorService;
use Modules\Notifications\Enums\NotificationType;
use Modules\Notifications\Models\MailDelivery;

/**
 * M6, the office families.
 *
 * ## The one assertion this file exists for
 *
 * **An email about a fleet's operations goes to that fleet and to nobody
 * else.** ADR-0062 draws the line for reads; ADR-0055 §2 makes it the model's
 * whole point. A recipient list is the easiest place in this codebase to cross
 * it, because a leak there does not look like a bug. It looks like a helpful
 * CC, and it is one line of code.
 *
 * The cross-fleet test below asserts the rival's office is present in the
 * database and absent from the recipients, in that order. An "is absent"
 * assertion on its own passes against an empty table, which is the shape
 * kangaru-c0 warned about when they narrowed the dispatch candidate pool.
 */
function officeMailOn(): void
{
    app(SettingsService::class)->setGroup('mail', [
        'enabled' => true,
        'host' => 'smtp.example.test',
        'port' => 587,
        'username' => '',
        'password' => 'secret',
        'encryption' => 'tls',
        'from_address' => 'operations@kangaruride.test',
        'from_name' => 'KangaruRide',
    ]);
}

/**
 * Two fleets, each with a dispatcher, and one driver at the first.
 *
 * @return array{mine: Operator, rival: Operator, driver: Driver}
 */
function twoFleets(): array
{
    $mine = Operator::create(['name' => 'Shanitah', 'slug' => 'shanitah-office-'.uniqid(), 'status' => 'active']);
    $rival = Operator::create(['name' => 'Second Fleet', 'slug' => 'rival-office-'.uniqid(), 'status' => 'active']);

    foreach ([[$mine, 'dispatcher@shanitah.test'], [$rival, 'dispatcher@rival.test']] as [$operator, $email]) {
        User::factory()->create([
            'tenant_id' => null,
            'operator_id' => $operator->id,
            'access_level' => AccessLevel::FLEET,
            'role' => UserRole::OPERATIONS_MANAGER,
            'email' => $email,
        ]);
    }

    $driverUser = User::factory()->create([
        'tenant_id' => null,
        'operator_id' => $mine->id,
        'access_level' => AccessLevel::FLEET,
        'role' => UserRole::DRIVER,
        'name' => 'Joseph Okello',
        'email' => 'joseph@shanitah.test',
    ]);

    $driver = Driver::factory()->create([
        'user_id' => $driverUser->id,
        'operator_id' => $mine->id,
    ]);

    return ['mine' => $mine, 'rival' => $rival, 'driver' => $driver];
}

function officeRecipientsOf(NotificationType $type): array
{
    return MailDelivery::query()
        ->where('type', $type->value)
        ->pluck('recipient')
        ->sort()
        ->values()
        ->all();
}

it('tells one fleet about its own driver and never tells a competitor', function () {
    officeMailOn();
    Mail::fake();

    ['rival' => $rival, 'driver' => $driver] = twoFleets();

    /*
     * Asserted present first, then absent. An "is absent" assertion on its own
     * passes against an empty table, which would make this test green while
     * proving nothing at all.
     */
    expect(User::query()->where('operator_id', $rival->id)->exists())->toBeTrue();

    app(DriverClosureService::class)->request($driver, 'I am moving upcountry.');

    expect(officeRecipientsOf(NotificationType::FLEET_CLOSURE_REQUESTED))
        ->toBe(['dispatcher@shanitah.test']);
});

it('keeps the driver out of the office queue their own request created', function () {
    officeMailOn();
    Mail::fake();

    ['driver' => $driver] = twoFleets();

    app(DriverClosureService::class)->request($driver, 'I am moving upcountry.');

    // Drivers hold no office permission today, but a role is data since
    // ADR-0004 and a deployment could grant one. An operational alert
    // addressed to the driver it is about is odd and occasionally revealing.
    expect(officeRecipientsOf(NotificationType::FLEET_CLOSURE_REQUESTED))
        ->not->toContain('joseph@shanitah.test');
});

it('does not put the driver\'s reason in the email', function () {
    officeMailOn();
    Mail::fake();

    ['driver' => $driver] = twoFleets();

    app(DriverClosureService::class)->request($driver, 'The office keeps shorting my settlements.');

    $delivery = MailDelivery::query()
        ->where('type', NotificationType::FLEET_CLOSURE_REQUESTED->value)
        ->firstOrFail();

    /*
     * An office inbox is read on a shared machine at a depot desk. The reason
     * is somebody's account of why they are leaving, sometimes about the
     * people who will read it, and it belongs on the screen behind
     * `drivers.manage` rather than in a subject line.
     */
    expect($delivery->subject)->not->toContain('shorting')
        ->and($delivery->subject)->toContain('Joseph Okello');
});

it('tells head office when a fleet joins, and stamps the row with no fleet', function () {
    officeMailOn();
    Mail::fake();

    User::factory()->create([
        'tenant_id' => null,
        'operator_id' => null,
        'access_level' => AccessLevel::KANGARU,
        'role' => UserRole::SUPER_ADMIN,
        'email' => 'headoffice@kangaruride.test',
    ]);

    app(OperatorService::class)->onboard([
        'name' => 'Third Fleet Ltd',
        'owner_name' => 'Sarah Namuli',
        'owner_email' => 'sarah@thirdfleet.test',
    ]);

    expect(officeRecipientsOf(NotificationType::PLATFORM_FLEET_ONBOARDED))
        ->toBe(['headoffice@kangaruride.test']);

    // Head office belongs to no fleet, so the delivery row carries none. A
    // stamped operator here would make the cross-fleet audit query answer
    // wrongly, which is the query that exists to catch exactly this.
    $delivery = MailDelivery::query()
        ->where('type', NotificationType::PLATFORM_FLEET_ONBOARDED->value)
        ->firstOrFail();

    expect($delivery->operator_id)->toBeNull();
});

it('alerts head office when a fleet has nobody who can sign in', function () {
    officeMailOn();
    Mail::fake();

    User::factory()->create([
        'tenant_id' => null,
        'operator_id' => null,
        'access_level' => AccessLevel::KANGARU,
        'role' => UserRole::SUPER_ADMIN,
        'email' => 'headoffice@kangaruride.test',
    ]);

    /*
     * The gap the worklog has carried since K4: *"fleets_without_an_account is
     * a number on a dashboard, not an alert. If ADR-0059 §5's invariant
     * breaks, somebody has to be looking."*
     *
     * Created directly rather than through `OperatorService`, because that
     * service creates the owner in the same transaction and therefore cannot
     * produce this state. The state is reached by an account being removed
     * afterwards, which is exactly the case ADR-0059 §5 worries about.
     */
    Operator::create(['name' => 'Orphaned Fleet', 'slug' => 'orphaned-fleet', 'status' => 'active']);

    $this->artisan(AlertOnFleetsWithoutAccounts::class)->assertSuccessful();

    /*
     * One email per orphaned fleet per recipient, so the assertion is on the
     * *fleet named* rather than on a count.
     *
     * That distinction was forced by a real finding: the base migration
     * creates Shanitah (`Operator::SHANITAH`) and **no accounts for it**, so a
     * fresh database already has one orphan before this test adds a second.
     * On a fresh deployment this alert therefore fires on day one, correctly:
     * the invariant genuinely is false until somebody is invited.
     */
    $subjects = MailDelivery::query()
        ->where('type', NotificationType::PLATFORM_FLEET_HAS_NO_ACCOUNT->value)
        ->pluck('subject')
        ->all();

    expect($subjects)->toContain('Orphaned Fleet has nobody who can sign in')
        ->and(officeRecipientsOf(NotificationType::PLATFORM_FLEET_HAS_NO_ACCOUNT))
        ->each->toBe('headoffice@kangaruride.test');
});

it('says nothing when every fleet has an account, which is the normal state', function () {
    officeMailOn();
    Mail::fake();

    User::factory()->create([
        'tenant_id' => null,
        'operator_id' => null,
        'access_level' => AccessLevel::KANGARU,
        'role' => UserRole::SUPER_ADMIN,
        'email' => 'headoffice@kangaruride.test',
    ]);

    app(OperatorService::class)->onboard([
        'name' => 'Fourth Fleet Ltd',
        'owner_name' => 'Sarah Namuli',
        'owner_email' => 'sarah@fourthfleet.test',
    ]);

    /*
     * Shanitah is created by the base migration with no accounts, so a fresh
     * database is already in the broken state this alert is about. Given one
     * here, so the test asserts silence against a platform where the invariant
     * actually holds rather than against one where it does not.
     */
    User::factory()->create([
        'tenant_id' => null,
        'operator_id' => Operator::SHANITAH,
        'access_level' => AccessLevel::FLEET,
        'role' => UserRole::FLEET_OWNER,
        'email' => 'owner@shanitah.test',
    ]);

    MailDelivery::query()->delete();

    $this->artisan(AlertOnFleetsWithoutAccounts::class)->assertSuccessful();

    // A check that is always silent is a cheap check. The day it is not silent
    // is the day somebody needs to know without being told to look.
    expect(officeRecipientsOf(NotificationType::PLATFORM_FLEET_HAS_NO_ACCOUNT))->toBe([]);
});
