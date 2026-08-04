<?php

namespace Modules\Customers\Requests;

use Illuminate\Foundation\Http\FormRequest;

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
            'name' => ['required', 'string', 'max:120'],
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
