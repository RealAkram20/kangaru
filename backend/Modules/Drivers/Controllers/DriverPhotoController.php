<?php

namespace Modules\Drivers\Controllers;

use App\Enums\ErrorCode;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Requests\StoreDriverPhotoRequest;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * A driver's own photograph (ADR-0041).
 *
 * Under `/me` like every other driver-scoped route: the driver is the token,
 * so there is no id in the path and no policy question left. **That is why
 * `show()` needs no authorisation and `DriverDocumentController::file()` does**
 * — that one takes a document id and this one cannot name anybody else.
 *
 * ## Streamed, never a storage URL
 *
 * The same rule ADR-0033 §3 applies to an identity document, and it matters
 * *more* here rather than less. A signed link is addressable by anyone who
 * ever saw it, and unlike a licence scan — fetched once by a reviewer — this
 * image is loaded every time a driver opens the drawer. The link would travel
 * through proxies, caches and crash reports dozens of times a day.
 *
 * ## Replacing, not accumulating
 *
 * A driver has one photograph. `store()` deletes the previous file in the same
 * act that records the new path, because the alternative is a private disk
 * that grows a portrait every time somebody dislikes their haircut, and
 * photographs of people are the last thing that should accumulate untracked.
 */
class DriverPhotoController extends Controller
{
    private const DISK_DIRECTORY = 'driver-photos';

    public function store(StoreDriverPhotoRequest $request): JsonResponse
    {
        $driver = $this->driverFor($request);

        if ($driver === null) {
            return $this->notADriver();
        }

        /** @var UploadedFile $file */
        $file = $request->file('file');

        $previous = $driver->photo_path;

        // Stored on the **private** disk, under a hashed name. `store()` on
        // the default disk is what `DriverDocumentService` uses, and this sits
        // beside those files for the same reason: nothing under it is
        // web-reachable, so a leaked path is not a leaked photograph.
        $path = $file->store(self::DISK_DIRECTORY);

        if ($path === false) {
            return ApiResponse::error(
                ErrorCode::NOT_FOUND,
                'Could not store that photo. Try again.',
                [],
                422,
            );
        }

        $driver->forceFill(['photo_path' => $path])->save();

        // After the new path is committed, never before: a delete that ran
        // first and then failed to save would leave a driver with a row
        // pointing at a file that no longer exists — and the screen would show
        // a broken image rather than falling back to their initials.
        if (is_string($previous) && $previous !== '' && $previous !== $path) {
            Storage::delete($previous);
        }

        return ApiResponse::success(
            ['photo_url' => $this->urlFor($driver)],
            'Photo updated.',
        );
    }

    public function show(Request $request): StreamedResponse|JsonResponse
    {
        $driver = $this->driverFor($request);

        if ($driver === null) {
            return $this->notADriver();
        }

        $path = $driver->photo_path;

        if (! is_string($path) || $path === '' || ! Storage::exists($path)) {
            return ApiResponse::error(
                ErrorCode::NOT_FOUND,
                'No photo on file.',
                [],
                404,
            );
        }

        return Storage::response($path);
    }

    /**
     * Removing it, which is a thing a driver is entitled to do.
     *
     * The file goes as well as the row. A photograph of somebody kept after
     * they asked for it to be removed is the kind of thing the privacy notice
     * promises not to do — *"ask us to delete it when it is no longer needed"*.
     */
    public function destroy(Request $request): JsonResponse
    {
        $driver = $this->driverFor($request);

        if ($driver === null) {
            return $this->notADriver();
        }

        $path = $driver->photo_path;

        $driver->forceFill(['photo_path' => null])->save();

        if (is_string($path) && $path !== '') {
            Storage::delete($path);
        }

        return ApiResponse::success(['photo_url' => null], 'Photo removed.');
    }

    /**
     * The URL the app loads, or null.
     *
     * A route rather than a storage path, and **cache-busted on the stored
     * path**. Without the query the app's image cache would go on showing the
     * previous portrait after an upload, on the one screen whose whole job is
     * telling a driver this account is theirs.
     */
    private function urlFor(Driver $driver): ?string
    {
        $path = $driver->photo_path;

        if (! is_string($path) || $path === '') {
            return null;
        }

        return route('me.photo.show').'?v='.substr(sha1($path), 0, 8);
    }

    private function driverFor(Request $request): ?Driver
    {
        /** @var User $user */
        $user = $request->user();

        return Driver::query()->where('user_id', $user->id)->first();
    }

    private function notADriver(): JsonResponse
    {
        return ApiResponse::error(
            ErrorCode::NOT_A_DRIVER,
            'This account is not linked to a driver profile.',
            [],
            403,
        );
    }
}
