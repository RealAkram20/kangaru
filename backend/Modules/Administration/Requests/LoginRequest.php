<?php

namespace Modules\Administration\Requests;

use App\Support\Auth\ClientScope;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class LoginRequest extends FormRequest
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
            // ADR-0022. Which app is asking, so the token can be scoped to
            // that app's surface. Optional and defaulting to `console`, so
            // every existing client keeps the unscoped token it has always
            // had and nothing broke on the day this shipped.
            'client' => ['sometimes', Rule::in(ClientScope::clients())],
            'email' => ['required', 'email'],
            'password' => ['required', 'string'],
        ];
    }
}
