<?php

namespace Modules\Dispatch\Services;

use Modules\Dispatch\Models\DispatchOffer;

/**
 * The offer cannot be answered any more (ADR-0024 §3).
 *
 * Three ways to arrive here, and they are deliberately one exception rather
 * than three: the clock ran out, another driver accepted first, or the desk
 * fulfilled the order by hand. From the driver's side they are the same
 * event — the job is gone — and splitting them would put the platform's
 * internal bookkeeping on somebody's screen while they are driving.
 *
 * Surfaces as 409 OFFER_NO_LONGER_OPEN. A 409 rather than a 422 for the
 * reason `DispatchController` gives about its own conflicts: the request was
 * perfectly valid, the world simply moved underneath it.
 */
class OfferNoLongerOpenException extends \RuntimeException
{
    public function __construct(public readonly DispatchOffer $offer)
    {
        parent::__construct('This job has already been taken. Watch for the next one.');
    }
}
