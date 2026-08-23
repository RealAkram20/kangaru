<?php

namespace Modules\Drivers\Services;

use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Modules\Drivers\Contracts\HoldsDocuments;
use Modules\Drivers\Enums\DriverDocumentStatus;
use Modules\Drivers\Enums\DriverDocumentType;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Models\DriverApplication;
use Modules\Drivers\Models\DriverDocument;
use Modules\Notifications\Notifications\DriverDocumentReviewedNotification;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Uploading, replacing and reviewing a driver's papers (ADR-0033).
 *
 * The one place that writes `driver_documents`. Two rules live here rather
 * than in a controller, because both are the kind that gets forgotten by the
 * second caller:
 *
 * 1. **A replacement resets the review.** A document the office verified is
 *    not evidence for a different file that arrived afterwards.
 * 2. **Nothing reaches `verified` without a `User`.** The signature requires
 *    one; there is no path through this class that verifies a document by
 *    itself (ADR-0033 §4).
 */
class DriverDocumentService
{
    public function __construct(
        private readonly DriverDocumentStore $store,
        /**
         * For `timezone()` only. Injected rather than re-read from settings
         * because "today" has to mean the same thing on every driver-facing
         * surface — `DriverStatsService` borrows the same accessor for the
         * same reason, and two independent readings of the operator's day is
         * exactly how they would stop agreeing.
         */
        private readonly DriverEarningsService $earnings,
    ) {}

    public function timezone(): string
    {
        return $this->earnings->timezone();
    }

    /**
     * The document as a download, decrypted, or null when its file is gone
     * (ADR-0053).
     *
     * A passthrough to the store, and it earns its line: both controllers that
     * stream a document already hold this service and neither holds the store,
     * so without it each would inject a second collaborator and one of them
     * would eventually stream the raw bytes. The service stays the single door
     * to `driver_documents` — the same property its class notes claim about
     * writes, now true of reads.
     */
    public function download(DriverDocument $document): ?StreamedResponse
    {
        return $this->store->download($document);
    }

    /**
     * Files a driver's upload, replacing anything already held of that type.
     *
     * The order is deliberate and is the reason this is not two lines: the new
     * file is written **first**, the row is repointed inside a transaction,
     * and only then is the old file discarded. A failure at any point leaves a
     * row pointing at a file that exists — which is not true of the obvious
     * ordering, where a delete followed by a failed write loses the document
     * the office had already accepted.
     */
    public function upload(
        HoldsDocuments $owner,
        DriverDocumentType $type,
        UploadedFile $file,
        ?string $expiresAt,
    ): DriverDocument {
        $newPath = $this->store->store($owner, $type, $file);
        $ownerColumn = self::ownerColumn($owner);

        /** @var DriverDocument $document */
        /** @var string|null $supersededPath */
        [$document, $supersededPath] = DB::transaction(function () use (
            $owner,
            $ownerColumn,
            $type,
            $file,
            $expiresAt,
            $newPath,
        ): array {
            $existing = DriverDocument::query()
                ->where($ownerColumn, $owner->getKey())
                ->where('type', $type->value)
                // The row is about to be rewritten from two places at once if
                // a driver double-taps upload on a slow connection; the lock
                // makes the second one wait rather than orphan the first's
                // file.
                ->lockForUpdate()
                ->first();

            $attributes = [
                // **Exactly one owner column is written, and the other is
                // explicitly nulled** (ADR-0048 §3). Setting only the one that
                // applies would leave a stale id behind when an approved
                // driver re-uploads over a document they sent as an applicant.
                'driver_id' => null,
                'driver_application_id' => null,
                $ownerColumn => $owner->getKey(),
                'type' => $type->value,
                // **The reset.** Every review field goes back to nothing: a
                // replacement is a new document, not an amendment to the one
                // somebody already approved.
                'status' => DriverDocumentStatus::PENDING->value,
                'file_path' => $newPath,
                // Everything written from now on is ciphertext (ADR-0053).
                // The flag *describes* the file rather than deciding anything:
                // `DriverDocumentStore` always encrypts, and this records that
                // it did so, for the benefit of rows written before it started.
                'encrypted' => true,
                'original_name' => $file->getClientOriginalName(),
                'mime_type' => $file->getMimeType() ?? 'application/octet-stream',
                'size_bytes' => $file->getSize() ?: 0,
                'expires_at' => $expiresAt,
                'uploaded_at' => now(),
                'reviewed_by_user_id' => null,
                'reviewed_at' => null,
                'rejection_reason' => null,
            ];

            if ($existing === null) {
                return [DriverDocument::query()->create($attributes), null];
            }

            $superseded = $existing->file_path;
            $existing->update($attributes);

            return [$existing, $superseded];
        });

        // Outside the transaction: a file delete is not transactional, and a
        // rollback after it would leave the row pointing at nothing.
        if ($supersededPath !== null && $supersededPath !== $newPath) {
            $this->store->discard($supersededPath);
        }

        return $document;
    }

