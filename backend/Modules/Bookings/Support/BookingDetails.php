<?php

namespace Modules\Bookings\Support;

use Modules\Bookings\Enums\OrderRequestServiceType;
use Modules\Bookings\Models\Booking;

/**
 * The one place `bookings.details` is written or read (ADR-0064).
 *
 * The `OrderDetails` lesson, applied before the leak instead of after it:
 * a JSON column called `details` is precisely where a personal number ends
 * up emitted wholesale by a resource that looks innocent in review. So the
 * complete set of keys that can ever be stored or escape into a payload is
 * the constants below — greppable in one search, which is the only property
 * that makes an allow-list worth having.
 *
 * A booking's ride needs no details at all: the passenger, the count and the
 * vehicle preference are real columns already (ADR-0051), and a JSON copy of
 * any of them would be the two-fields-drifting bug by construction. The same
 * goes for self-drive's vehicle choice — it lives in `vehicle_category`,
 * validated against the live vocabulary, not in a stringly-typed copy here.
 */
class BookingDetails
{
    /**
     * What a parcel is and how it settles — plus the person at the far end,
     * who is not the sender and needs ringing. The sender needs no keys: a
     * delivery's `passenger_*` columns are the sender's snapshot, exactly as
     * a ride's are the traveller's.
     *
     * @var list<string>
     */
    public const DELIVERY_FIELDS = [
        'item_type',
        'package_size',
        'payer',
        'payment_method',
        'recipient_name',
        'recipient_phone',
        'confirm_with_pin',
    ];

    /**
     * The hire period, and which identity documents the renter will bring.
     * Not the documents themselves — the desk checks originals at collection
     * (owner's decision, 24 Aug 2026), same as the walk-in flow.
     *
     * @var list<string>
     */
    public const SELF_DRIVE_FIELDS = ['start_date', 'end_date', 'kyc_documents'];

    /**
     * The keys this service may carry. A ride carries none — see the class
     * docblock — and an empty list here is what makes a ride's `details`
     * store as null rather than as an empty object nobody meant.
     *
     * @return list<string>
     */
    public static function fieldsFor(OrderRequestServiceType $service): array
    {
        return match ($service) {
            OrderRequestServiceType::RIDE => [],
            OrderRequestServiceType::DELIVERY => self::DELIVERY_FIELDS,
            OrderRequestServiceType::SELF_DRIVE => self::SELF_DRIVE_FIELDS,
        };
    }

    /**
     * What gets written: the validated input, narrowed to this service's
     * keys, with empty values dropped. Null when nothing survives, so the
     * column can tell "a ride" from "a delivery nobody detailed".
     *
     * Narrowed here rather than trusted to validation, because validation
     * accepts every service's keys on every request — it cannot know that a
     * payload built for a delivery was submitted with `service_type: ride`
     * after somebody toggled the form, and the stale parcel keys must not
     * ride along into a row no reader will ever show them on.
     *
     * @param  array<string, mixed>|null  $input
     * @return array<string, mixed>|null
     */
    public static function toStore(OrderRequestServiceType $service, ?array $input): ?array
    {
        $kept = [];

        foreach (self::fieldsFor($service) as $field) {
            $value = $input[$field] ?? null;

            if ($value !== null && $value !== '') {
                $kept[$field] = $value;
            }
        }

        return $kept === [] ? null : $kept;
    }

    /**
     * What a reader gets: this service's keys, every one present, missing
     * values as null — one shape per service whatever the row happens to
     * hold. Null for a ride, whose absence of details is the fact itself.
     *
     * @return array<string, string|bool|null>|null
     */
    public static function for(Booking $booking): ?array
    {
        $fields = self::fieldsFor($booking->service_type);

        if ($fields === []) {
            return null;
        }

        $details = $booking->details ?? [];
        $emitted = [];

        foreach ($fields as $field) {
            $value = $details[$field] ?? null;

            // Cast, not trusted — the column is JSON and old rows outlive
            // validation rules. Booleans survive as booleans (confirm_with_pin
            // is one); anything else scalar becomes a string; anything nested
            // becomes null rather than an object nobody declared.
            $emitted[$field] = match (true) {
                is_bool($value) => $value,
                is_scalar($value) => (string) $value,
                default => null,
            };
        }

        return $emitted;
    }
}
