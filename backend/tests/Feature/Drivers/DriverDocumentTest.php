<?php

use App\Enums\UserRole;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Storage;
use Modules\Drivers\Enums\DriverDocumentStatus;
use Modules\Drivers\Enums\DriverDocumentType;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Models\DriverDocument;
use Modules\Drivers\Services\DriverDocumentService;

/**
 * Driver documents (ADR-0033) — the feature behind the Profile screen's
 * **Documents — Verified** row.
 *
 * That row is why this exists. Printing "Verified" against a compliance fact
 * the platform does not hold is not a cosmetic lie: a driver at a checkpoint,
 * or an operator answering a regulator, would both be relying on a word the
 * software made up. So the properties worth pinning are the ones that keep
 * "verified" meaning something:
 *
 * - **Nothing reaches `verified` without a person.** No path through the
 *   service or the API verifies a document by itself.
 * - **A replacement resets the review.** A document the office accepted is not
 *   evidence for a different file that arrived afterwards.
 * - **Expiry outranks verification.** A verified licence that lapsed last
 *   month reports `expired`, derived at read time and never stored.
 * - **A driver never reaches another driver's file**, and the file is never a
 *   storage URL.
 * - **Every type comes back, held or not** — the screen answers "what do I
 *   still owe you", which the uploaded subset cannot.
 */
function documentDriver(): array
{
    $user = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);
    $driver = Driver::factory()->create(['user_id' => $user->id]);

    return [$user, $driver];
}

/** Somebody at the office holding `drivers.manage`. */
function documentStaff(): User
{
    return User::factory()->create(['tenant_id' => null, 'role' => UserRole::SUPER_ADMIN]);
}

/**
 * A small PDF rather than `UploadedFile::fake()->image()`, which needs the GD
 * extension — absent on plenty of machines, and a suite that fails for a
 * reason unrelated to what it tests is a suite people stop trusting.
 */
function documentFile(string $name = 'licence.pdf'): UploadedFile
{
    return UploadedFile::fake()->create($name, 24, 'application/pdf');
}

beforeEach(function (): void {
    Storage::fake();
});

// -- Uploading ------------------------------------------------------------

it('files a document and leaves it waiting for the office', function (): void {
    [$user, $driver] = documentDriver();

    $response = $this->actingAs($user)->postJson('/api/v1/me/documents', [
        'type' => DriverDocumentType::DRIVING_LICENCE->value,
        'file' => documentFile(),
        'expires_at' => Carbon::now()->addYear()->toDateString(),
    ]);

    $response->assertCreated();
    // **Never verified on arrival.** The whole feature turns on this.
    $response->assertJsonPath('data.status', DriverDocumentStatus::PENDING->value);
    $response->assertJsonPath('data.compliance_state', 'pending');

    $document = DriverDocument::query()->firstOrFail();

    expect($document->driver_id)->toBe($driver->getKey())
        ->and($document->reviewed_by_user_id)->toBeNull();

    Storage::assertExists($document->file_path);
});

it('never puts the file path in a payload', function (): void {
    [$user] = documentDriver();

    $response = $this->actingAs($user)->postJson('/api/v1/me/documents', [
        'type' => DriverDocumentType::IDENTITY_DOCUMENT->value,
        'file' => documentFile('id.pdf'),
    ]);

    // The path addresses a private disk holding somebody's identity document.
    // It is hidden on the model as well as absent from the resource, because
    // one guard on that is not enough.
    $response->assertCreated()->assertJsonMissingPath('data.file_path');
    expect(DriverDocument::query()->firstOrFail()->toArray())->not->toHaveKey('file_path');
});

it('demands an expiry for the documents whose whole meaning is a date', function (): void {
    [$user] = documentDriver();

    $this->actingAs($user)
        ->postJson('/api/v1/me/documents', [
            'type' => DriverDocumentType::DRIVING_LICENCE->value,
            'file' => documentFile(),
        ])
        ->assertStatus(422)
        ->assertJsonValidationErrors('expires_at');

    // …and does not demand one where the document may not carry a date at all.
    $this->actingAs($user)
        ->postJson('/api/v1/me/documents', [
            'type' => DriverDocumentType::IDENTITY_DOCUMENT->value,
            'file' => documentFile('id.pdf'),
        ])
        ->assertCreated();
});

it('accepts a document that expires today, because today it is still valid', function (): void {
    [$user] = documentDriver();

    $this->actingAs($user)
        ->postJson('/api/v1/me/documents', [
            'type' => DriverDocumentType::DRIVING_LICENCE->value,
            'file' => documentFile(),
            /*
                **`Africa/Kampala`, not `now()`, and the difference is a whole
                day.** `config('app.timezone')` is UTC while `hasExpired()`
                compares against `Carbon::now($operatorTimezone)` — the fleet's,
                per ADR-0033 §3. Between 21:00 and 24:00 UTC those name
                different dates, so a bare `Carbon::now()` here builds
                *yesterday* in Kampala terms and the assertion below correctly
                reports it expired. This test failed for exactly that window,
                and it was read as a driver-facing bug rather than as its own
                defect. The subject under test is a date in the operator's
                timezone; the test has to say so, the same way
                `DriverEarningsTest` pins its times.
            */
            'expires_at' => Carbon::now('Africa/Kampala')->toDateString(),
        ])
        ->assertCreated()
        // Not expired: the last day of a licence is a day the driver can work.
        ->assertJsonPath('data.expired', false);
});

