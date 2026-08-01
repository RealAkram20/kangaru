<?php

namespace Modules\Billing\Enums;

use Brick\Math\RoundingMode as BrickRoundingMode;

/**
 * The rounding rules a rate card version may choose from (AGENTS.md:
 * "Rounding rules are defined per rate card ... The rounding rule used is
 * stored on the invoice line").
 *
 * A deliberately small subset of Brick\Math\RoundingMode: these are the four
 * a commercial rate card can justify to a client. `Unnecessary` is excluded
 * because it throws rather than rounds, and the directional Ceiling/Floor
 * modes are excluded because on non-negative money they duplicate Up/Down.
 *
 * Persisted as a string; never renumber or repurpose a case — issued
 * invoice lines reference these values forever.
 */
enum RoundingMode: string
{
    case HALF_UP = 'half_up';
    case HALF_DOWN = 'half_down';
    case UP = 'up';
    case DOWN = 'down';

    public function toBrick(): BrickRoundingMode
    {
        return match ($this) {
            self::HALF_UP => BrickRoundingMode::HalfUp,
            self::HALF_DOWN => BrickRoundingMode::HalfDown,
            self::UP => BrickRoundingMode::Up,
            self::DOWN => BrickRoundingMode::Down,
        };
    }

    public function label(): string
    {
        return match ($this) {
            self::HALF_UP => 'Round half up to the nearest shilling',
            self::HALF_DOWN => 'Round half down to the nearest shilling',
            self::UP => 'Always round up to the nearest shilling',
            self::DOWN => 'Always round down to the nearest shilling',
        };
    }

    /**
     * The platform default, used when a rate card version does not state a
     * rounding rule. Falls back to half-up (AGENTS.md's stated default) if
     * configuration names something this enum does not have, rather than
     * throwing while pricing a trip.
     */
    public static function default(): self
    {
        /** @var string $configured */
        $configured = config('money.default_rounding', self::HALF_UP->value);

        return self::tryFrom($configured) ?? self::HALF_UP;
    }
}
