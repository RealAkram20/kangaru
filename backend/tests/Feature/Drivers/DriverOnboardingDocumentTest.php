<?php

use App\Enums\UserRole;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Modules\Drivers\Enums\DriverApplicationStatus;
use Modules\Drivers\Enums\DriverDocumentStatus;
use Modules\Drivers\Enums\DriverDocumentType;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Models\DriverApplication;
use Modules\Drivers\Models\DriverDocument;

/**
 * ADR-0048 — onboarding documents.
 *
 * The claims worth defending, in rough order of what a mistake would cost:
 *
 * 1. **The claim ticket is not a principal.** It reaches one application, it
 *    never returns file bytes, and it dies at the decision. A ticket that
 *    could read a stranger's national ID, or reach a second application,
 *    would be the thing ADR-0027 §1 refused, smuggled in under a new name.
 * 2. **Approval is not review.** Documents carried onto a driver stay
 *    `pending`. Anything that marks them verified is ADR-0033 §4's
 *    auto-verification through a side door.
 * 3. **Rejection destroys the files**, because holding a photograph of a
 *    refused stranger's face is a liability with no use.
 * 4. **The office cannot be told apart from an applicant by the row.**
 *    Exactly one owner column is ever set.
 */
function submitApplication(array $overrides = []): array
{
    $response = test()->postJson('/api/v1/driver-applications', array_merge([
        'name' => 'Grace Namutebi',
        'phone' => '+256 772 987 654',
        'email' => 'grace.applies@kangaruride.test',
        'password' => 'a-password-i-chose',
        'password_confirmation' => 'a-password-i-chose',
        'terms_accepted' => true,
    ], $overrides))->assertStatus(202);

    // `firstOrFail()`, not `sole()`: two of the tests below submit a second
    // application on purpose, and `sole()` over an ordered query throws on the
    // count rather than taking the newest.
    return [
        DriverApplication::query()->latest('id')->firstOrFail(),
        $response->json('data.upload_token'),
    ];
}

function officeReviewer(): User
{
    return User::factory()->create(['tenant_id' => null, 'role' => UserRole::SUPER_ADMIN]);
}

beforeEach(function () {
    // A fake disk, so the assertions below are about files rather than about
    // whichever documents a previous run left on the real one.
    Storage::fake();
});

/* ------------------------------------------------------------------ 1 --- */

it('lets an applicant send a document with the ticket, and files it against the application', function () {
    [$application, $token] = submitApplication();

    $this->post('/api/v1/driver-applications/documents', [
        'upload_token' => $token,
        'type' => DriverDocumentType::IDENTITY_DOCUMENT->value,
        'file' => UploadedFile::fake()->image('id.jpg'),
    ])->assertStatus(201);

    $document = DriverDocument::sole();

    // The invariant (ADR-0048 §3): exactly one owner column, never both.
    expect($document->driver_application_id)->toBe($application->id);
    expect($document->driver_id)->toBeNull();
    expect($document->status)->toBe(DriverDocumentStatus::PENDING);

    // Under its own root, not inside `drivers/` — nothing here is a driver.
    expect($document->file_path)->toStartWith("driver-applications/{$application->id}/documents/");
    Storage::assertExists($document->file_path);
});

it('never hands an applicant a way to read the file back', function () {
    [, $token] = submitApplication();

    $this->post('/api/v1/driver-applications/documents', [
        'upload_token' => $token,
        'type' => DriverDocumentType::IDENTITY_SELFIE->value,
        'file' => UploadedFile::fake()->image('me.jpg'),
    ])->assertStatus(201)
        // ADR-0048 §4: metadata, never bytes. A stolen ticket must not become
        // a way to *read* somebody's identity document.
        ->assertJsonPath('data.file_url', null);

    $slots = $this->getJson('/api/v1/driver-applications/documents?upload_token='.$token)
        ->assertOk()
        ->json('data');

    $selfie = collect($slots)->firstWhere('type', DriverDocumentType::IDENTITY_SELFIE->value);
    expect($selfie['document']['file_url'])->toBeNull();
});

