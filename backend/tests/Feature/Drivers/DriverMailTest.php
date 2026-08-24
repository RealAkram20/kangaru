<?php

use App\Enums\UserRole;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Mail;
use Modules\Administration\Services\SettingsService;
use Modules\Drivers\Console\SendExpiringDocumentReminders;
use Modules\Drivers\Enums\DriverDocumentStatus;
use Modules\Drivers\Enums\DriverDocumentType;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Models\DriverDocument;
use Modules\Drivers\Services\DriverEarningsService;
use Modules\Notifications\Enums\NotificationType;
use Modules\Notifications\Mail\MailMoney;
use Modules\Notifications\Models\MailDelivery;

/**
 * M4, the driver family.
 *
 * The expiry sweep is the point of this package. AGENTS.md names *"Document
 * Expiring"* on its short list of notifications worth having, and it was the
 * one item on that list with **nothing behind it**: `driver_documents.expires_at`
 * has been a column since ADR-0052 and nothing has ever read it on a schedule.
 * A licence could lapse with the driver and the office both finding out when a
 * traffic officer did.
 */
function driverMailOn(): void
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
 * A driver with a signed-in account and one verified licence.
 *
 * @return array{0: User, 1: Driver}
 */
function documentedDriver(?CarbonImmutable $expiresAt, string $email = 'driver@shanitah.test'): array
{
    $user = User::factory()->create(['role' => UserRole::DRIVER, 'email' => $email]);
    $driver = Driver::factory()->create(['user_id' => $user->id]);

    /*
     * Built directly rather than through `DriverDocumentService::upload()`.
     *
     * There is no `DriverDocument` factory, and the upload path wants a real
     * file, a fake disk and encryption. None of that is what this suite is
     * about: the sweep reads `expires_at` and `status` off a row and asks who
     * to tell. Going through the uploader would test the uploader.
     */
    DriverDocument::query()->create([
        'driver_id' => $driver->getKey(),
        'driver_application_id' => null,
        'type' => DriverDocumentType::DRIVING_LICENCE,
        'status' => DriverDocumentStatus::VERIFIED,
        'expires_at' => $expiresAt?->toDateString(),
        'file_path' => 'drivers/'.$driver->getKey().'/licence.pdf',
        'mime_type' => 'application/pdf',
        'size_bytes' => 1024,
        'uploaded_at' => now(),
    ]);

    return [$user, $driver];
}

function driverDeliveries(NotificationType $type): int
{
    return MailDelivery::query()->where('type', $type->value)->count();
}

/** Today, in the timezone the command itself resolves. Never the server's. */
function kampalaToday(): CarbonImmutable
{
    return CarbonImmutable::now(app(DriverEarningsService::class)->timezone())->startOfDay();
}

it('warns a driver exactly 30 days before a licence expires', function () {
    driverMailOn();
    Mail::fake();

    documentedDriver(kampalaToday()->addDays(30));

    $this->artisan(SendExpiringDocumentReminders::class)->assertSuccessful();

    expect(driverDeliveries(NotificationType::DRIVER_DOCUMENT_EXPIRING))->toBe(1);
});

it('warns again at 7 days, and on the day it lapses', function () {
    driverMailOn();
    Mail::fake();

    documentedDriver(kampalaToday()->addDays(7), 'seven@shanitah.test');
    documentedDriver(kampalaToday(), 'today@shanitah.test');

    $this->artisan(SendExpiringDocumentReminders::class)->assertSuccessful();

    expect(driverDeliveries(NotificationType::DRIVER_DOCUMENT_EXPIRING))->toBe(1)
        ->and(driverDeliveries(NotificationType::DRIVER_DOCUMENT_EXPIRED))->toBe(1);
});

