<?php

namespace Modules\Drivers\Services;

use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Modules\Drivers\Enums\DriverDocumentStatus;
use Modules\Drivers\Enums\DriverDocumentType;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Models\DriverDocument;

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
        Driver $driver,
        DriverDocumentType $type,
        UploadedFile $file,
        ?string $expiresAt,
    ): DriverDocument {
        $newPath = $this->store->store($driver, $type, $file);

        /** @var DriverDocument $document */
        /** @var string|null $supersededPath */
        [$document, $supersededPath] = DB::transaction(function () use (
            $driver,
            $type,
            $file,
            $expiresAt,
            $newPath,
        ): array {
            $existing = DriverDocument::query()
                ->where('driver_id', $driver->getKey())
                ->where('type', $type->value)
                // The row is about to be rewritten from two places at once if
                // a driver double-taps upload on a slow connection; the lock
                // makes the second one wait rather than orphan the first's
                // file.
                ->lockForUpdate()
                ->first();

            $attributes = [
                'driver_id' => $driver->getKey(),
                'type' => $type->value,
                // **The reset.** Every review field goes back to nothing: a
                // replacement is a new document, not an amendment to the one
                // somebody already approved.
                'status' => DriverDocumentStatus::PENDING->value,
                'file_path' => $newPath,
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

        return $document;
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
        $held = DriverDocument::query()
            ->where('driver_id', $driver->getKey())
            ->get()
            ->keyBy(fn (DriverDocument $document): string => $document->type->value);

        return array_map(
            static fn (DriverDocumentType $type): array => [
                'type' => $type,
                'document' => $held->get($type->value),
            ],
            DriverDocumentType::cases(),
        );
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
