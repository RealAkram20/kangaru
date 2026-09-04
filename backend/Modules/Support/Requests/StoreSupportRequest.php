<?php

namespace Modules\Support\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Modules\Support\Enums\SupportRequestTopic;

/**
 * A driver writing a report (ADR-0044).
 *
 * Authorisation is open here and settled in the controller: the driver is the
 * token, so there is no id to authorise against — only a check that the
 * account has a driver profile at all. Same shape as
 * `StoreSettlementRequest`.
 */
class StoreSupportRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'topic' => ['required', Rule::enum(SupportRequestTopic::class)],
            /**
             * What happened, in the driver's own words.
             *
             * **`min:10` and a 4,000-character ceiling, and both numbers are
             * arguable in one direction only.** The floor exists because a
             * one-word report gives the office nothing to answer and produces
             * a row a clerk can only reply to with a question; ten characters
             * is under three words and stops "test" without shaping anybody's
             * account of an assault.
             *
             * The ceiling is not a display limit — it is a request-size bound,
             * set far above anything a person types on a phone. Nothing
             * truncates: over the ceiling the report is refused with a message
             * saying so, because silently storing half of somebody's account
             * of what happened is worse than not storing it.
             */
            'body' => ['required', 'string', 'min:10', 'max:4000'],
            /**
             * The journey it is about, when it is about one.
             *
             * **Optional for every topic**, including the three
             * `SupportRequestTopic::usuallyAboutATrip()` calls likely. That
             * method drives what the *app offers*, never what the API
             * accepts: a driver reporting a passenger who never boarded has no
             * trip to name, and a validator that argued with them about it
             * would refuse the report over a technicality.
             *
             * `exists` only proves the trip is real. **That it is this
             * driver's own is settled in the controller**, where the driver is
             * known — the same split `StoreSettlementRequest` documents, and
             * for the same reason.
             */
            'trip_id' => ['nullable', 'integer', 'exists:trips,id'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'body.required' => 'Tell the office what happened.',
            'body.min' => 'Add a little more detail so the office can act on it.',
            'body.max' => 'That is too long to send. Shorten it and keep the important part.',
        ];
    }
}
