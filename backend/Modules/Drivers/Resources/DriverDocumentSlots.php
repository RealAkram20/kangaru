<?php

namespace Modules\Drivers\Resources;

use Illuminate\Http\Request;
use Modules\Drivers\Enums\DriverDocumentType;
use Modules\Drivers\Models\DriverDocument;

/**
 * The six document slots, as three screens draw them.
 *
 * Extracted because there are now **three** callers building this shape by
 * hand — the driver's own screen, the office queue, and (since ADR-0048 §4)
 * an applicant's KYC screen — and `AGENTS.md` says the second occurrence is
 * where something becomes shared. The third is where it becomes a bug: a
 * `hint` or a `requires_expiry` that drifts between the driver app and the
 * console is a field a driver is asked for on one surface and not the other.
 *
 * **The missing slots are the point** (ADR-0033). A list of what has been
 * uploaded answers "what have I sent"; somebody opening this screen is asking
 * "what do I still owe you", and only the full set answers that. An
 * un-uploaded type comes back as a real type with a null document.
 */
final class DriverDocumentSlots
{
    /**
     * @param  list<array{type: DriverDocumentType, document: DriverDocument|null}>  $slots
     * @return list<array<string, mixed>>
     */
    public static function toArray(array $slots, string $timezone, Request $request): array
    {
        return array_map(
            static fn (array $slot): array => [
                'type' => $slot['type']->value,
                'type_label' => $slot['type']->label(),
                'hint' => $slot['type']->hint(),
                'requires_expiry' => $slot['type']->requiresExpiry(),
                /**
                 * Which headed section this belongs under (ADR-0048 §1).
                 *
                 * Sent rather than inferred client-side, so that the driver
                 * app and the console group six slots the same way without
                 * either of them holding a list of type names. A seventh type
                 * then reaches both screens correctly grouped, with no client
                 * release.
                 */
                'group' => $slot['type']->group()->value,
                'group_label' => $slot['type']->group()->label(),
                'document' => $slot['document'] === null
                    ? null
                    : (new DriverDocumentResource($slot['document'], $timezone))->toArray($request),
            ],
            $slots,
        );
    }
}
