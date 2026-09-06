<?php

namespace Modules\Bookings\Requests;

use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Modules\Administration\Services\SettingsService;
use Modules\Bookings\Enums\OrderRequestServiceType;
use Modules\Bookings\Enums\RideVehicleClass;
use Modules\Fleet\Services\ZoneResolver;

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
            // ADR-0020 §2. Optional, and never required: an order taken over
            // the phone has no coordinates, and `places.ts` is explicit that
            // a geocoder outage degrades to plain text rather than an error
            // screen. Bounded to real coordinates so a client that sends
            // `[lng, lat]` the wrong way round is rejected rather than
            // silently placing a Kampala pickup in the Indian Ocean.
            'pickup_latitude' => ['nullable', 'numeric', 'between:-90,90', 'required_with:pickup_longitude'],
            'pickup_longitude' => ['nullable', 'numeric', 'between:-180,180', 'required_with:pickup_latitude'],
            'dropoff_latitude' => ['nullable', 'numeric', 'between:-90,90', 'required_with:dropoff_longitude'],
            'dropoff_longitude' => ['nullable', 'numeric', 'between:-180,180', 'required_with:dropoff_latitude'],
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
            // From the enum, so the classes the form may send, the classes the
            // quote endpoint prices, and the category each maps to cannot drift.
            'details.vehicle_class' => ['nullable', Rule::in(RideVehicleClass::values())],
            // Delivery
            'details.item_type' => [
                'nullable',
                Rule::in(['documents', 'food', 'parcel', 'electronics', 'furniture', 'appliances', 'other']),
            ],
            'details.package_size' => ['nullable', Rule::in(['small', 'medium', 'large', 'heavy'])],
            // Which end settles the bill, and on which rail. The rider is
            // told both before setting off — a parcel is the one service
            // where the person ordering is often not the person paying.
            'details.payer' => ['nullable', Rule::in(['sender', 'receiver'])],
            'details.payment_method' => ['nullable', Rule::in(['cash', 'mobile_money', 'card'])],
            // Both ends of a parcel as people the rider can ring. The sender
            // pair is absent whenever the account holder is the sender —
            // their name and number are already the contact fields.
            'details.sender_name' => ['nullable', 'string', 'max:120'],
            'details.sender_phone' => ['nullable', 'string', 'max:32', 'regex:/^[+0-9 ()-]+$/'],
            'details.recipient_name' => ['nullable', 'string', 'max:120'],
            'details.recipient_phone' => ['nullable', 'string', 'max:32', 'regex:/^[+0-9 ()-]+$/'],
            // Handover with a four-digit code rather than "left at the gate".
            'details.confirm_with_pin' => ['nullable', 'boolean'],
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
            // Which identity documents the renter has to hand, comma
            // separated. Not the documents themselves — there is no upload
            // endpoint yet, and the desk checks the originals at collection.
            'details.kyc_documents' => ['nullable', 'string', 'max:255'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            $this->refusePickupOutsideServiceArea($validator);
        });
    }

    /**
     * Refuses a pickup that is nowhere the platform operates (ADR-0021).
     *
     * This is the check ADR-0020 could not write. Range validation cannot
     * catch a swapped Kampala pair — 0.3476/32.5825 reversed is a point off
     * the coast of Ghana with *both values still in range* — but a service
     * area can, because Ghana is not in it.
     *
     * Silent when no service area has been drawn. An operator who has not
     * yet mapped their coverage must not have every order refused, and a
     * rule that switched itself on the day somebody saved their first zone
     * would be worse than no rule.
     */
    private function refusePickupOutsideServiceArea(Validator $validator): void
    {
        $lat = $this->input('pickup_latitude');
        $lng = $this->input('pickup_longitude');

        if ($lat === null || $lng === null) {
            return;
        }

        if (app(ZoneResolver::class)->withinServiceArea((float) $lat, (float) $lng)) {
            return;
        }

        $validator->errors()->add(
            'pickup_latitude',
            'That pickup is outside the area we cover. Check the location and try again.',
        );
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
