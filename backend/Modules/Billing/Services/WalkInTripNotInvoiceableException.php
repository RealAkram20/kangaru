<?php

namespace Modules\Billing\Services;

use Modules\Trips\Models\Trip;

/**
 * A walk-in customer's trip cannot be invoiced (ADR-0024).
 *
 * Not "not yet", which is `TripNotInvoiceableException` — **not ever**. The
 * invoicing path is corporate end to end: `invoices.tenant_id` is NOT NULL,
 * the document number series is per tenant, and the whole ledger answers
 * "what does this client owe". A walk-in has no client. Their fare is
 * computed from the rate card and settled at the roadside; ADR-0024 defers
 * walk-in settlement — cash, mobile money, a receipt — as work with its own
 * name on it.
 *
 * Thrown **before** the transaction in `InvoiceService::generateForTrip`,
 * and that placement is the point. The first thing that method does is
 * `ensureSeries($trip->tenant_id, ...)`, which with a null tenant either
 * creates a counter row belonging to nobody or dies with an integrity error
 * from three layers down. Either way the operator gets a database noise
 * message about a document number series for something they experienced as
 * pressing Invoice on a taxi ride.
 *
 * Surfaces as 409 TRIP_NOT_INVOICEABLE_WALK_IN.
 */
class WalkInTripNotInvoiceableException extends \RuntimeException
{
    public function __construct(public readonly Trip $trip)
    {
        parent::__construct(
            'This was a walk-in ride, so there is no client account to invoice. '
            .'Walk-in fares are settled with the customer directly.'
        );
    }
}