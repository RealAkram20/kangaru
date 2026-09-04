<?php

use App\Enums\UserRole;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Storage;
use Modules\Drivers\Enums\DriverDocumentStatus;
use Modules\Drivers\Enums\DriverDocumentType;
use Modules\Drivers\Models\DriverApplication;
use Modules\Drivers\Models\DriverDocument;
use Modules\Notifications\Notifications\ApplicationDocumentRejectedNotification;

/**
 * The office reading what an applicant sent (ADR-0048 §4).
 *
 * Until this existed, `DriverApplicationResource` returned a name, a phone
 * number and a status, and the queue offered Approve and Reject over it — so
 * the decision about whether somebody may drive was taken without their
 * licence being visible anywhere in the platform. The uploads were reaching
 * the server and nothing could read them back.
 *
 * The helpers are local and uniquely named. Borrowing `submitApplicationForReview()`
 * from `DriverOnboardingDocumentTest` looked tidier and was wrong twice over:
 * PHP functions are global, so a second definition fatals when the whole suite
 * runs, and running *this file alone* never loads that one, so the name is
 * simply undefined. Both were found by running it rather than by reading it.
 */
beforeEach(function () {
    Storage::fake();
});

function submitApplicationForReview(array $overrides = []): array
{
    $response = test()->postJson('/api/v1/driver-applications', array_merge([
        'name' => 'Grace Namutebi',
        'phone' => '+256 772 987 654',
        'email' => 'grace.applies@kangaruride.test',
        'password' => 'a-password-i-chose',
        'password_confirmation' => 'a-password-i-chose',
        'terms_accepted' => true,
    ], $overrides))->assertStatus(202);

    return [
        DriverApplication::query()->latest('id')->firstOrFail(),
        $response->json('data.upload_token'),
    ];
}

function reviewingOfficer(): User
{
    return User::factory()->create(['tenant_id' => null, 'role' => UserRole::SUPER_ADMIN]);
}

function uploadedAgainst(DriverApplication $application, string $token): DriverDocument
{
    test()->postJson('/api/v1/driver-applications/documents', [
        'upload_token' => $token,
        'type' => DriverDocumentType::IDENTITY_DOCUMENT->value,
        'file' => UploadedFile::fake()->image('national-id.jpg'),
    ])->assertStatus(201);

    return DriverDocument::query()
        ->where('driver_application_id', $application->getKey())
        ->latest('id')
        ->firstOrFail();
}

it('lists every slot for an application, held or not', function () {
    [$application, $token] = submitApplicationForReview();
    uploadedAgainst($application, $token);

    $response = $this->actingAs(reviewingOfficer())
        ->getJson("/api/v1/driver-applications/{$application->getKey()}/documents")
        ->assertOk();

    $rows = $response->json('data');

    // The empty slots are as much of the answer as the full one: a reviewer
    // asking "can I decide this yet" is asking what is missing.
    expect(count($rows))->toBeGreaterThan(1);

    $identity = collect($rows)->firstWhere('type', DriverDocumentType::IDENTITY_DOCUMENT->value);

    expect($identity)->not->toBeNull();
    expect($identity['document'])->not->toBeNull();
});

it('serves the file for a document on that application', function () {
    [$application, $token] = submitApplicationForReview();
    $document = uploadedAgainst($application, $token);

    $this->actingAs(reviewingOfficer())
        ->get("/api/v1/driver-applications/{$application->getKey()}/documents/{$document->getKey()}/file")
        ->assertOk();
});

/**
 * **The guard this file exists for.**
 *
 * A reviewer holds `drivers.manage` over every application, so the policy
 * says yes to *any* pair of ids. Without the ownership check in the
 * controller, a valid application id and any document id serves that
 * document — and this table holds national IDs and passports. A 404 rather
 * than a 403, so the answer does not confirm that the document id exists.
 */
it('refuses a document belonging to a different application', function () {
    [$mine, $myToken] = submitApplicationForReview();
    uploadedAgainst($mine, $myToken);

    [$theirs, $theirToken] = submitApplicationForReview([
        'email' => 'someone.else@kangaruride.test',
        'phone' => '+256 772 111 222',
    ]);
    $theirDocument = uploadedAgainst($theirs, $theirToken);

    $this->actingAs(reviewingOfficer())
        ->get("/api/v1/driver-applications/{$mine->getKey()}/documents/{$theirDocument->getKey()}/file")
        ->assertStatus(404);
});

it('refuses both routes to somebody who is not signed in', function () {
    [$application, $token] = submitApplicationForReview();
    $document = uploadedAgainst($application, $token);

    $this->getJson("/api/v1/driver-applications/{$application->getKey()}/documents")
        ->assertStatus(401);

    $this->getJson("/api/v1/driver-applications/{$application->getKey()}/documents/{$document->getKey()}/file")
        ->assertStatus(401);
});

/*
 * ADR-0057: accepting and refusing one document at a time.
 *
 * The two claims worth defending are that a refusal **does not close the
 * application** — that is the whole feature — and that approval cannot happen
 * over a document nobody accepted.
 */

it('accepts one document without touching the others', function () {
    [$application, $token] = submitApplicationForReview();
    $document = uploadedAgainst($application, $token);

    $this->actingAs(reviewingOfficer())
        ->postJson("/api/v1/driver-applications/{$application->getKey()}/documents/{$document->getKey()}/verify")
        ->assertOk();

    expect($document->refresh()->status)->toBe(DriverDocumentStatus::VERIFIED);
    expect($application->refresh()->status->isOpen())->toBeTrue();
});

