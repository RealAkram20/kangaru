<?php

namespace Modules\Bookings\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Modules\Administration\Services\SettingsService;
use Modules\Bookings\Enums\OrderRequestServiceType;

/**
 * The public order form (ADR-0012 §3). Unauthenticated, so validated with
 * *more* suspicion than a tenant endpoint, not less: every field capped,
 * every enum closed, and the per-service requireds expressed here rather
 * than trusted to the frontend's steps.
 *
 * The honeypot (`website`) is deliberately NOT validated here — a bot that
 * fills it should sail through validation and receive a convincing success,
 * which is the controller's trick to play, not a 422 that teaches the bot
 * which field to skip.
 */
class StorePublicOrderRequest extends FormRequest
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
        $service = $this->input('service_type');

        return [
            'service_type' => ['required', Rule::enum(OrderRequestServiceType::class)],
            'contact_name' => ['required', 'string', 'max:120'],
            // Loose on purpose: Ugandan numbers arrive as 07..., +2567...,
            // or 2567..., and a visitor turned away over formatting is a
            // customer lost. The dispatcher dials it either way.
            'contact_phone' => ['required', 'string', 'min:9', 'max:32', 'regex:/^[+0-9 ()-]+$/'],
            'contact_email' => ['nullable', 'email', 'max:190'],
            'pickup_location' => [
                Rule::requiredIf(in_array($service, ['ride', 'delivery'], true)),
                'nullable', 'string', 'max:255',
            ],
            'dropoff_location' => [
                Rule::requiredIf(in_array($service, ['ride', 'delivery'], true)),
                'nullable', 'string', 'max:255',
            ],
            // Same advance cap as staff bookings (ADR-0014 phase 2): the
            // dispatcher who calls back should not be promising next year.
            'scheduled_for' => [
                'nullable', 'date', 'after:now',
                'before:+'.((int) app(SettingsService::class)->get('booking', 'max_advance_days')).' days',
            ],
            'notes' => ['nullable', 'string', 'max:1000'],

            'details' => ['nullable', 'array'],
            // Ride
            'details.passengers' => ['nullable', 'integer', 'min:1', 'max:14'],
            'details.vehicle_class' => [
                'nullable', Rule::in(['economy', 'standard', 'xl', 'boda', 'electric_boda']),
            ],
            // Delivery
            'details.item_type' => [
                'nullable',
                Rule::in(['documents', 'food', 'parcel', 'electronics', 'furniture', 'appliances', 'other']),
            ],
            'details.package_size' => ['nullable', Rule::in(['small', 'medium', 'large', 'heavy'])],
            'details.recipient_name' => ['nullable', 'string', 'max:120'],
            'details.recipient_phone' => ['nullable', 'string', 'max:32', 'regex:/^[+0-9 ()-]+$/'],
            // Self drive
            'details.vehicle_category' => ['nullable', Rule::in(['sedan', 'suv', 'van', 'pickup'])],
            'details.start_date' => [
                Rule::requiredIf($service === 'self_drive'),
                'nullable', 'date', 'after_or_equal:today',
            ],
            'details.end_date' => [
                Rule::requiredIf($service === 'self_drive'),
                'nullable', 'date', 'after_or_equal:details.start_date',
            ],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'contact_phone.required' => 'Please give us a phone number — a dispatcher confirms every order by phone.',
            'pickup_location.required' => 'Please tell us where we should pick up.',
            'dropoff_location.required' => 'Please tell us where this is going.',
            'details.start_date.required' => 'Please choose the day your rental starts.',
            'details.end_date.required' => 'Please choose the day your rental ends.',
        ];
    }
}
