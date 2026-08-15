<?php

namespace Modules\Drivers\Services;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Modules\Drivers\Enums\DriverDocumentType;
use Modules\Drivers\Models\Driver;

/**
 * Where a driver's papers live on disk (ADR-0033 §5).
 *
 * Modelled on `OdometerPhotoStore`, which solved this problem already and
 * whose reasoning applies here more strongly: an odometer photo shows a
 * dashboard, and these show somebody's identity document.
 *
 *     drivers/{driver}/documents/{type}-{uuid}.{ext}
 *
 * **Not tenant-prefixed, and that is not an oversight.** ADR-0005 dropped
 * `drivers.tenant_id` — a driver belongs to the platform, not to a client — so
 * a tenant prefix here would be a directory named after somebody who does not
 * own the file. `OdometerPhotoStore` branches on the trip's owner for exactly
 * that reason; a driver has one owner and needs no branch.
 *
 * The uuid rather than a fixed name means a replaced document never
 * half-overwrites the one on the record: the new file is written first, the
 * row is repointed, and only then is the old file discarded — so a failure
 * anywhere in that sequence leaves a row pointing at a file that exists.
 */
class DriverDocumentStore
{
    /**
     * Files a driver's upload and returns the path it was written to.
     *
     * The extension is taken from the file's own sniffed type rather than the
     * client's name. A handset that uploads `licence.jpg` containing a PDF is
     * usually a picker quirk rather than an attack, but either way the stored
     * name should describe the bytes.
     */
    public function store(Driver $driver, DriverDocumentType $type, UploadedFile $file): string
    {
        $extension = $file->extension() ?: 'bin';
        $name = sprintf('%s-%s.%s', $type->value, Str::uuid7(), $extension);

        $path = $file->storeAs($this->directoryFor($driver), $name);

        // `storeAs` returns false on a write failure rather than throwing, and
        // a false reaching a NOT NULL string column is a 500 three frames from
        // the cause. Fail here, where the message can say what happened.
        if ($path === false) {
            throw new \RuntimeException('The document could not be stored.');
        }

        return $path;
    }

    /**
     * Removes a file whose row no longer points at it.
     *
     * Called after a replacement has been committed, never before — see the
     * class notes. Silent on a missing file: a document restored from a backup
     * whose file was already collected should not fail somebody's upload.
     */
    public function discard(?string $path): void
    {
        if ($path !== null && $path !== '' && Storage::exists($path)) {
            Storage::delete($path);
        }
    }

    private function directoryFor(Driver $driver): string
    {
        return sprintf('drivers/%d/documents', $driver->getKey());
    }
}
