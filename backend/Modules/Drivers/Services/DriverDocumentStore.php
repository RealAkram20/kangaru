<?php

namespace Modules\Drivers\Services;

use Illuminate\Contracts\Encryption\DecryptException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Modules\Drivers\Contracts\HoldsDocuments;
use Modules\Drivers\Enums\DriverDocumentType;
use Modules\Drivers\Models\DriverDocument;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Where a driver's papers live on disk (ADR-0033 §5).
 *
 * Modelled on `OdometerPhotoStore`, which solved this problem already and
 * whose reasoning applies here more strongly: an odometer photo shows a
 * dashboard, and these show somebody's identity document.
 *
 *     drivers/{driver}/documents/{type}-{uuid}.{ext}
 *     driver-applications/{application}/documents/{type}-{uuid}.{ext}
 *
 * **Two roots, because ADR-0048 §3 gave documents a second kind of owner.**
 * The directory is asked of the owner (`HoldsDocuments`) rather than derived
 * from a table name here: the path is stored in `driver_documents.file_path`
 * and is how a file is found again, so coupling it to something a migration
 * could rename would make already-written files unreachable, silently, and
 * present months later as "the office cannot open this driver's licence".
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
     * Files a driver's upload, encrypted, and returns the path it was written
     * to (ADR-0053).
     *
     * The extension is taken from the file's own sniffed type rather than the
     * client's name. A handset that uploads `licence.jpg` containing a PDF is
     * usually a picker quirk rather than an attack, but either way the stored
     * name should describe the bytes — and it still should, even though the
     * bytes at that path are now ciphertext: the extension is how a human
     * recovering from a backup knows what they are looking at once it has
     * been decrypted.
     *
     * **`Storage::put` rather than `UploadedFile::storeAs`.** The framework
     * helper moves the temporary file, which is exactly what must not happen
     * here: the plaintext would arrive on the disk under its final name and
     * only then be replaced, leaving a window in which the document is
     * readable and, if the process died in it, a plaintext file nothing knows
     * is plaintext. Reading the bytes and writing the ciphertext is one
     * operation with no such window.
     *
     * **Whole-file, not streamed.** `StoreDriverDocumentRequest` caps an
     * upload at 8 MB, so the peak here is that plus its ciphertext — an
     * amount PHP's default memory limit carries comfortably. A streaming
     * cipher would be the right answer for a video store and is the wrong
     * complexity for a photograph of a licence.
     */
    public function store(HoldsDocuments $owner, DriverDocumentType $type, UploadedFile $file): string
    {
        $extension = $file->extension() ?: 'bin';
        $name = sprintf('%s-%s.%s', $type->value, Str::uuid7(), $extension);
        $path = sprintf('%s/%s', $owner->documentDirectory(), $name);

        $plaintext = file_get_contents($file->getRealPath());

        if ($plaintext === false) {
            throw new \RuntimeException(sprintf(
                'The %s document for %s could not be read from the upload.',
                $type->value,
                $owner->documentOwnerLabel(),
            ));
        }

        $written = Storage::put($path, Crypt::encryptString($plaintext));

        // `put` returns false on a write failure rather than throwing, and a
        // false reaching a NOT NULL string column is a 500 three frames from
        // the cause. Fail here, where the message can say what happened.
        if ($written === false) {
            throw new \RuntimeException(sprintf(
                'The %s document for %s could not be stored.',
                $type->value,
                $owner->documentOwnerLabel(),
            ));
        }

        return $path;
    }

    /**
     * The document's real bytes, whichever way they were written.
     *
     * **The one place that knows a stored document may be ciphertext**, and
     * the reason it is a method here rather than a branch in a controller:
     * two controllers stream these files — the driver's own and the office's
     * review screen — and AGENTS.md makes the second occurrence the moment
     * something becomes shared. A decryption branch that existed in one of
     * them and not the other would serve a national ID as gibberish to
     * exactly one audience, which is the kind of bug nobody reports because
     * the other screen works.
     *
     * `encrypted` is read from the row, never guessed from the bytes. Files
     * written before ADR-0053 carry `false` and are returned as they are.
     *
     * Returns null when the file is not on disk at all, which both callers
     * already had to handle: a document restored from a database backup whose
     * files were not restored with it is a real state, and it is a 404 rather
     * than a 500.
     */
    public function contents(DriverDocument $document): ?string
    {
        if (! Storage::exists($document->file_path)) {
            return null;
        }

        $stored = Storage::get($document->file_path);

        if ($stored === null) {
            return null;
        }

        if (! $document->encrypted) {
            return $stored;
        }

        try {
            return Crypt::decryptString($stored);
        } catch (DecryptException $e) {
            /*
             * A row that says `encrypted` over bytes this key cannot open.
             * In practice that means `APP_KEY` was rotated without the
             * re-encryption that a rotation requires.
             *
             * **Rethrown rather than served.** Falling back to the raw bytes
             * would hand the office a screenful of ciphertext and log
             * nothing; returning null would say "no such file", which sends
             * somebody looking for a storage fault that does not exist. This
             * is a key-management failure and it should read as one.
             */
            throw new \RuntimeException(sprintf(
                'Document %d could not be decrypted. Has APP_KEY changed?',
                $document->getKey(),
            ), previous: $e);
        }
    }

    /**
     * The document as a download, or null when the file is gone.
     *
     * **Never `Storage::response()`.** That helper streams the file straight
     * off the disk and infers the content type from it, and both halves are
     * now wrong: the bytes on disk are ciphertext, and their type sniffs as
     * plain text. The stored `mime_type` — recorded from the upload before it
     * was encrypted — is the honest answer, and `original_name` gives the
     * office a filename it recognises rather than a uuid.
     *
     * Still never a storage URL, which is the point ADR-0033 §5 was making
     * and is untouched: a signed link to somebody's identity document is
     * addressable by anyone who ever saw it, for as long as it lives.
     */
    public function download(DriverDocument $document): ?StreamedResponse
    {
        $contents = $this->contents($document);

        if ($contents === null) {
            return null;
        }

        return new StreamedResponse(
            static function () use ($contents): void {
                echo $contents;
            },
            200,
            [
                'Content-Type' => $document->mime_type,
                'Content-Length' => (string) strlen($contents),
                /*
                 * `inline`, so the office's review dialog can show the
                 * document in place rather than downloading it — and
                 * `filename` quoted, because `original_name` is a string a
                 * stranger typed and may contain a space, a semicolon or a
                 * quote. An unquoted one truncates the header at the first
                 * space and can inject a second header directive.
                 */
                'Content-Disposition' => sprintf(
                    'inline; filename="%s"',
                    str_replace('"', '', $document->original_name ?? 'document'),
                ),
                // These bytes are somebody's national ID. Nothing between the
                // office and the server should keep a copy.
                'Cache-Control' => 'private, no-store, max-age=0',
            ],
        );
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
}