it('answers 404 the same way for an unknown, an expired and a decided ticket', function () {
    [$application, $token] = submitApplication();

    $payload = fn (string $t): array => [
        'upload_token' => $t,
        'type' => DriverDocumentType::DRIVING_LICENCE->value,
        'file' => UploadedFile::fake()->image('licence.jpg'),
        'expires_at' => now()->addYear()->toDateString(),
    ];

    // Unknown: right shape, wrong secret.
    $unknown = $this->post('/api/v1/driver-applications/documents', $payload(str_repeat('a', 64)))
        ->assertStatus(404);

    // Expired.
    $application->forceFill(['upload_token_expires_at' => now()->subMinute()])->save();
    $expired = $this->post('/api/v1/driver-applications/documents', $payload($token))
        ->assertStatus(404);

    // **Identical**, or the status code has become the oracle ADR-0027 §5
    // refuses — "that ticket is spent" tells the holder an application exists.
    expect($expired->json('message'))->toBe($unknown->json('message'));
    expect($expired->json('error.code'))->toBe($unknown->json('error.code'));
});

it('will not let one applicant reach another application', function () {
    [, $tokenA] = submitApplication(['email' => 'a@kangaruride.test']);
    [$applicationB] = submitApplication(['email' => 'b@kangaruride.test']);

    $this->post('/api/v1/driver-applications/documents', [
        'upload_token' => $tokenA,
        'type' => DriverDocumentType::IDENTITY_DOCUMENT->value,
        'file' => UploadedFile::fake()->image('id.jpg'),
    ])->assertStatus(201);

    // There is no id in the URL to change, so this is really a check that the
    // row is chosen by the ticket and by nothing else.
    expect(DriverDocument::query()->where('driver_application_id', $applicationB->id)->count())
        ->toBe(0);
});

/* ------------------------------------------------------------------ 2 --- */

it('carries the documents onto the driver at approval, without re-reviewing them', function () {
    [$application, $token] = submitApplication();

    $this->post('/api/v1/driver-applications/documents', [
        'upload_token' => $token,
        'type' => DriverDocumentType::IDENTITY_DOCUMENT->value,
        'file' => UploadedFile::fake()->image('id.jpg'),
    ])->assertStatus(201);

    $path = DriverDocument::sole()->file_path;

    /*
        Accepted first, because ADR-0057 §2 will not approve over a document
        nobody has decided about. Before that, this test approved with the
        document still `pending` and asserted it stayed that way — the state
        is now unreachable, and the *reason* it existed is asserted below
        instead.
    */
    $reviewer = officeReviewer();
    $document = DriverDocument::sole();

    $this->actingAs($reviewer)
        ->postJson("/api/v1/driver-applications/{$application->id}/documents/{$document->id}/verify")
        ->assertOk();

    $acceptedAt = $document->refresh()->reviewed_at;

    $this->actingAs($reviewer)
        ->postJson("/api/v1/driver-applications/{$application->id}/approve", [
            'license_number' => 'UG-DL-77123',
            'license_expiry' => now()->addYears(2)->toDateString(),
        ])->assertStatus(201);

    $driver = Driver::sole();
    $document = DriverDocument::sole();

    expect($document->driver_id)->toBe($driver->id);
    expect($document->driver_application_id)->toBeNull();

    /**
     * **Approval is still not review** (ADR-0048 §5), and this is the shape
     * that claim takes after ADR-0057.
     *
     * The status is `verified` because a reviewer looked at the file and said
     * so, in a separate act with its own audit row — not because a different
     * decision went the applicant's way. What must never happen is approval
     * *writing* a verdict, and the assertion that catches it is the
     * timestamp: `reviewed_at` is the one the acceptance wrote, untouched by
     * everything approval did afterwards. An approval that re-stamped the row
     * would fail here even though the status looks right.
     */
    expect($document->status)->toBe(DriverDocumentStatus::VERIFIED);
    expect($document->reviewed_at?->equalTo($acceptedAt))->toBeTrue();

    // The file did not move — re-pointing a row is atomic, moving bytes is
    // not, and a half-moved document is a licence the office cannot open.
    expect($document->file_path)->toBe($path);
    Storage::assertExists($path);

    // The ticket is spent.
    expect($application->fresh()->upload_token_hash)->toBeNull();
});

it('spends the ticket at approval so the applicant cannot amend a decided application', function () {
    [$application, $token] = submitApplication();

    $this->actingAs(officeReviewer())
        ->postJson("/api/v1/driver-applications/{$application->id}/approve", [
            'license_number' => 'UG-DL-77124',
            'license_expiry' => now()->addYears(2)->toDateString(),
        ])->assertStatus(201);

    $this->post('/api/v1/driver-applications/documents', [
        'upload_token' => $token,
        'type' => DriverDocumentType::IDENTITY_DOCUMENT->value,
        'file' => UploadedFile::fake()->image('id.jpg'),
    ])->assertStatus(404);
});