    /** The office says yes. Requires a person — see the class notes. */
    public function verify(DriverDocument $document, User $reviewer): DriverDocument
    {
        $document->update([
            'status' => DriverDocumentStatus::VERIFIED->value,
            'reviewed_by_user_id' => $reviewer->getKey(),
            'reviewed_at' => now(),
            // Cleared, so a document rejected and later accepted does not
            // carry the old objection around with it.
            'rejection_reason' => null,
        ]);

        $this->announce($document);

        return $document;
    }

    /** The office says no, and says why. */
    public function reject(DriverDocument $document, User $reviewer, string $reason): DriverDocument
    {
        $document->update([
            'status' => DriverDocumentStatus::REJECTED->value,
            'reviewed_by_user_id' => $reviewer->getKey(),
            'reviewed_at' => now(),
            'rejection_reason' => $reason,
        ]);

        $this->announce($document);

        return $document;
    }

    /**
     * Tell the driver what was decided (ADR-0052).
     *
     * **Here rather than in the controller**, so that both decisions raise it
     * and neither can forget to. A second reviewing surface — a bulk action, a
     * console shortcut, an artisan command during a backlog — gets the
     * notification by calling the same method, which is the property ADR-0033
     * §4 relies on when it says this class is the only thing that writes a
     * review.
     *
     * ## Three ways there is nobody to tell, and all of them are normal
     *
     * 1. **The document belongs to an application, not a driver.** Approval
     *    carries these over as `pending` (ADR-0048 §5), so an
     *    application-owned row should not be reviewable at all — but if one
     *    ever is, the applicant holds no account and no device by
     *    construction (ADR-0027 §1).
     * 2. **The driver has no sign-in.** ADR-0016 makes the account optional;
     *    a driver row created before the app existed has `user_id` null.
     * 3. **The driver's account was closed.** ADR-0043 §5 detaches the link
     *    and keeps the row.
     *
     * None of these is an error and none of them may throw: the review has
     * already been recorded, and a notification failure must not present to
     * the office as a failed decision. `?->` and a null check are the whole
     * mechanism.
     */
    private function announce(DriverDocument $document): void
    {
        $user = $document->driver?->user;

        $user?->notify(DriverDocumentReviewedNotification::for($document));
    }

    /**
     * Every type, whether or not the driver has uploaded it.
     *
     * **The missing ones are the point.** A list of what has been uploaded
     * answers "what have I sent"; a driver opening this screen is asking "what
     * do I still owe you", and only the full set answers that. Absent types
     * come back as a null document against a real type, and the app draws them
     * as an empty slot rather than omitting the row.
     *
     * @return list<array{type: DriverDocumentType, document: DriverDocument|null}>
     */
    public function forDriver(Driver $driver): array
    {
        return $this->slotsFor($driver);
    }

    /**
     * The same six slots, for an applicant with no driver profile yet
     * (ADR-0048 §4).
     *
     * Deliberately the **same shape** as `forDriver()`, so the KYC screen is
     * one screen rather than two that drifted apart: an applicant filling it
     * in before approval and a driver filling it in after are doing the same
     * thing, and only the endpoint differs.
     *
     * @return list<array{type: DriverDocumentType, document: DriverDocument|null}>
     */
    public function forApplication(DriverApplication $application): array
    {
        return $this->slotsFor($application);
    }

    /**
     * @return list<array{type: DriverDocumentType, document: DriverDocument|null}>
     */
    private function slotsFor(HoldsDocuments $owner): array
    {
        $held = DriverDocument::query()
            ->where(self::ownerColumn($owner), $owner->getKey())
            ->get()
            ->keyBy(fn (DriverDocument $document): string => $document->type->value);

        // `array_values` around the map: `array_map` over one array preserves
        // its keys, so the result is an `array<int, …>` and the declared
        // `list<…>` is a promise PHPStan level 8 will not take on trust.
        // The keys are 0..n here anyway; this is the proof, not a change.
        return array_values(array_map(
            static fn (DriverDocumentType $type): array => [
                'type' => $type,
                'document' => $held->get($type->value),
            ],
            // `ordered()` rather than `cases()`: the reading order a reviewer
            // relies on — identity, then the licence, then the vehicle — is
            // fixed on the enum (ADR-0048 §1) so that both apps agree without
            // either of them sorting for itself.
            DriverDocumentType::ordered(),
        ));
    }

    /**
     * Which of the two owner columns applies (ADR-0048 §3).
     *
     * A `match` on the concrete class rather than a method on the interface,
     * because a column name is this table's business and not something a
     * `Driver` should have to know about itself.
     */
    private static function ownerColumn(HoldsDocuments $owner): string
    {
        return match (true) {
            $owner instanceof Driver => 'driver_id',
            $owner instanceof DriverApplication => 'driver_application_id',
            default => throw new \InvalidArgumentException(sprintf(
                '%s cannot own a driver document.',
                $owner::class,
            )),
        };
    }

