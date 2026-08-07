<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Assumed trip duration
    |--------------------------------------------------------------------------
    |
    | How long a booking is assumed to occupy a driver and vehicle when
    | availability is judged (ADR-0017). A trip's real duration is not
    | knowable before it happens, so this is an assumption — and, per
    | AGENTS.md's configuration-driven rule, a setting rather than a literal
    | buried in a service.
    |
    | Too short and a driver is offered two jobs that overlap; too long and
    | a fleet looks busier than it is and dispatchers start ignoring the
    | availability flag, which is worse than not having one. Two hours suits
    | Kampala-and-upcountry work; revise it against real completed-trip
    | durations once there are enough of them to measure, which is what
    | Modules/Reports' fleet activity report is for.
    |
    */

    'assumed_trip_minutes' => (int) env('DISPATCH_ASSUMED_TRIP_MINUTES', 120),

    /*
    |--------------------------------------------------------------------------
    | Automatic dispatch (ADR-0020)
    |--------------------------------------------------------------------------
    |
    | AGENTS.md: "Feature flags for anything client-visible and risky;
    | dispatch algorithm changes always ship behind a flag." This is that
    | flag, and it gates only the *committing* endpoint.
    |
    | The recommendation endpoint is always available, deliberately: a
    | suggestion a dispatcher reads and acts on is how an operator builds
    | confidence in a matcher before it is allowed to act alone, and it can
    | do no harm. Turning this on lets `POST /bookings/{id}/auto-assignment`
    | commit the top suggestion — through the same locked path a human uses.
    |
    | Off by default. A matcher that has never been watched making choices
    | on real bookings should not be making them unattended.
    |
    */

    'automatic_enabled' => (bool) env('DISPATCH_AUTOMATIC_ENABLED', false),

];