it('refuses a file that is not a photo or a PDF', function (): void {
    [$user] = documentDriver();

    $this->actingAs($user)
        ->postJson('/api/v1/me/documents', [
            'type' => DriverDocumentType::IDENTITY_DOCUMENT->value,
            // An upload from an unprivileged client straight onto the
            // operator's disk. "Anything the driver picked" is how a storage
            // bucket becomes a file host.
            'file' => UploadedFile::fake()->create('payload.exe', 12, 'application/x-msdownload'),
        ])
        ->assertStatus(422)
        ->assertJsonValidationErrors('file');
});

// -- Replacing ------------------------------------------------------------

it('resets the review when a verified document is replaced', function (): void {
    [$user, $driver] = documentDriver();
    $staff = documentStaff();
    $service = app(DriverDocumentService::class);

    $document = $service->upload(
        $driver,
        DriverDocumentType::IDENTITY_DOCUMENT,
        documentFile('id.pdf'),
        null,
    );
    $service->verify($document, $staff);

    $firstPath = $document->refresh()->file_path;

    $this->actingAs($user)
        ->postJson('/api/v1/me/documents', [
            'type' => DriverDocumentType::IDENTITY_DOCUMENT->value,
            'file' => documentFile('id-again.pdf'),
        ])
        ->assertCreated()
        // A document the office verified is not evidence for a different file
        // that arrived afterwards.
        ->assertJsonPath('data.status', DriverDocumentStatus::PENDING->value);

    $document->refresh();

    expect($document->reviewed_by_user_id)->toBeNull()
        ->and($document->reviewed_at)->toBeNull()
        ->and($document->file_path)->not->toBe($firstPath)
        // One row per type, not a second one.
        ->and(DriverDocument::query()->count())->toBe(1);

    Storage::assertExists($document->file_path);
    // The superseded file goes, so the disk does not accumulate versions
    // nobody accepted.
    Storage::assertMissing($firstPath);
});

// -- Reviewing ------------------------------------------------------------

it('lets the office verify a document, and records who did', function (): void {
    [, $driver] = documentDriver();
    $staff = documentStaff();

    $document = app(DriverDocumentService::class)->upload(
        $driver,
        DriverDocumentType::IDENTITY_DOCUMENT,
        documentFile('id.pdf'),
        null,
    );

    $this->actingAs($staff)
        ->postJson("/api/v1/drivers/{$driver->getKey()}/documents/{$document->getKey()}/verify")
        ->assertOk()
        ->assertJsonPath('data.status', DriverDocumentStatus::VERIFIED->value);

    expect($document->refresh()->reviewed_by_user_id)->toBe($staff->getKey());
});

it('never rejects a document without a reason', function (): void {
    [, $driver] = documentDriver();
    $staff = documentStaff();

    $document = app(DriverDocumentService::class)->upload(
        $driver,
        DriverDocumentType::IDENTITY_DOCUMENT,
        documentFile('id.pdf'),
        null,
    );

    // A refusal with no reason is how a driver stops using a feature: told no,
    // unable to tell whether the photo was blurred or the document wrong, and
    // re-uploading the same file.
    $this->actingAs($staff)
        ->postJson("/api/v1/drivers/{$driver->getKey()}/documents/{$document->getKey()}/reject", [])
        ->assertStatus(422)
        ->assertJsonValidationErrors('reason');

    $this->actingAs($staff)
        ->postJson("/api/v1/drivers/{$driver->getKey()}/documents/{$document->getKey()}/reject", [
            'reason' => 'Too dark to read.',
        ])
        ->assertOk()
        ->assertJsonPath('data.rejection_reason', 'Too dark to read.');
});

it('never lets a driver verify their own document', function (): void {
    [$user, $driver] = documentDriver();

    $document = app(DriverDocumentService::class)->upload(
        $driver,
        DriverDocumentType::IDENTITY_DOCUMENT,
        documentFile('id.pdf'),
        null,
    );

    // The feature inverting itself. `DriverDocumentPolicy::view()` grants an
    // owner the *file*, which makes this worth asserting rather than assuming.
    $this->actingAs($user)
        ->postJson("/api/v1/drivers/{$driver->getKey()}/documents/{$document->getKey()}/verify")
        ->assertForbidden();

    expect($document->refresh()->status)->toBe(DriverDocumentStatus::PENDING);
});

