<?php

namespace Modules\Drivers\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rules\Password;

/**
 * A rider applying to drive (ADR-0027 §5). Unauthenticated.
 *
 * Note what is *not* here: no `Rule::unique` on the email, against either
 * `users` or `driver_applications`. That omission is the decision, not an
 * oversight — a uniqueness rule answers "is this address already known to
 * KangaruRide" to anybody who can POST a form, which is a free lookup
 * service for finding out who drives here, aimed at a population whose
 * movements are worth money to the wrong people.
 *
 * Duplicates are therefore accepted, stored, and refused at approval, where
 * a human is reading them and the answer goes to somebody entitled to it.
 *
 * No role field either, and no way to reach one. Everything an applicant
 * sends describes themselves; the fields that confer anything —
 * `license_number`, the role, the link to a driver profile — are supplied by
 * the reviewer at approval.
 */
class StoreDriverApplicationRequest extends FormRequest
{
    /** Public by design: the applicant has no account yet, that is the point. */
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
            'name' => ['required', 'string', 'max:255'],
            // 9 digits is the shortest real Ugandan number without its
            // country code; 32 characters allows "+256 700 000 000" written
            // out however somebody writes it. Not normalised here — the
            // office dials it, and mangling a number nobody can then reach
            // is worse than storing the spaces.
            'phone' => ['required', 'string', 'min:9', 'max:32'],
            'email' => ['required', 'email', 'max:190'],
            // The same minimum `StoreDriverAccountRequest` and
            // `ChangePasswordRequest` hold. It has to match: this is the
            // password that becomes the account's, so a looser rule here
            // would mint accounts the platform's own rules would reject.
            'password' => ['required', 'string', 'confirmed', Password::min(12)],
            // Consent is refused rather than inferred. `accepted` means
            // literally true/"1"/"yes" — a missing field or a false one
            // fails, so an applicant cannot arrive without having agreed.
            // The *time* is stamped server-side; the client is only ever
            // asked whether, never when.
            'terms_accepted' => ['accepted'],
            // Optional, and **deliberately not `exists:drivers,referral_code`**
            // (ADR-0037 §5). That rule would answer "is this one of your
            // drivers' codes?" to an unauthenticated caller, one guess at a
            // time — the same lookup service ADR-0027 §5 refuses to run for
            // the email address, and this one hands an attacker a way to
            // attribute their own recruits to somebody else's account.
            //
            // It is resolved when the office approves the application, where a
            // human is reading it. A code that resolves to nobody is silently
            // ignored there rather than refusing somebody a job.
            'referral_code' => ['sometimes', 'nullable', 'string', 'max:16'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'terms_accepted.accepted' => 'Please accept the Terms and Conditions and Privacy Policy to apply.',
            'password.confirmed' => 'The two passwords do not match.',
        ];
    }
}
