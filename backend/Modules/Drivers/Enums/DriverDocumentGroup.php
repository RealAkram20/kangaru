<?php

namespace Modules\Drivers\Enums;

/**
 * How the six document types are grouped on a screen (ADR-0048 §1).
 *
 * The KYC mockup draws three headed sections — *Personal Information*,
 * *Driver Information*, *Vehicle Information* — and six slots under them.
 * That grouping is **server-side and shared** rather than hardcoded per
 * screen, for the reason `docs/screen-rules.md` §3 gives about things that
 * appear twice: the driver app and the console both draw this list, and two
 * copies of "which section is a selfie in" would disagree the first time a
 * seventh type is added.
 *
 * It also keeps the *order* in one place. A reviewer reading a stranger's
 * papers wants identity first and the vehicle last, every time, on both
 * surfaces.
 *
 * This is presentation, not authority. Nothing branches on a group — no
 * policy, no requirement, no compliance state. If a rule ever wants "all the
 * vehicle documents", it should say so in its own terms rather than borrow a
 * heading.
 */
enum DriverDocumentGroup: string
{
    case PERSONAL = 'personal';
    case DRIVER = 'driver';
    case VEHICLE = 'vehicle';

    public function label(): string
    {
        return match ($this) {
            self::PERSONAL => 'Personal information',
            self::DRIVER => 'Driver information',
            self::VEHICLE => 'Vehicle information',
        };
    }

    /**
     * The order the sections are drawn in, low first.
     *
     * An integer rather than relying on `cases()` order, so that reordering
     * the sections is not the same edit as reordering the enum — which is
     * also the `values()` a stored column is validated against.
     */
    public function position(): int
    {
        return match ($this) {
            self::PERSONAL => 1,
            self::DRIVER => 2,
            self::VEHICLE => 3,
        };
    }
}
