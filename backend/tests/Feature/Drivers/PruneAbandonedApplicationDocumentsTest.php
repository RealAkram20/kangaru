<?php

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Modules\Drivers\Console\PruneAbandonedApplicationDocuments;
use Modules\Drivers\Enums\DriverApplicationStatus;
use Modules\Drivers\Enums\DriverDocumentType;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Models\DriverApplication;
use Modules\Drivers\Models\DriverDocument;
use Modules\Drivers\Services\DriverDocumentService;

/**
 * ADR-0048 §5 — the third ending.
 *
 * Approval carries an applicant's documents onto the driver; rejection
 * destroys them. **An application nobody ever decides is neither**, and
 * without this sweep it means a photograph of a stranger's face and national
 * ID living on the operator's disk forever, against somebody who was never
 * employed and never refused.
 *
 * The two claims worth defending pull in opposite directions, which is why
 * both are here: it must destroy what it is for, and it must not touch
 * anything else — the cost of over-reaching is deleting a working driver's
 * licence.
 */
function abandonedApplication(int $daysOld, array $overrides = []): DriverApplication
{
    $application = DriverApplication::query()->create([
        'name' => 'Grace Namutebi',
        'phone' => '+256 772 987 654',
        'email' => 'grace'.$daysOld.uniqid().'@kangaruride.test',
        'password' => bcrypt('a-password-i-chose'),
        'status' => DriverApplicationStatus::PENDING,
        'terms_accepted_at' => now(),
        ...$overrides,
    ]);

    // `forceFill` on the timestamp: `created_at` is not fillable and the whole
    // question here is how old the row is.
    $application->forceFill(['created_at' => now()->subDays($daysOld)])->save();

    return $application->fresh();
}

function attachDocument(DriverApplication $application, DriverDocumentType $type): DriverDocument
{
    return app(DriverDocumentService::class)->upload(
        $application,
        $type,
        UploadedFile::fake()->image('paper.jpg'),
        null,
    );
}

beforeEach(function () {
    Storage::fake();
});

it('destroys the files of an application nobody decided in ninety days', function () {
    $application = abandonedApplication(PruneAbandonedApplicationDocuments::RETENTION_DAYS + 1);
    $path = attachDocument($application, DriverDocumentType::IDENTITY_SELFIE)->file_path;

    Storage::assertExists($path);

    $this->artisan('drivers:prune-abandoned-application-documents')->assertSuccessful();

    expect(DriverDocument::count())->toBe(0);
    Storage::assertMissing($path);

    /**
     * **The row survives, and that is not an oversight.**
     *
     * `driver_applications` holds the name, the phone number and
     * `terms_accepted_at` — that row *is* the record that somebody applied,
     * and the consent timestamp is the thing Uganda's Data Protection and
     * Privacy Act, 2019 wants kept. The photographs were evidence for a
     * decision nobody made; they are not the record.
     */
    expect($application->fresh())->not->toBeNull();
    expect($application->fresh()->terms_accepted_at)->not->toBeNull();

    // The spent ticket goes with them.
    expect($application->fresh()->upload_token_hash)->toBeNull();
});

it('leaves an application that is still inside the window alone', function () {
    $application = abandonedApplication(PruneAbandonedApplicationDocuments::RETENTION_DAYS - 1);
    $path = attachDocument($application, DriverDocumentType::IDENTITY_DOCUMENT)->file_path;

    $this->artisan('drivers:prune-abandoned-application-documents')->assertSuccessful();

    // Ninety days is long enough that a real applicant chasing the office by
    // telephone is not quietly deleted mid-conversation.
    expect(DriverDocument::count())->toBe(1);
    Storage::assertExists($path);
});

it('never touches the documents of a driver who was approved', function () {
    $application = abandonedApplication(PruneAbandonedApplicationDocuments::RETENTION_DAYS + 30);
    $path = attachDocument($application, DriverDocumentType::DRIVING_LICENCE)->file_path;

    $driver = Driver::factory()->create();
    app(DriverDocumentService::class)->carryToDriver($application, $driver);

    // Deliberately left `pending` and old, which is the state that would trip
    // a sweep written to look at age alone.
    $application->forceFill(['status' => DriverApplicationStatus::PENDING->value])->save();

    $this->artisan('drivers:prune-abandoned-application-documents')->assertSuccessful();

    // The cost of a bug here is deleting a working driver's licence.
    expect(DriverDocument::count())->toBe(1);
    expect(DriverDocument::sole()->driver_id)->toBe($driver->id);
    Storage::assertExists($path);
});

it('leaves a decided application alone even if a document is still attached to it', function () {
    /**
     * **The state this constructs cannot arise from the normal paths**, and
     * that is the point.
     *
     * Approval re-points a document at the driver and rejection destroys it,
     * so a decided application holding one is already a bug. Mutation proved
     * the earlier "approved driver" test could not defend the `status` clause
     * for exactly that reason: by the time approval has run, the document no
     * longer points at the application, so removing the clause changed
     * nothing and the test stayed green.
     *
     * A guard whose only job is to survive somebody else's future bug still
     * has to be provable. Building the broken state by hand is the honest way
     * to do that.
     *
     * And leaving it alone is the right behaviour, not merely the safe one: a
     * decided application holding a file is something to investigate, and a
     * nightly job that silently destroys the evidence is how it never gets
     * investigated.
     */
    $application = abandonedApplication(
        PruneAbandonedApplicationDocuments::RETENTION_DAYS + 30,
        ['status' => DriverApplicationStatus::REJECTED],
    );

    $path = attachDocument($application, DriverDocumentType::VEHICLE_REGISTRATION)->file_path;

    $this->artisan('drivers:prune-abandoned-application-documents')->assertSuccessful();

    expect(DriverDocument::count())->toBe(1);
    Storage::assertExists($path);
});

it('destroys nothing on a dry run, and says what it would have destroyed', function () {
    $application = abandonedApplication(PruneAbandonedApplicationDocuments::RETENTION_DAYS + 1);
    $path = attachDocument($application, DriverDocumentType::VEHICLE_PHOTO)->file_path;

    $this->artisan('drivers:prune-abandoned-application-documents', ['--dry-run' => true])
        ->expectsOutputToContain('Would destroy')
        ->assertSuccessful();

    expect(DriverDocument::count())->toBe(1);
    Storage::assertExists($path);
});

it('is safe to run twice, because the second run has nothing to find', function () {
    $application = abandonedApplication(PruneAbandonedApplicationDocuments::RETENTION_DAYS + 1);
    attachDocument($application, DriverDocumentType::VEHICLE_INSURANCE);

    $this->artisan('drivers:prune-abandoned-application-documents')->assertSuccessful();
    $this->artisan('drivers:prune-abandoned-application-documents')
        ->expectsOutputToContain('No abandoned applications')
        ->assertSuccessful();

    expect(DriverDocument::count())->toBe(0);
});
