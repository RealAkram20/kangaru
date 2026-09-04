<?php

namespace Modules\Drivers\Requests;

/**
 * An applicant sending one of their papers before anybody has approved them
 * (ADR-0048 §4).
 *
 * **Every rule is `StoreDriverDocumentRequest`'s**, by extension rather than
 * by copy. That is the point: the file a stranger uploads lands on the same
 * private disk, is read by the same reviewer and becomes the same row on the
 * same driver, so a looser mime list or a larger ceiling on this path would
 * be a way of getting past the fleet's own limits by applying instead of
 * being hired.
 *
 * What it adds is the claim ticket. Nothing else about this request differs,
 * and if a future change makes it differ, that difference is the thing to
 * argue for in a decision record.
 */
class StoreApplicationDocumentRequest extends StoreDriverDocumentRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            ...parent::rules(),
            /**
             * The 64-character opaque secret minted at submission.
             *
             * Validated for shape only — length and character class. Whether
             * it resolves to a live application is the controller's question,
             * and it is deliberately **not** asked here: a 422 naming
             * `upload_token` as invalid tells an unauthenticated caller that
             * their guess was well-formed but wrong, which is one bit more
             * than the flat 404 ADR-0048 §4 promises.
             *
             * In the body rather than a header, because this is a multipart
             * form from a handset and one place for the request's fields is
             * easier to get right than two.
             */
            'upload_token' => ['required', 'string', 'size:64', 'regex:/^[A-Za-z0-9]+$/'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            ...parent::messages(),
            // Deliberately vague, and never "that token is wrong". See above.
            'upload_token.required' => 'This upload could not be matched to an application.',
            'upload_token.size' => 'This upload could not be matched to an application.',
            'upload_token.regex' => 'This upload could not be matched to an application.',
        ];
    }
}