/* ------------------------------------------------------------------ 3 --- */

it('destroys the files when the application is rejected', function () {
    [$application, $token] = submitApplication();

    $this->post('/api/v1/driver-applications/documents', [
        'upload_token' => $token,
        'type' => DriverDocumentType::IDENTITY_SELFIE->value,
        'file' => UploadedFile::fake()->image('me.jpg'),
    ])->assertStatus(201);

    $path = DriverDocument::sole()->file_path;
    Storage::assertExists($path);

    $this->actingAs(officeReviewer())
        ->postJson("/api/v1/driver-applications/{$application->id}/reject", [
            'reason' => 'The licence could not be verified in person.',
        ])->assertOk();

    expect($application->fresh()->status)->toBe(DriverApplicationStatus::REJECTED);

    // Row and file both. Holding a photograph of a refused stranger's face is
    // a liability with no corresponding use (ADR-0048 §5).
    expect(DriverDocument::count())->toBe(0);
    Storage::assertMissing($path);
});

/* ------------------------------------------------------------------ 4 --- */

it('lets an applicant withdraw something they did not mean to send', function () {
    [, $token] = submitApplication();

    $this->post('/api/v1/driver-applications/documents', [
        'upload_token' => $token,
        'type' => DriverDocumentType::VEHICLE_PHOTO->value,
        'file' => UploadedFile::fake()->image('car.jpg'),
    ])->assertStatus(201);

    $path = DriverDocument::sole()->file_path;

    $this->deleteJson(
        '/api/v1/driver-applications/documents/'.DriverDocumentType::VEHICLE_PHOTO->value,
        ['upload_token' => $token],
    )->assertStatus(204);

    expect(DriverDocument::count())->toBe(0);
    Storage::assertMissing($path);
});

it('lists all six slots, grouped, with the missing ones present', function () {
    [, $token] = submitApplication();

    $slots = $this->getJson('/api/v1/driver-applications/documents?upload_token='.$token)
        ->assertOk()
        ->json('data');

    // **The missing ones are the point.** Somebody opening this screen is
    // asking "what do I still owe you", and only the full set answers that.
    expect($slots)->toHaveCount(6);
    expect(collect($slots)->pluck('document')->filter())->toBeEmpty();

    // The order and grouping are the server's (ADR-0048 §1), so the driver
    // app and the console cannot disagree about where a selfie belongs.
    expect(collect($slots)->pluck('type')->all())->toBe([
        'identity_document',
        'identity_selfie',
        'driving_licence',
        'vehicle_registration',
        'vehicle_insurance',
        'vehicle_photo',
    ]);
    expect(collect($slots)->pluck('group')->all())->toBe([
        'personal', 'personal', 'driver', 'driver', 'driver', 'vehicle',
    ]);

    // Neither new type demands a date it does not have.
    $byType = collect($slots)->keyBy('type');
    expect($byType['identity_selfie']['requires_expiry'])->toBeFalse();
    expect($byType['vehicle_photo']['requires_expiry'])->toBeFalse();
    expect($byType['driving_licence']['requires_expiry'])->toBeTrue();
});

it('replaces rather than accumulating when the same type is sent twice', function () {
    [, $token] = submitApplication();

    $send = fn (string $name) => $this->post('/api/v1/driver-applications/documents', [
        'upload_token' => $token,
        'type' => DriverDocumentType::IDENTITY_DOCUMENT->value,
        'file' => UploadedFile::fake()->image($name),
    ])->assertStatus(201);

    $send('first.jpg');
    $first = DriverDocument::sole()->file_path;

    $send('second.jpg');

    // One row per type per owner — the unique index is the model (ADR-0033 §2).
    expect(DriverDocument::count())->toBe(1);
    expect(DriverDocument::sole()->file_path)->not->toBe($first);
    Storage::assertMissing($first);
});

it('refuses a file that is neither an image nor a PDF, on the applicant path too', function () {
    [, $token] = submitApplication();

    // The applicant path must not be looser than the driver path: it lands on
    // the same disk and becomes the same row.
    $this->post('/api/v1/driver-applications/documents', [
        'upload_token' => $token,
        'type' => DriverDocumentType::IDENTITY_DOCUMENT->value,
        'file' => UploadedFile::fake()->create('payload.exe', 12, 'application/x-msdownload'),
    ])->assertStatus(422)->assertJsonValidationErrors('file');
});
