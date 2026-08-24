<?php

namespace Modules\Administration\Requests;

use App\Models\User;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;

/**
 * The colleague lookup's filters, whitelisted like every other listing
 * in the platform — an unknown filter is a 422, never a silent ignore.
 *
 * `q` is **required**, and that is a rule rather than an oversight: without
 * it this endpoint is "hand me the first fifteen names in the directory",
 * which is a staff list by another name.
 */
class ColleagueIndexRequest extends FormRequest
{
    private const ALLOWED_KEYS = ['q'];

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
            // Two characters, so a stray keystroke does not sweep the
            // directory. The client debounces; this is what enforces it.
            'q' => ['required', 'string', 'min:2', 'max:120'],

            // Which client's people, and only for a fleet actor, whose
            // search spans every client they serve (ADR-0064: the booking
            // dialog names the client first, and offering another client's
            // staff after that is offering a mistake). A client's own user
            // has no choice of client, so for them the key is not a filter
            // at all — same no-oracle shape as BookingIndexRequest, and no
            // `exists` rule for the same reason: the scope already answers
            // an unserved id with an empty list, identically to a real one.
            ...($this->actorIsFleet()
                ? ['tenant_id' => ['sometimes', 'integer']]
                : []),
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            $allowed = $this->actorIsFleet() ? [...self::ALLOWED_KEYS, 'tenant_id'] : self::ALLOWED_KEYS;

            foreach (array_diff(array_keys($this->query()), $allowed) as $key) {
                $validator->errors()->add((string) $key, "\"{$key}\" is not a filter this endpoint accepts.");
            }
        });
    }

    /** ADR-0055: `isPlatformLevel()` means a fleet's own staff. */
    private function actorIsFleet(): bool
    {
        $actor = $this->user();

        return $actor instanceof User && $actor->isPlatformLevel();
    }
}
