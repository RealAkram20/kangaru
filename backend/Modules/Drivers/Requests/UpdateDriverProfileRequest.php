<?php

namespace Modules\Drivers\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * A driver correcting their own details.
 *
 * Authorisation is open here and settled in the controller, exactly as
 * `StoreDriverPhotoRequest` does it: the driver is the token, so there is no id
 * to authorise against — only a check that the account has a driver profile.
 *
 * ## What a driver may change, and what the office keeps
 *
 * **Two fields, and the omissions are the design.** `UpdateDriverRequest` — the
 * office's form — accepts seven. The five withheld here are withheld for
 * reasons that are not about trust:
 *
 * - **`license_number` and `license_expiry`** are the compliance facts the
 *   office verifies (ADR-0033). A driver who can edit their own expiry date
 *   self-certifies their own compliance, and the document review queue stops
 *   meaning anything the moment its subject can rewrite its answer.
 * - **`status`** (`active` / `suspended` / `inactive`) is a dispatch control. A
 *   suspended driver who can set themselves active has undone the suspension.
 * - **`vehicle_id`** is a Fleet allocation. Which car a driver takes out is the
 *   depot's answer, not a preference.
 * - **`email` is the login credential** (ADR-0016). Changing it changes what
 *   the driver signs in with, so it needs re-authentication and a notice to the
 *   old address — and a mistyped one locks somebody out of their own account
 *   with no way back in. It is a feature of its own, not a field on a form.
 *
 * The profile screen shows all five and says who manages them, which is the
 * difference between a screen that is incomplete and one that is deliberate.
 */
class UpdateDriverProfileRequest extends FormRequest
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
            /*
             * The five the office keeps are **refused loudly, not dropped
             * quietly.** `validated()` already excludes them, so silence would
             * be safe — nothing would be written either way. It would also
             * teach a client that the field works: a handset sending
             * `status: active` would get a 200 and a body showing the old
             * status, which reads as a race rather than a refusal.
             *
             * `SettingsService::setGroup()` made the same call for the same
             * reason, in as many words: "Unknown keys are refused loudly — a
             * silent skip would make a typo in the client look like a saved
             * setting." This is that, where the setting is somebody's
             * suspension.
             *
             * Each is proved by its own test case. They were once asserted
             * together and a mutation showed that green: with four of five
             * still prohibited, the request failed anyway and the test could
             * not tell which lock had been picked.
             */
            'status' => ['prohibited'],
            'license_number' => ['prohibited'],
            'license_expiry' => ['prohibited'],
            'vehicle_id' => ['prohibited'],
            'email' => ['prohibited'],

            /*
             * `sometimes` on both, so a client may send either alone. The
             * screen edits one field at a time, and a PATCH that demanded the
             * whole pair would make correcting a phone number capable of
             * overwriting a name the driver never touched.
             */
            'name' => ['sometimes', 'required', 'string', 'max:255'],
            /*
             * Deliberately as loose as the office's own rule (`max:50`, no
             * pattern). PRODUCT.md is East Africa first and international
             * after: a driver may hold a Ugandan `+256`, a Kenyan `+254`, or a
             * local `07…`, and a regex tuned to one of them silently refuses
             * the others. The office's form has never validated shape here and
             * a stricter rule on the driver's own copy would mean the platform
             * accepted a number it then refused to let its owner correct.
             */
            'phone' => ['sometimes', 'required', 'string', 'max:50'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'name.required' => 'A name cannot be blank.',
            'phone.required' => 'A phone number cannot be blank.',
            // Each says *who* holds the field rather than "not allowed". A
            // driver reading this in a toast should know where to go next, and
            // "the office manages your licence" is an instruction where
            // "prohibited" is a wall.
            'status.prohibited' => 'The office sets whether an account is active.',
            'license_number.prohibited' => 'The office manages licence details. Send a document instead.',
            'license_expiry.prohibited' => 'The office manages licence details. Send a document instead.',
            'vehicle_id.prohibited' => 'The depot allocates vehicles.',
            'email.prohibited' => 'Your sign-in email is changed by the office.',
        ];
    }
}
