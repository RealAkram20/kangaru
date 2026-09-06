<?php

namespace Modules\Drivers\Services;

use Modules\Drivers\Models\DriverClosureRequest;

/**
 * Somebody has already answered this closure request (ADR-0043).
 *
 * Surfaces as `409 CLOSURE_REQUEST_ALREADY_DECIDED`. Almost always a second
 * reviewer acting on a queue they loaded before a colleague answered the same
 * row — the race the service takes a lock to lose safely.
 *
 * **Losing it safely matters more here than on most queues.** A second confirm
 * would detach a sign-in that is already gone and stamp a later `closed_at`,
 * moving the retention clock ADR-0043 §3 measures from.
 *
 * The message names the outcome rather than saying "decided", because the
 * reviewer's next move differs: a confirmed request has closed an account, a
 * declined one has not.
 */
class ClosureRequestAlreadyDecidedException extends \RuntimeException
{
    private function __construct(string $message)
    {
        parent::__construct($message);
    }

    public static function forRequest(DriverClosureRequest $request): self
    {
        return new self(sprintf(
            'This request was already answered — %s. Refresh the queue; somebody else may have got to it.',
            mb_strtolower($request->status->label()),
        ));
    }
}
