<?php

namespace Modules\Trips\Controllers;

use App\Enums\ErrorCode;
use App\Http\Controllers\Controller;
use App\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Storage;
use Modules\Trips\Models\Trip;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Serves the dashboard photo taken with an odometer reading.
 *
 * Streamed through the API rather than exposed as a storage URL. The photo
 * is a client's operational record — it shows their vehicle, at their
 * depot, at a known time — so it goes out behind the same authentication
 * and tenant scope as everything else. A public object-storage link would
 * be addressable by anyone who ever saw it, forever.
 *
 * Route-model binding resolves the trip through TenantScope, so another
 * tenant's trip id is a 404 before this method runs (ADR-0001).
 */
class OdometerPhotoController extends Controller
{
    public function show(Trip $trip, string $moment): StreamedResponse|JsonResponse
    {
        $this->authorize('view', $trip);

        $path = match ($moment) {
            'start' => $trip->odometer_start_photo_path,
            'end' => $trip->odometer_end_photo_path,
            default => null,
        };

        if ($path === null || ! Storage::exists($path)) {
            return ApiResponse::error(
                ErrorCode::NOT_FOUND,
                $moment === 'start' || $moment === 'end'
                    ? 'No dashboard photo was captured for this odometer reading.'
                    : 'Odometer photos are captured at the start and end of a trip only.',
                [],
                404,
            );
        }

        // Inline rather than as an attachment: this is nearly always being
        // looked at, not filed.
        return Storage::response($path);
    }
}