it('refuses one document, keeps the application open, and emails a fresh ticket', function () {
    Notification::fake();

    [$application, $token] = submitApplicationForReview();
    $document = uploadedAgainst($application, $token);
    $before = $application->refresh()->upload_token_hash;

    $this->actingAs(reviewingOfficer())
        ->postJson(
            "/api/v1/driver-applications/{$application->getKey()}/documents/{$document->getKey()}/reject",
            ['reason' => 'The bottom of the licence is cut off.'],
        )
        ->assertOk();

    expect($document->refresh()->status)->toBe(DriverDocumentStatus::REJECTED);
    expect($document->rejection_reason)->toBe('The bottom of the licence is cut off.');

    // **The application survives.** Before ADR-0057 the only way to refuse a
    // document was to refuse the person, and this is the assertion that says
    // that is no longer true.
    expect($application->refresh()->status->isOpen())->toBeTrue();

    /*
        **No new ticket, because this applicant has an account.**

        Since ADR-0057 §5 the ordinary path mints a sign-in at submission, so
        the email says "sign in and send it again" and carries no credential
        at all. Reissuing a ticket here would put a live credential for
        somebody's identity documents into an inbox for no reason.
    */
    expect($application->refresh()->upload_token_hash)->toBe($before);

    Notification::assertSentOnDemand(ApplicationDocumentRejectedNotification::class);
});

/**
 * The other half, and the reason the ticket path is not dead code.
 *
 * ADR-0027 §5 requires the public endpoint to answer identically whether or
 * not the email is known, so an application on a **taken address** is stored
 * with no account. Those applicants — and everybody who applied before
 * accounts moved to submission — cannot sign in, so a refusal has to carry
 * the way back in or it is a dead end.
 */
it('emails a fresh ticket to an applicant who has no account', function () {
    Notification::fake();

    // Takes the address first, so the application below is minted no account.
    User::factory()->create(['email' => 'grace.applies@kangaruride.test']);

    [$application, $token] = submitApplicationForReview();
    $document = uploadedAgainst($application, $token);

    expect($application->refresh()->user_id)->toBeNull();

    $before = $application->upload_token_hash;

    $this->actingAs(reviewingOfficer())
        ->postJson(
            "/api/v1/driver-applications/{$application->getKey()}/documents/{$document->getKey()}/reject",
            ['reason' => 'The bottom of the licence is cut off.'],
        )
        ->assertOk();

    // A *new* ticket, and the old one is dead: three refusals must not leave
    // three live tickets able to reach the same documents.
    expect($application->refresh()->upload_token_hash)->not->toBe($before);

    Notification::assertSentOnDemand(ApplicationDocumentRejectedNotification::class);
});

it('will not approve while a document is unaccepted', function () {
    [$application, $token] = submitApplicationForReview();
    uploadedAgainst($application, $token);

    $this->actingAs(reviewingOfficer())
        ->postJson("/api/v1/driver-applications/{$application->getKey()}/approve", [
            'license_number' => 'UG-DL-2026-0001',
            'license_expiry' => '2029-06-30',
        ])
        ->assertStatus(409)
        ->assertJsonPath('code', 'DRIVER_APPLICATION_DOCUMENTS_PENDING');

    expect($application->refresh()->status->isOpen())->toBeTrue();
});

it('approves once every document sent has been accepted', function () {
    [$application, $token] = submitApplicationForReview();
    $document = uploadedAgainst($application, $token);

    $this->actingAs(reviewingOfficer())
        ->postJson("/api/v1/driver-applications/{$application->getKey()}/documents/{$document->getKey()}/verify")
        ->assertOk();

    $this->actingAs(reviewingOfficer())
        ->postJson("/api/v1/driver-applications/{$application->getKey()}/approve", [
            'license_number' => 'UG-DL-2026-0001',
            'license_expiry' => '2029-06-30',
        ])
        ->assertStatus(201);
});

/**
 * The asymmetry ADR-0057 §2 argues for.
 *
 * Every document is optional at submission (ADR-0048 §6) and the KYC screen
 * says "Nothing here is required". A rule that demanded all six would make
 * them mandatory through a back door and turn that sentence into a lie. What
 * blocks is a document the office has *looked at*, not one nobody sent.
 */
it('approves an application that sent no documents at all', function () {
    [$application] = submitApplicationForReview();

    $this->actingAs(reviewingOfficer())
        ->postJson("/api/v1/driver-applications/{$application->getKey()}/approve", [
            'license_number' => 'UG-DL-2026-0001',
            'license_expiry' => '2029-06-30',
        ])
        ->assertStatus(201);
});

it('refuses to review a document belonging to a different application', function () {
    [$mine, $myToken] = submitApplicationForReview();
    uploadedAgainst($mine, $myToken);

    [$theirs, $theirToken] = submitApplicationForReview([
        'email' => 'other.applicant@kangaruride.test',
        'phone' => '+256 772 333 444',
    ]);
    $theirDocument = uploadedAgainst($theirs, $theirToken);

    $this->actingAs(reviewingOfficer())
        ->postJson("/api/v1/driver-applications/{$mine->getKey()}/documents/{$theirDocument->getKey()}/verify")
        ->assertStatus(404);
});