it('answers 404 when the document does not belong to the driver in the path', function (): void {
    [, $mine] = documentDriver();
    [, $theirs] = documentDriver();
    $staff = documentStaff();

    $document = app(DriverDocumentService::class)->upload(
        $theirs,
        DriverDocumentType::IDENTITY_DOCUMENT,
        documentFile('id.pdf'),
        null,
    );

    // The reviewer holds `drivers.manage` over every driver, so the policy
    // alone would allow a mismatched pair to address somebody else's licence.
    $this->actingAs($staff)
        ->postJson("/api/v1/drivers/{$mine->getKey()}/documents/{$document->getKey()}/verify")
        ->assertNotFound();
});

// -- Expiry ---------------------------------------------------------------

it('reports a lapsed but verified document as expired', function (): void {
    [$user, $driver] = documentDriver();
    $staff = documentStaff();
    $service = app(DriverDocumentService::class);

    $document = $service->upload(
        $driver,
        DriverDocumentType::DRIVING_LICENCE,
        documentFile(),
        Carbon::now()->addDay()->toDateString(),
    );
    $service->verify($document, $staff);

    // Move past the expiry rather than back-dating the row, so the derivation
    // is exercised the way time actually reaches it.
    Carbon::setTestNow(Carbon::now()->addDays(3));

    $response = $this->actingAs($user)->getJson('/api/v1/me/documents');

    $licence = collect($response->json('data'))
        ->firstWhere('type', DriverDocumentType::DRIVING_LICENCE->value);

    // The stored status is untouched — nothing wrote to the row — and the
    // derived state overrides it. A licence that lapsed last month is not a
    // verified licence.
    expect($licence['document']['status'])->toBe(DriverDocumentStatus::VERIFIED->value)
        ->and($licence['document']['compliance_state'])->toBe('expired')
        ->and($licence['document']['expired'])->toBeTrue();

    $response->assertJsonPath('meta.compliance.state', 'action_needed');

    Carbon::setTestNow();
});

// -- The list, and the file -----------------------------------------------

it('returns every document type, held or not', function (): void {
    [$user, $driver] = documentDriver();

    app(DriverDocumentService::class)->upload(
        $driver,
        DriverDocumentType::IDENTITY_DOCUMENT,
        documentFile('id.pdf'),
        null,
    );

    $response = $this->actingAs($user)->getJson('/api/v1/me/documents')->assertOk();

    // A driver opening this screen is asking what they still owe the office.
    // Only the full set answers that; the uploaded subset answers a different
    // question.
    expect($response->json('data'))->toHaveCount(count(DriverDocumentType::cases()));

    $missing = collect($response->json('data'))
        ->firstWhere('type', DriverDocumentType::VEHICLE_INSURANCE->value);

    expect($missing['document'])->toBeNull();

    // Nothing uploaded is not the same as something wrong.
    $response->assertJsonPath('meta.compliance.state', 'incomplete');
});

it('streams a driver their own file and refuses another driver theirs', function (): void {
    [$mineUser, $mine] = documentDriver();
    [$theirsUser, $theirs] = documentDriver();

    $document = app(DriverDocumentService::class)->upload(
        $mine,
        DriverDocumentType::IDENTITY_DOCUMENT,
        documentFile('id.pdf'),
        null,
    );

    $this->actingAs($mineUser)
        ->get("/api/v1/me/documents/{$document->getKey()}/file")
        ->assertOk();

    // Not a 404 by luck of an unguessable id — the policy refuses it.
    $this->actingAs($theirsUser)
        ->get("/api/v1/me/documents/{$document->getKey()}/file")
        ->assertForbidden();

    expect($theirs->getKey())->not->toBe($mine->getKey());
});

it('scopes the driver app token to its own document routes only', function (): void {
    [$user, $driver] = documentDriver();

    $document = app(DriverDocumentService::class)->upload(
        $driver,
        DriverDocumentType::IDENTITY_DOCUMENT,
        documentFile('id.pdf'),
        null,
    );

    // ADR-0022 fails closed, and every other test here signs in without a
    // client — which mints an *unscoped* console token. So a route missing
    // from `ClientScope` passes its own suite while being unreachable from the
    // only app that has a screen for it. That happened to four endpoints on
    // this branch already.
    $token = $user->createToken('driver-app', ['driver'])->plainTextToken;

    $this->withToken($token)->getJson('/api/v1/me/documents')->assertOk();
    $this->withToken($token)->getJson('/api/v1/me/profile')->assertOk();
    $this->withToken($token)
        ->get("/api/v1/me/documents/{$document->getKey()}/file")
        ->assertOk();

    // And never the office's half: a driver who could verify their own licence
    // is the whole feature inverting itself.
    $this->withToken($token)
        ->postJson("/api/v1/drivers/{$driver->getKey()}/documents/{$document->getKey()}/verify")
        ->assertForbidden();
});
