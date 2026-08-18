<?php

namespace Modules\Drivers\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Modules\Drivers\Enums\DriverDocumentType;
use Modules\Drivers\Models\DriverDocument;

/**
 * One of a driver's papers — for the driver's own screen and for the office
 * queue, which read the same shape.
 *
 * **`file_path` is never here.** It is `$hidden` on the model as well, because
 * a resource is the wrong place for the only guard on a private disk holding
 * somebody's identity document. The file is reached through a controller that
 * streams it behind the policy (ADR-0033 §5).
 *
 * @mixin DriverDocument
 */
class DriverDocumentResource extends JsonResource
{
    /**
     * @param  string  $timezone  The operator's, for the derived expiry state.
     *                            Passed in rather than read here so a list of
     *                            documents makes one settings lookup instead
     *                            of one per row.
     */
    public function __construct(DriverDocument $resource, private readonly string $timezone)
    {
        parent::__construct($resource);
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var DriverDocumentType $type */
        $type = $this->type;

        return [
            'id' => $this->id,
            'driver_id' => $this->driver_id,
            'type' => $type->value,
            'type_label' => $type->label(),
            /**
             * **The stored status, and the state anything should act on.**
             *
             * They differ for exactly one case and it is the important one: a
             * `verified` document whose date has passed reports a
             * `compliance_state` of `expired`. Expiry outranks verification —
             * a licence that lapsed last month is not a verified licence, and
             * reporting it as one is the lie ADR-0033 exists to stop.
             */
            'status' => $this->status->value,
            'status_label' => $this->status->label(),
            'compliance_state' => $this->complianceState($this->timezone),
            'expires_at' => $this->expires_at?->toDateString(),
            'expired' => $this->hasExpired($this->timezone),
            'original_name' => $this->original_name,
            'mime_type' => $this->mime_type,
            'size_bytes' => $this->size_bytes,
            'uploaded_at' => $this->uploaded_at->toIso8601String(),
            // Present only on a rejection, and never empty when it is.
            'rejection_reason' => $this->rejection_reason,
            'reviewed_at' => $this->reviewed_at?->toIso8601String(),
            /**
             * Where the file is fetched from — a route, not a storage URL.
             *
             * Served as a path so the app does not assemble one: the driver's
             * copy and the office's copy come from different endpoints, and a
             * handset building `/drivers/{id}/documents/...` would be asking
             * for a route its token cannot reach (`ClientScope`).
             */
            'file_url' => $this->fileUrlFor($request),
        ];
    }

    /**
     * The route that streams this file, chosen by who is asking.
     *
     * A driver token may reach `me.documents.file`; an office session reaches
     * the driver-scoped one. Deciding here rather than in two controllers
     * keeps the resource one shape — the app and the console render the same
     * fields — while never handing either side a URL it cannot use.
     */
    private function fileUrlFor(Request $request): string
    {
        $user = $request->user();
        $isOwner = $user !== null
            && $this->driver !== null
            && $this->driver->user_id === $user->getKey();

        return $isOwner
            ? route('me.documents.file', ['document' => $this->id], false)
            : route('drivers.documents.file', [
                'driver' => $this->driver_id,
                'document' => $this->id,
            ], false);
    }
}
