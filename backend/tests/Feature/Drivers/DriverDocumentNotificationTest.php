<?php

use App\Enums\UserRole;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Storage;
use Modules\Drivers\Enums\DriverDocumentStatus;
use Modules\Drivers\Enums\DriverDocumentType;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Models\DriverDocument;
use Modules\Drivers\Services\DriverDocumentService;
use Modules\Notifications\Enums\NotificationChannel;
use Modules\Notifications\Mail\MailRenderer;
use Modules\Notifications\Notifications\DriverDocumentReviewedNotification;

/**
 * Telling a driver what the office decided (ADR-0052), and keeping their
 * papers unreadable on the disk they sit on (ADR-0053).
 *
 * Two features in one file because they were built together and they guard the
 * same screen: the KYC screen tells an applicant their documents are encrypted
 * and that they will hear back. Both halves of that sentence now have to be
 * true, and these are the tests that make them so.
 *
 * The properties worth pinning:
 *
 * - **Both outcomes notify.** A rejection is the one that costs a driver work.
 * - **The rejection reason reaches the email and nothing else.** Not the push
 *   body, not the in-app row, not the push `data` payload — a lock screen is
 *   read over a shoulder.
 * - **Nobody to tell is not an error.** A driver with no account, or one whose
 *   account was closed, must not turn a recorded decision into a 500.
 * - **The bytes on disk are not the document.** Anyone reading the filesystem
 *   directly gets ciphertext, and the endpoint still returns the original.
 * - **The office may file a document, and filing is not verifying.**
 */
function reviewDriver(): array
{
    $user = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);
    $driver = Driver::factory()->create(['user_id' => $user->id]);

    return [$user, $driver];
}

function reviewStaff(): User
{
    return User::factory()->create(['tenant_id' => null, 'role' => UserRole::SUPER_ADMIN]);
}

function reviewFile(string $name = 'licence.pdf'): UploadedFile
{
    return UploadedFile::fake()->create($name, 24, 'application/pdf');
}

/** Files a document for `$driver` through the real upload path. */
function fileDocument(Driver $driver, DriverDocumentType $type = DriverDocumentType::IDENTITY_DOCUMENT): DriverDocument
{
    return app(DriverDocumentService::class)->upload(
        $driver,
        $type,
        reviewFile('id.pdf'),
        null,
    );
}

beforeEach(function (): void {
    Storage::fake();
});

it('tells the driver when the office verifies a document', function (): void {
    Notification::fake();

    [$user, $driver] = reviewDriver();
    $document = fileDocument($driver);

    $this->actingAs(reviewStaff())
        ->postJson("/api/v1/drivers/{$driver->id}/documents/{$document->id}/verify")
        ->assertOk();

    Notification::assertSentTo(
        $user,
        DriverDocumentReviewedNotification::class,
        function (DriverDocumentReviewedNotification $notification) use ($user): bool {
            // All three channels, which no other type on this platform takes.
            // The row is the record, the push is what makes it same-day, and
            // mail is the only one that survives an uninstalled app.
            $channels = $notification->via($user);

            expect($channels)->toContain(NotificationChannel::MAIL->driver());
            expect($channels)->toContain(NotificationChannel::PUSH->driver());
            expect($channels)->toContain(NotificationChannel::DATABASE->driver());

            // Names the document, so a driver holding six of them does not
            // have to open the app to find out which was accepted.
            expect($notification->subject())->toContain('Identity document');

            return true;
        },
    );
});

it('tells the driver when the office rejects one, and says so in the subject', function (): void {
    Notification::fake();

    [$user, $driver] = reviewDriver();
    $document = fileDocument($driver);

    $this->actingAs(reviewStaff())
        ->postJson("/api/v1/drivers/{$driver->id}/documents/{$document->id}/reject", [
            'reason' => 'The photograph is too dark to read the number.',
        ])
        ->assertOk();

    Notification::assertSentTo(
        $user,
        DriverDocumentReviewedNotification::class,
        fn (DriverDocumentReviewedNotification $notification): bool => str_contains(
            $notification->subject(),
            'needs attention',
        ),
    );
});