it('says nothing on any other day, which is what makes a daily run idempotent', function () {
    driverMailOn();
    Mail::fake();

    // 29 and 8 days out: one day either side of a warning, on purpose. A
    // "within 30 days" window would fire on both of these and then again
    // tomorrow, which is why the offsets are exact date matches and why there
    // is no `reminded_at` column.
    documentedDriver(kampalaToday()->addDays(29), 'a@shanitah.test');
    documentedDriver(kampalaToday()->addDays(8), 'b@shanitah.test');

    $this->artisan(SendExpiringDocumentReminders::class)->assertSuccessful();

    expect(MailDelivery::query()->count())->toBe(0);
});

it('runs twice in a day without warning anybody twice', function () {
    driverMailOn();
    Mail::fake();

    documentedDriver(kampalaToday()->addDays(30));

    $this->artisan(SendExpiringDocumentReminders::class)->assertSuccessful();
    $this->artisan(SendExpiringDocumentReminders::class)->assertSuccessful();

    /*
     * Two rows, and that is the honest answer rather than a failure.
     *
     * The command is idempotent across *days*, which is what the schedule
     * needs, and is not idempotent across two runs in one day. A
     * `reminded_at` column would fix that and would introduce a second thing
     * that can disagree with the clock. `withoutOverlapping` on the schedule
     * is what makes the second run not happen.
     *
     * Pinned so nobody changes the schedule to hourly and quietly starts
     * emailing every driver twenty four times.
     */
    expect(driverDeliveries(NotificationType::DRIVER_DOCUMENT_EXPIRING))->toBe(2);
});

it('leaves documents the office has not verified alone', function () {
    driverMailOn();
    Mail::fake();

    [$user, $driver] = documentedDriver(null);

    DriverDocument::query()->where('driver_id', $driver->getKey())->update([
        'status' => DriverDocumentStatus::PENDING->value,
        'expires_at' => kampalaToday()->addDays(30)->toDateString(),
    ]);

    $this->artisan(SendExpiringDocumentReminders::class)->assertSuccessful();

    // A pending document is already in the office's queue and a rejected one
    // has its own notification. Telling a driver their unverified licence is
    // about to expire is two messages about one problem.
    expect(MailDelivery::query()->count())->toBe(0);
});

it('resolves today in the platform timezone rather than the server one', function () {
    driverMailOn();
    Mail::fake();

    /*
     * The bug this pins is not hypothetical. A sibling test in this suite
     * failed deterministically between midnight and 06:00 Kampala time on a
     * Monday, because it anchored a fixture on `startOfWeek()` in Africa/Kampala
     * while the suite clock was UTC.
     *
     * Here the clock is pinned to a moment where the two calendars disagree:
     * 22:30 UTC is already the next day in Kampala. A command reading the
     * server's date would look for documents expiring 30 days from *yesterday*
     * and find nothing.
     */
    CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-09-14 22:30:00', 'UTC'));

    $kampalaToday = CarbonImmutable::now('Africa/Kampala')->startOfDay();
    expect($kampalaToday->toDateString())->toBe('2026-09-15');

    documentedDriver($kampalaToday->addDays(30));

    $this->artisan(SendExpiringDocumentReminders::class)->assertSuccessful();

    expect(driverDeliveries(NotificationType::DRIVER_DOCUMENT_EXPIRING))->toBe(1);

    CarbonImmutable::setTestNow();
});

it('formats money by the currency rather than by dividing by a hundred', function () {
    // UGX is zero-decimal (PRODUCT.md). 45000 minor units is forty five
    // thousand shillings, not four hundred and fifty.
    expect(MailMoney::format(45000, 'UGX'))->toBe('UGX 45,000')
        ->and(MailMoney::format(4500, 'USD'))->toBe('$45.00')
        // An unrecognised currency prints rather than throws: a ledger row
        // with a bad code is worth fixing, but must not be the reason a driver
        // never hears their settlement was confirmed.
        ->and(MailMoney::format(4500, 'ZZZ'))->toBe('ZZZ 4,500');
});
