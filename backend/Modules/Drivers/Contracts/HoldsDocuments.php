<?php

namespace Modules\Drivers\Contracts;

/**
 * Something a `driver_documents` row can be filed against (ADR-0048 §3).
 *
 * There are exactly two implementers and there is not meant to be a third:
 * `Driver`, and `DriverApplication` while it is undecided. The interface
 * exists so that `DriverDocumentStore` does not have to branch on which one
 * it was handed, and so that adding a third would be a deliberate act with a
 * compiler-checked shape rather than an `if` somebody forgot to extend.
 *
 * ## Why the directory is asked for rather than derived
 *
 * The obvious alternative — `sprintf('%s/%d/documents', $table, $id)` from
 * the model's own table name — is one line shorter and couples the layout of
 * a private disk holding people's national IDs to a table name somebody may
 * one day rename in a migration. Files already written would then be
 * unreachable, silently, and the failure would present as "the office cannot
 * open this driver's licence" months later.
 */
interface HoldsDocuments
{
    /**
     * The directory on the private disk that this owner's files live in.
     *
     * Must be stable for the life of the owner: the path is stored in
     * `driver_documents.file_path` and is how the file is found again.
     * **Approval does not move files** — a document carried from an
     * application to a driver (ADR-0048 §5) keeps the path it was written
     * to, because re-pointing a row is atomic and moving bytes is not.
     */
    public function documentDirectory(): string;

    /**
     * How this owner appears in a log line or an error message.
     *
     * Deliberately not the person's name. A storage failure is written to a
     * log that is not access-controlled the way the documents themselves
     * are, and "driver 41" is enough to find the row.
     */
    public function documentOwnerLabel(): string;
}