    /**
     * Approval: the applicant's uploads become the new driver's
     * (ADR-0048 §5).
     *
     * **`status` is left exactly as it is**, which is `pending`. Approval is
     * not review — nobody has looked at these files, and marking them
     * verified because a different decision went the applicant's way is the
     * auto-verification ADR-0033 §4 refuses, arriving through a side door.
     *
     * The files do not move. The row is re-pointed and `file_path` stays, so
     * an approved driver's earliest documents live under
     * `driver-applications/` forever — re-pointing a row is atomic, and
     * moving bytes across a disk is not.
     *
     * Called inside the approval transaction ADR-0027 §4 already runs.
     *
     * @return int how many documents were carried
     */
    public function carryToDriver(DriverApplication $application, Driver $driver): int
    {
        return DriverDocument::query()
            ->where('driver_application_id', $application->getKey())
            ->update([
                'driver_id' => $driver->getKey(),
                'driver_application_id' => null,
            ]);
    }

    /**
     * Destroys one document, row and file both.
     *
     * The withdraw an applicant reaches for after photographing the wrong
     * side of a logbook (ADR-0048 §4). Row first, file second, for the reason
     * `discardFor()` gives: a row pointing at a missing file is a 404 in the
     * office, while a file with no row is bytes nobody can reach — both are
     * wrong, and only one of them is a document somebody may be asked to
     * produce.
     *
     * **Deliberately not offered to a driver.** ADR-0033 §2 made re-uploading
     * the way a driver corrects a document, and it resets the review; a
     * driver who could delete instead would be able to remove a document the
     * office had already rejected, taking the objection with it.
     */
    public function discardOne(DriverDocument $document): void
    {
        $path = $document->file_path;

        $document->delete();

        $this->store->discard($path);
    }

    /**
     * Rejection, or an abandoned application swept up: the files go
     * (ADR-0048 §5).
     *
     * ADR-0027 clears a refused applicant's password on the same reasoning,
     * and this is the stronger case — a photograph of a stranger's face and
     * national ID, held against a person the platform decided against, is a
     * liability with no corresponding use.
     *
     * Rows go first and files second, never the other way round: a row
     * pointing at a file that is gone is a 404 in the office, while a file
     * with no row is bytes nobody can reach. Both are wrong; only one of them
     * is a document somebody may later be asked to produce.
     *
     * @return int how many documents were destroyed
     */
    public function discardFor(DriverApplication $application): int
    {
        $documents = DriverDocument::query()
            ->where('driver_application_id', $application->getKey())
            ->get();

        if ($documents->isEmpty()) {
            return 0;
        }

        DriverDocument::query()
            ->whereIn('id', $documents->pluck('id'))
            ->delete();

        foreach ($documents as $document) {
            $this->store->discard($document->file_path);
        }

        return $documents->count();
    }

    /**
     * The one-line answer the profile screen puts beside "Documents".
     *
     * **This is the seam ADR-0033 §6 names.** If dispatch is ever gated on
     * documents, the rule consults this rather than inventing a second notion
     * of compliance — which is how two surfaces end up disagreeing about
     * whether somebody may work.
     *
     * `action_needed` deliberately covers rejected *and* expired but **not**
     * missing-and-never-uploaded, which is `incomplete`. The difference
     * matters to the person reading it: one means "we looked and it is wrong",
     * the other means "we are still waiting for it", and collapsing them makes
     * a new driver look like a problem.
     *
     * @return array{state: string, verified: int, total: int, action_needed: int, pending: int}
     */
    public function complianceFor(Driver $driver): array
    {
        $timezone = $this->timezone();
        $rows = $this->forDriver($driver);

        $verified = 0;
        $pending = 0;
        $actionNeeded = 0;
        $missing = 0;

        foreach ($rows as $row) {
            $document = $row['document'];

            if ($document === null) {
                $missing++;

                continue;
            }

            match ($document->complianceState($timezone)) {
                'verified' => $verified++,
                'pending' => $pending++,
                // 'rejected' and the derived 'expired'.
                default => $actionNeeded++,
            };
        }

        return [
            // Ordered by what a driver most needs to be told first. Something
            // wrong outranks something missing, which outranks something
            // waiting — and "verified" is only claimed when every type is.
            'state' => match (true) {
                $actionNeeded > 0 => 'action_needed',
                $missing > 0 => 'incomplete',
                $pending > 0 => 'pending',
                default => 'verified',
            },
            'verified' => $verified,
            'total' => count($rows),
            'action_needed' => $actionNeeded,
            'pending' => $pending,
        ];
    }
}
