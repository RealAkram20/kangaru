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
     * Added by ADR-0048 §1, on the terms this docblock already set.
     *
     * "A fifth type is one case here" was an invitation with a condition
     * attached, and the condition is the naming rule above: nothing in this
     * catalogue may be named for one country. A face is a face in Kampala and
     * in Nairobi, and a photograph of a car is not a jurisdiction's
     * paperwork. Both pass; *PSV badge* still does not.
     */
    case IDENTITY_SELFIE = 'identity_selfie';
    case VEHICLE_PHOTO = 'vehicle_photo';

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
            self::IDENTITY_SELFIE => 'Photo of you',
            self::VEHICLE_PHOTO => 'Photo of the vehicle',
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
            self::IDENTITY_SELFIE => 'Your face, in good light, so we can match it to your ID.',
            self::VEHICLE_PHOTO => 'The whole vehicle, with the number plate readable.',
        };
    }

    /**
     * Which headed section of the KYC screen this belongs under.
     *
     * Server-side because both the driver app and the console draw this list
     * (ADR-0048 §1, `DriverDocumentGroup`). A second copy of "which section
     * is a selfie in" is a copy that disagrees.
     */
    public function group(): DriverDocumentGroup
    {
        return match ($this) {
            self::IDENTITY_DOCUMENT, self::IDENTITY_SELFIE => DriverDocumentGroup::PERSONAL,
            self::DRIVING_LICENCE, self::VEHICLE_REGISTRATION,
            self::VEHICLE_INSURANCE => DriverDocumentGroup::DRIVER,
            self::VEHICLE_PHOTO => DriverDocumentGroup::VEHICLE,
        };
    }

    /**
     * The order the slots are drawn in, within and across groups.
     *
     * Fixed here rather than left to `cases()` so that the reading order a
     * reviewer relies on — identity, then the licence, then the vehicle —
     * does not change as a side effect of adding a case in the wrong place.
     */
    public function position(): int
    {
        return match ($this) {
            self::IDENTITY_DOCUMENT => 1,
            self::IDENTITY_SELFIE => 2,
            self::DRIVING_LICENCE => 3,
            self::VEHICLE_REGISTRATION => 4,
            self::VEHICLE_INSURANCE => 5,
            self::VEHICLE_PHOTO => 6,
        };
    }

    /**
     * The six types in the order a screen should draw them.
     *
     * @return array<int, self>
     */
    public static function ordered(): array
    {
        $cases = self::cases();

        usort($cases, static fn (self $a, self $b): int => [$a->group()->position(), $a->position()]
            <=> [$b->group()->position(), $b->position()]);

        return $cases;
    }

    /**
     * Whether this document only makes sense for a driver with a vehicle.
     *
     * **Nothing hides a slot on this today**, and that is deliberate: a
     * corporate driver in a depot car is still asked for the vehicle's papers,
     * because the depot's insurance certificate is a thing the office wants on
     * file against the person driving. It is here so a screen that wants to
     * *explain* the vehicle group has something true to say, and so a future
     * rule has one place to read rather than a list of type names copied into
     * a component.
     */
    public function concernsVehicle(): bool
    {
        return match ($this) {
            self::VEHICLE_INSURANCE, self::VEHICLE_REGISTRATION, self::VEHICLE_PHOTO => true,
            self::DRIVING_LICENCE, self::IDENTITY_DOCUMENT, self::IDENTITY_SELFIE => false,
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
            // A selfie and a photograph of a car have no date to lapse.
            // Asking for one would be a field inviting a driver to invent
            // something (ADR-0048 §1).
            self::IDENTITY_DOCUMENT, self::VEHICLE_REGISTRATION,
            self::IDENTITY_SELFIE, self::VEHICLE_PHOTO => false,
        };
    }
}
