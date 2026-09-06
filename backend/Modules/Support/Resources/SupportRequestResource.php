<?php

namespace Modules\Support\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Modules\Support\Models\SupportRequest;

/**
 * A driver's report, for the driver who wrote it and for the office queue.
 *
 * **One resource for both readers, and the allow-list is why that is safe.**
 * AGENTS.md forbids spreading a model into a response; every field here is
 * named, and the two that would differ between audiences — who at the office
 * answered, and the driver's own identity — are handled explicitly below
 * rather than by having two nearly identical classes drift apart.
 *
 * @mixin SupportRequest
 */
class SupportRequestResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'driver_id' => $this->driver_id,
            // Named on the office queue so a clerk knows whose afternoon this
            // was without a second request. `whenLoaded`, so the driver's own
            // list does not pay for a join to tell them their own name.
            'driver_name' => $this->whenLoaded('driver', fn () => $this->driver?->name),
            'topic' => $this->topic->value,
            'topic_label' => $this->topic->label(),
            'status' => $this->status->value,
            'status_label' => $this->status->label(),
            // The journey it is about, or null. Served as an id rather than a
            // trip object: both readers already have somewhere better to look
            // one up, and a report is not a place to duplicate a trip record.
            'trip_id' => $this->trip_id,
            // The driver's own account, verbatim. Never truncated here — a
            // list that shortens somebody's description of an assault to fit a
            // row is a decision for the screen, not for the API.
            'body' => $this->body,
            /**
             * The office's reply, or null while it is still owed.
             *
             * **Null and empty must stay distinguishable.** An answered report
             * always carries text — the service and the validator both
             * guarantee it — so a null here means precisely "not answered
             * yet", which is what the driver's screen renders as waiting.
             */
            'answer' => $this->answer,
            /**
             * Who answered, by name — but **only to the office**.
             *
             * A driver is told the office replied, not which clerk; naming an
             * individual to the person whose report was declined puts one
             * employee's name on a decision the organisation made. The office
             * queue needs it for exactly the opposite reason: accountability
             * for who said what is the whole purpose of `Auditable` on this
             * model.
             */
            'answered_by' => $this->whenLoaded('answeredBy', fn () => $this->answeredBy?->name),
            'answered_at' => $this->answered_at?->toIso8601String(),
            // `->`, not `?->`: `created_at` is non-nullable on this model, and
            // Larastan is right to refuse a nullsafe call that cannot be null.
            'created_at' => $this->created_at->toIso8601String(),
        ];
    }
}
