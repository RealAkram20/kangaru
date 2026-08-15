<?php

namespace Modules\Drivers\Enums;

/**
 * The papers a driver has to hold (ADR-0033 §1).
 *
 * **None of these is named for one country, and that is the whole point of the
 * naming.** The mockup that prompted this feature is Kampala's, and the
 * obvious East African list — *PSV badge*, *logbook*, *third-party sticker* —
 * was deliberately not used. AGENTS.md and PRODUCT.md both require that
 * nothing new deepen the Uganda assumption, and a type enum is exactly the
 * kind of thing that quietly does: it lands in a database column, an OpenAPI
 * enum and every shipped handset, and is then untouchable.
 *
 * `identity_document` covers a national ID in Kampala and a passport in
 * Nairobi with no migration between them.
 *
 * The set is **closed and short on purpose**. An operator-configurable
 * catalogue is a reference table, a settings screen and a per-tenant override,
 * and every one of those is a thing to maintain in exchange for flexibility
 * nobody has asked for. A fifth type is one case here.
 */
enum DriverDocumentType: string
{
    case DRIVING_LICENCE = 'driving_licence';
    case IDENTITY_DOCUMENT = 'identity_document';
    case VEHICLE_INSURANCE = 'vehicle_insurance';
    case VEHICLE_REGISTRATION = 'vehicle_registration';

    /**
     * @return array<int, string>
     */
    public static function values(): array
    {
        return array_map(static fn (self $case): string => $case->value, self::cases());
    }

    public function label(): string
    {
        return match ($this) {
            self::DRIVING_LICENCE => 'Driving licence',
            self::IDENTITY_DOCUMENT => 'Identity document',
            self::VEHICLE_INSURANCE => 'Vehicle insurance',
            self::VEHICLE_REGISTRATION => 'Vehicle registration',
        };
    }

    /**
     * What a driver should photograph, in their words rather than ours.
     *
     * The app shows this under the type name. "Identity document" on its own
     * is a phrase from a schema; a driver holding a national ID needs to be
     * told that is the thing.
     */
    public function hint(): string
    {
        return match ($this) {
            self::DRIVING_LICENCE => 'Both sides if the details are split across them.',
            self::IDENTITY_DOCUMENT => 'A national ID, passport, or whatever your country issues.',
            self::VEHICLE_INSURANCE => 'The current certificate for the vehicle you drive.',
            self::VEHICLE_REGISTRATION => 'Proof the vehicle is registered to its owner.',
        };
    }

    /**
     * Whether the document is meaningless without a date.
     *
     * A licence and an insurance certificate *are* their expiry — a verified
     * one that lapsed last month is not a verified one. An identity document
     * and a registration may or may not carry a date depending on the country,
     * which is why they are optional rather than absent: an expiry that exists
     * is still worth recording.
     */
    public function requiresExpiry(): bool
    {
        return match ($this) {
            self::DRIVING_LICENCE, self::VEHICLE_INSURANCE => true,
            self::IDENTITY_DOCUMENT, self::VEHICLE_REGISTRATION => false,
        };
    }
}
