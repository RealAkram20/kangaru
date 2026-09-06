<?php

namespace Modules\Clients\Services;

use App\Enums\ErrorCode;
use RuntimeException;

/**
 * A route was saved naming a place or a person this client does not have.
 *
 * Thrown by `ClientRouteService` after the request layer has already
 * checked that the ids *exist*, because "exists" and "is yours" are
 * different questions and only the second one matters here. The tenant
 * scope answers it, and this is what the answer sounds like when it is no.
 *
 * **It throws rather than dropping the stranger silently.** A save that
 * quietly discarded one ATM would hand back a circuit shorter than the one
 * the officer drew, with a success message on it — and the missing stop
 * would be noticed by a driver, in the field, on a Monday. Kept as a plain
 * domain exception caught by the controller, like
 * `InvalidTripTransitionException`.
 *
 * ## Why the ids come back as strings under a field name
 *
 * `ErrorEnvelope.errors` is an `EmptyableStringListMap` — the shape
 * Laravel's own validation failures use, and the shape every client on this
 * platform already knows how to read. Keying by the request field means the
 * builder can highlight the offending stops without a second branch for
 * this one error code.
 */
class ClientRouteReferenceException extends RuntimeException
{
    /**
     * @param  array<int, string>  $values  Offending ids, as strings — see
     *                                      the class docblock.
     */
    private function __construct(
        // `$errorCode`, not `$code`: `Exception` already declares a
        // non-readonly `$code` and PHP refuses to redeclare it readonly.
        // Worth the awkward name — the alternative is dropping `readonly`
        // on a value that must not change between throw and render.
        public readonly ErrorCode $errorCode,
        public readonly string $field,
        public readonly array $values,
        string $message,
    ) {
        parent::__construct($message);
    }

    /**
     * @param  array<int, int>  $ids
     */
    public static function places(array $ids): self
    {
        return new self(
            ErrorCode::UNKNOWN_CLIENT_PLACE,
            'stops',
            array_map(strval(...), array_values($ids)),
            'This route refers to a saved place that is not one of yours. Refresh the page and try again — it may have been removed by a colleague.',
        );
    }

    /**
     * @param  array<int, int>  $ids
     */
    public static function members(array $ids): self
    {
        return new self(
            ErrorCode::UNKNOWN_ROUTE_MEMBER,
            'member_ids',
            array_map(strval(...), array_values($ids)),
            'This route names somebody who is not in your organisation. Refresh the page and try again — their account may have been closed.',
        );
    }

    /**
     * The envelope's `errors` map, built here so the controller has no
     * shape to get wrong.
     *
     * @return array<string, array<int, string>>
     */
    public function errors(): array
    {
        return [$this->field => $this->values];
    }
}
