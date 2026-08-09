<?php

namespace Modules\Notifications\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * An app install saying where to reach it (ADR-0025 §4).
 *
 * Takes no `user_id`: the account is the token, and a field naming somebody
 * else is a field to tamper with — the same rule every `/me/` request in this
 * platform follows.
 */
class StoreDeviceTokenRequest extends FormRequest
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
            // Not pattern-matched against Expo's `ExponentPushToken[…]`
            // shape. ADR-0025 §2 keeps FCM and APNs available as a second
            // implementation behind the same channel, and those tokens look
            // nothing like Expo's — a regex here would have to be revised the
            // day somebody adds one, and would fail closed on a handset in
            // the field rather than in a test.
            'token' => ['required', 'string', 'max:255'],

            // The push service this token belongs to. Constrained, unlike the
            // token itself: an unrecognised provider means nothing can send
            // to the row, so it is a value worth refusing at the door.
            'provider' => ['nullable', Rule::in(['expo'])],

            'platform' => ['nullable', 'string', 'max:20'],
            'app_version' => ['nullable', 'string', 'max:40'],
        ];
    }
}