/**
 * The privacy property, and the reason `pushOptions()` could not be used to
 * get it.
 *
 * `ExpoPushChannel` composes `$shown + … + $options` and PHP's `+` keeps the
 * left operand's keys, so a `body` supplied through `pushOptions()` is
 * silently discarded — it *looks* applied and is not. The safe design is a
 * `body()` that is already safe on every channel, and this is the test that
 * holds it there.
 */
it('keeps the rejection reason out of the push body, the in-app row and the push data', function (): void {
    [$user, $driver] = reviewDriver();
    $document = fileDocument($driver);

    $reason = 'The photograph is too dark to read the number.';

    app(DriverDocumentService::class)
        ->reject($document, reviewStaff(), $reason);

    $notification = DriverDocumentReviewedNotification::for($document->fresh());

    // `body()` is rendered verbatim by both the push channel and the in-app
    // row, so it is written for the least private of the two.
    expect($notification->body())->not->toContain('too dark');

    // `context()` becomes the push `data` payload, which crosses Expo's
    // servers. The app reads the reason from `/me/documents` instead, behind
    // the driver's own token.
    expect(json_encode($notification->context()))->not->toContain('too dark');

    // The email is the one channel allowed to carry it, and it must —
    // "Rejected" with nothing after it is how somebody stops using a feature.
    //
    // Rendered through MailRenderer rather than Laravel's MailMessage: the
    // mail channel now builds from the SMTP settings the owner saved, because
    // the framework's default mailer here was `log` and every one of these
    // emails went to a file. Same property under test, new renderer.
    $mail = app(MailRenderer::class)->render($notification->mailContent(), 'reason')['html'];

    expect($mail)->toContain('too dark');
});

/**
 * The email is branded and short (ADR-0052 §4).
 *
 * Pinned because both halves are invisible until somebody opens an inbox, and
 * both regress silently: a theme name typo falls back to Laravel's default
 * stylesheet without erroring, and the trimmed notification template is
 * shadowed the moment somebody publishes the vendor views again.
 */
it('sends a branded email with none of the framework filler', function (): void {
    [$user, $driver] = reviewDriver();

    $document = app(DriverDocumentService::class)
        ->verify(fileDocument($driver), reviewStaff());

    $rendered = app(MailRenderer::class)->render(
        DriverDocumentReviewedNotification::for($document)->mailContent(),
        'reason',
    );

    $html = $rendered['html'];

    // Colours only the KangaruRide layout produces. Laravel's stock theme
    // uses #18181b and #a1a1aa here, so these assert that our shell rendered
    // at all rather than the framework's silently taking over.
    //
    // #1a2233 is DESIGN.md §3's "Text on light surfaces, primary". This
    // assertion is why the shell has it: the first version used #293348,
    // which that same table assigns to borders and disabled elements on navy,
    // and nothing but this test would have noticed.
    $lower = strtolower($html);

    expect($lower)->toContain('#001028');   // brand navy, the header
    expect($lower)->toContain('#1a2233');   // textBody, the sentences
    expect($lower)->toContain('#5b6472');   // gray-text, the footer
    expect($lower)->not->toContain('#18181b');
    expect($lower)->not->toContain('#a1a1aa');

    // The four things the trimmed template drops. Each was a line the reader
    // had to scroll past to reach the sentence they were sent.
    expect($html)->not->toContain('Hello!');
    expect($html)->not->toContain('Regards');
    expect($html)->not->toContain('Whoops');

    // The plain text half carries the same words. Spam filters score a
    // multipart message with an auto-generated text part lower than one
    // written on purpose, and a driver upcountry on a text-only mail app is a
    // real population here rather than a hypothetical one.
    expect($rendered['text'])->toContain('verified');
    expect($html)->not->toContain('All rights reserved');

    // And the message itself survived the trimming.
    expect($html)->toContain('The office has accepted it.');
});

