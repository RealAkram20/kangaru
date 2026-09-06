<?php

namespace Modules\Clients\Requests;

use App\Enums\AccessLevel;
use App\Models\User;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;
use Modules\Clients\Models\Company;

/**
 * Onboarding a corporate client (ADR-0060, ADR-0062 §3).
 *
 * Three rules carry this request, and each one closes a way the old
 * `CompanyService::create()` produced a broken client.
 */
class OnboardClientRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->can('create', Company::class) ?? false;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            // ADR-0060 §1: required at onboarding, and unique platform-wide.
            //
            // "Required" is a REQUEST rule and "never twice" is a column rule,
            // deliberately split: the column stays nullable so the rows that
            // predate this keep working, and this is what stops new ones
            // joining them.
            //
            // `withoutGlobalScopes` on the uniqueness check, because the
            // client scope would narrow it to the caller's own client — which
            // for a fleet's staff is none — and a uniqueness rule that cannot
            // see the row it must not duplicate is worse than none at all.
            'registration_number' => [
                'required', 'string', 'max:100',
                Rule::unique('companies', 'registration_number')->withoutTrashed(),
            ],
            'legal_name' => ['required', 'string', 'max:190'],
            'trading_name' => ['nullable', 'string', 'max:190'],
            'industry' => ['nullable', 'string', 'max:120'],
            // Required because the table says so — `billing_email`, `city` and
            // `country` are NOT NULL with no default. A request that called
            // them optional would produce a 500 from the database instead of a
            // 422 naming the field, which is the difference between a form
            // that teaches and one that fails.
            'billing_email' => ['required', 'email', 'max:190'],
            'phone' => ['nullable', 'string', 'max:32'],
            'address_line1' => ['nullable', 'string', 'max:190'],
            'address_line2' => ['nullable', 'string', 'max:190'],
            'city' => ['required', 'string', 'max:120'],
            'country' => ['required', 'string', 'size:2'],
            'credit_limit_minor' => ['nullable', 'integer', 'min:0'],

            // The client's first administrator, created in the same
            // transaction. Without it the client has an account nobody can
            // sign into — ADR-0059 §5's failure shape, one level down.
            'admin_name' => ['required', 'string', 'max:120'],
            'admin_email' => ['required', 'email', 'max:190', 'unique:users,email'],

            // Head office must name the fleet; a fleet may not name another
            // (see `withValidator`).
            'operator_id' => ['nullable', 'integer', 'exists:operators,id'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            /** @var User|null $actor */
            $actor = $this->user();

            if ($actor === null) {
                return;
            }

            if ($actor->access_level === AccessLevel::KANGARU) {
                // ADR-0062 §3. Required, not defaulted: a default here would
                // be head office silently choosing somebody's supplier, and a
                // client onboarded to the wrong fleet is a contract nobody
                // agreed to.
                if (! $this->filled('operator_id')) {
                    $validator->errors()->add('operator_id', 'Choose the fleet company that will serve this client.');
                }

                return;
            }

            // A fleet's own onboarding takes its own contract — it is the only
            // fleet they could mean. Naming another is refused rather than
            // ignored: silently rewriting it would let a fleet believe it had
            // onboarded a client for somebody else.
            if ($this->filled('operator_id') && (int) $this->input('operator_id') !== $actor->operator_id) {
                $validator->errors()->add('operator_id', 'A fleet can only onboard a client for itself.');
            }
        });
    }

    /** The fleet that takes the contract, resolved once so the caller cannot get it wrong. */
    public function contractingOperator(): int
    {
        /** @var User $actor */
        $actor = $this->user();

        return $actor->access_level === AccessLevel::KANGARU
            ? (int) $this->input('operator_id')
            : (int) $actor->operator_id;
    }
}
