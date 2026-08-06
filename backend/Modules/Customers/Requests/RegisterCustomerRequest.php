<?php

namespace Modules\Customers\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Modules\Customers\Enums\CustomerGender;

/**
 * Customer registration (ADR-0013 §3). An unauthenticated write, so the
 * same suspicion as the public order form: every field capped, and the
 * email uniqueness stated here so the failure is a 422 the form can show,
 * not a 500 from the unique index.
 */
class RegisterCustomerRequest extends FormRequest
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
            // Split names (ADR-0015): the account screen greets people by
            // their given name, and "Hi, Nakato Grace" is nobody's idea of
            // being greeted.
            'first_name' => ['required', 'string', 'max:60'],
            'last_name' => ['required', 'string', 'max:60'],
            // Optional on purpose. Uganda's Data Protection and Privacy
            // Act, 2019 wants a stated purpose for every field we hold
            // (AGENTS.md); gender has one — a same-gender captain
            // preference — but that is a reason to offer the question, not
            // to compel an answer before somebody can book a taxi.
            'gender' => ['nullable', Rule::enum(CustomerGender::class)],
            // Same loose shape as the order form: a customer turned away
            // over phone formatting is a customer lost.
            'phone' => ['required', 'string', 'min:9', 'max:32', 'regex:/^[+0-9 ()-]+$/'],
            'email' => ['required', 'email', 'max:190', 'unique:customers,email'],
            'password' => ['required', 'string', 'min:8', 'max:255'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'email.unique' => 'An account with this email already exists. Log in instead.',
            'password.min' => 'Please choose a password of at least 8 characters.',
        ];
    }
}