it('records the decision even when there is nobody to tell', function (): void {
    Notification::fake();

    // ADR-0016 makes the sign-in optional, and ADR-0043 §5 detaches it when an
    // account is closed while keeping the driver row. Both leave a driver with
    // documents and no `user_id`, and neither may turn a recorded review into
    // a 500.
    $driver = Driver::factory()->create(['user_id' => null]);
    $document = fileDocument($driver);

    $this->actingAs(reviewStaff())
        ->postJson("/api/v1/drivers/{$driver->id}/documents/{$document->id}/verify")
        ->assertOk();

    expect($document->fresh()->status)->toBe(DriverDocumentStatus::VERIFIED);

    Notification::assertNothingSent();
});

it('writes ciphertext to disk and still serves the original bytes', function (): void {
    [$user, $driver] = reviewDriver();

    $document = app(DriverDocumentService::class)->upload(
        $driver,
        DriverDocumentType::IDENTITY_DOCUMENT,
        UploadedFile::fake()->createWithContent('id.pdf', 'NATIONAL-ID-BYTES'),
        null,
    );

    $onDisk = Storage::get($document->file_path);

    // The whole point. Anyone with filesystem access — a backup tape, a
    // misconfigured rsync, a support engineer on the box — reads this and
    // learns nothing.
    expect($onDisk)->not->toContain('NATIONAL-ID-BYTES');
    expect($document->encrypted)->toBeTrue();
    expect(Crypt::decryptString($onDisk))->toBe('NATIONAL-ID-BYTES');

    // And the driver still gets their document back, unchanged.
    $response = $this->actingAs($user)->get("/api/v1/me/documents/{$document->id}/file");

    $response->assertOk();
    expect($response->streamedContent())->toBe('NATIONAL-ID-BYTES');
});

/**
 * The compatibility half of ADR-0053, and the reason `encrypted` is a stored
 * column rather than a switch.
 */
it('still serves a document written before encryption existed', function (): void {
    [$user, $driver] = reviewDriver();
    $document = fileDocument($driver);

    // Exactly what a pre-migration row looks like: plaintext on disk, and a
    // flag saying so.
    Storage::put($document->file_path, 'OLD-PLAINTEXT');
    $document->update(['encrypted' => false]);

    $response = $this->actingAs($user)->get("/api/v1/me/documents/{$document->id}/file");

    $response->assertOk();
    expect($response->streamedContent())->toBe('OLD-PLAINTEXT');
});

it('lets the office file a document for a driver, and filing is not verifying', function (): void {
    Notification::fake();

    [, $driver] = reviewDriver();

    $this->actingAs(reviewStaff())
        ->post("/api/v1/drivers/{$driver->id}/documents", [
            'type' => DriverDocumentType::IDENTITY_DOCUMENT->value,
            'file' => reviewFile('walked-in.pdf'),
        ])
        ->assertCreated()
        // ADR-0033 §4 survives this endpoint: an administrator who files a
        // document has not approved it, and somebody still has to look.
        ->assertJsonPath('data.status', DriverDocumentStatus::PENDING->value);

    expect(DriverDocument::query()->where('driver_id', $driver->id)->count())->toBe(1);

    // Filing is not a decision, so it is not something to notify a driver
    // about — they are standing at the counter.
    Notification::assertNothingSent();
});

it('refuses to let somebody without drivers.manage file a document', function (): void {
    [$user, $driver] = reviewDriver();

    // A driver holds `view` over their own document and no `create` at all.
    $this->actingAs($user)
        ->post("/api/v1/drivers/{$driver->id}/documents", [
            'type' => DriverDocumentType::IDENTITY_DOCUMENT->value,
            'file' => reviewFile(),
        ])
        ->assertForbidden();

    expect(DriverDocument::query()->count())->toBe(0);
});
