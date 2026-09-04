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

    /*
    |--------------------------------------------------------------------------
    | Driver presence (ADR-0024 §2)
    |--------------------------------------------------------------------------
    |
    | Where a driver is *while they are waiting for work*, which is a
    | different question from `live_positions` — that one answers "where is
    | this vehicle on this trip" and is written by the GPS pipeline, which
    | only runs from Trip Started. Before ADR-0024 an idle driver reported
    | nothing at all, so "the nearest driver" was a question with no data
    | behind it.
    |
    | `presence_driver` selects the store, exactly as
    | `tracking.live_positions_driver` does, so a deployment with Redis says
    | so once and nothing in the codebase asks whether Redis exists.
    |
    */

    'presence_driver' => env('DISPATCH_PRESENCE_DRIVER', 'database'),

    /*
    | How long a presence record is trusted.
    |
    | Past this, a driver is treated as **absent** rather than as "available
    | at the last place they were seen". The failure mode of the alternative
    | is specific and bad: a phone that lost signal at 07:00 keeps winning
    | the proximity ranking all morning, and every order routed to it times
    | out while the passenger watches a spinner.
    |
    | Comfortably more than `presence_heartbeat_seconds` below, so an
    | ordinary missed heartbeat — a tunnel, a garbage collection pause —
    | does not take a working driver out of the pool.
    */

    'presence_ttl_seconds' => (int) env('DISPATCH_PRESENCE_TTL_SECONDS', 180),

    /*
    | How often the app should report in while on duty and not on a trip.
    |
    | Served to the client rather than hardcoded in it, so the cadence can be
    | tuned against real battery data without shipping a new build to every
    | handset — the same reason the trip lifecycle is served as
    | `allowed_transitions` instead of duplicated in the app.
    |
    | Deliberately far coarser than trip GPS. That stream is billing
    | evidence sampled for a route; this is a dispatch radius sampled for a
    | ranking, and running the fine-grained one all day to answer the coarse
    | question is how a driver's battery dies before lunch. A driver whose
    | battery died is off duty for the rest of the shift whatever this
    | database says.
    */

    'presence_heartbeat_seconds' => (int) env('DISPATCH_PRESENCE_HEARTBEAT_SECONDS', 60),

    /*
    |--------------------------------------------------------------------------
    | Walk-in dispatch (ADR-0024 §4 and §6)
    |--------------------------------------------------------------------------
    |
    | On by default, which is the opposite of `automatic_enabled` above and
    | needs its reason stated rather than assumed.
    |
    | That flag is off because it changes how *corporate bookings* are
    | dispatched — an existing, working, human-operated flow on accounts with
    | commercial agreements behind them, where a matcher acting unattended is
    | a new risk taken on somebody else's behalf. This one governs a flow
    | that does not exist yet: a walk-in order today reaches a telephone.
    | Shipping it switched off would ship a feature nobody can use, and its
    | failure mode is the status quo the desk is already staffed for.
    |
    | The two are separate settings and neither reads the other.
    |
    */

    'walk_in_auto_dispatch' => (bool) env('DISPATCH_WALK_IN_AUTO', true),

    /*
    | How long a driver has to answer an offer.
    |
    | The passenger is standing on a kerb watching a spinner, so this is
    | short; a driver may be mid-junction when it arrives, so it is not
    | *that* short.
    |
    | **Forty-five seconds, raised from fifteen when the offer started
    | arriving on a locked phone (ADR-0046).** Fifteen was chosen against a
    | driver who was already looking at the app, and it was the right number
    | for that: the industry's rough consensus, with the offer polled every
    | five seconds into a screen somebody was holding. It is the wrong number
    | for a phone face-down in a cradle or in a pocket. The sequence a ring
    | now has to survive is *notification wakes the handset, the driver
    | notices, reaches, looks, reads a pickup and decides* — and fifteen
    | seconds is not enough for it. A driver who misses offers they were
    | never realistically able to answer is a driver who concludes the app
    | does not work, which costs the fleet far more than a slower hand-off.
    |
    | Forty-five is roughly how long a WhatsApp call rings, which is not a
    | coincidence: it is the same problem, and that number has been tuned
    | against human reaction times by people with more data than we have.
    |
    | **The cost is real and is paid by the passenger.** Worst case before an
    | order reaches the human queue is `offer_ttl_seconds * offer_max_rounds`
    | — see the note on that key, which was cut from five rounds to three in
    | the same change so the total went to 2m15s rather than 3m45s.
    |
    | Tune it against real accept latencies once there are enough of them to
    | measure. It is a starting point, not a finding.
    |
    | Every read compares against the stored `expires_at` rather than
    | recomputing from this, so changing it never retroactively expires
    | offers that are already out.
    */

    'offer_ttl_seconds' => (int) env('DISPATCH_OFFER_TTL_SECONDS', 45),

    /*
    | How many drivers are offered a ride at once.
    |
    | One, deliberately. Broadcasting to everyone nearby produces a single
    | winner and N-1 drivers who dropped what they were doing for nothing,
    | which is how a fleet learns to ignore offers — and it turns every
    | dispatch into a contended write on the same rows.
    |
    | It is genuinely better on a thin night when the nearest driver is
    | eleven minutes away, so it is a number rather than an `if`. The code
    | offers *a wave*; the wave happens to be one driver.
    */

    'offer_wave_size' => (int) max(1, (int) env('DISPATCH_OFFER_WAVE_SIZE', 1)),

    /*
    | How many waves before the matcher gives up.
    |
    | When this is exhausted the order is not dropped: it returns to the
    | human queue ADR-0012 built, which a dispatcher is already watching, and
    | the customer's screen says so. A matcher that gives up loudly is one an
    | operator can trust; one that gives up quietly is one they stop using.
    |
    | **Three, cut from five when `offer_ttl_seconds` went to 45 (ADR-0046).**
    | These two multiply, and only their product is felt by anybody: it is
    | how long a passenger watches a spinner before a human takes over. Five
    | rounds of forty-five seconds is 3m45s of silence, which is longer than
    | most people will wait before phoning the office — at which point the
    | matcher has produced a worse outcome than not running.
    |
    | Three keeps that at 2m15s, close to the 1m15s the old pair produced,
    | and the rounds given up are the least valuable ones: by the fourth wave
    | the matcher is offering to drivers it ranked well below the first, and
    | a dispatcher who knows the ground beats a fourth-choice automatic offer.
    */

    'offer_max_rounds' => (int) max(1, (int) env('DISPATCH_OFFER_MAX_ROUNDS', 3)),

    /*
    | How long an unfulfilled order keeps being re-offered.
    |
    | `dispatch()` runs once, when the order arrives. If nobody was on duty
    | at that instant it finds nothing — and without a retry the order is
    | never revisited, because the sweep only knows about offers and there
    | are none. A passenger who ordered thirty seconds before a driver signed
    | on watched a spinner until they gave up. That was observed, not
    | theorised.
    |
    | Bounded, because a ride somebody asked for this morning is not one to
    | send a driver to this afternoon. Past the window the order is the
    | desk's to phone about — which is where ADR-0024 §4 puts an exhausted
    | search anyway.
    */

    'offer_retry_window_minutes' => (int) max(1, (int) env('DISPATCH_OFFER_RETRY_WINDOW_MINUTES', 30)),

    /*
    |--------------------------------------------------------------------------
    | Waiting at the pickup
    |--------------------------------------------------------------------------
    |
    | How long a driver is expected to stand at a pickup before the wait is
    | worth someone's attention. The driver app draws its waiting ring
    | against this.
    |
    | **This is a display target and nothing else, and the distinction is the
    | whole reason for this comment.** Nothing in this platform charges,
    | bounds or ends a wait at the kerb:
    |
    | - `free_waiting_minutes` and `per_waiting_minute_minor` on the rate
    |   card bill the *in-trip* Waiting status. `WaitingTimeCalculator` opens
    |   a period on a transition **into** `TripStatus::WAITING`, which the
    |   state graph only permits after Trip Started — so none of it can
    |   describe a driver waiting for a passenger to come out.
    | - No status follows from this elapsing. The driver cannot post
    |   `no_show` (`TripPolicy::DRIVER_JOURNEY_STATES` withholds it) and
    |   nothing sweeps a trip that sits at Driver Arrived.
    |
    | So passing it must not read as a deadline anywhere: the app's ring
    | fills to full and then *stays* full while the figure keeps counting.
    | Whoever gives this number a consequence — a no-show, a waiting charge,
    | a fee — is making a commercial decision that needs its own ADR, and
    | they should find this paragraph first.
    |
    | Five minutes is a starting point chosen against nothing but common
    | practice, and it is a setting rather than a literal so that arguing
    | with it costs an env var instead of a release.
    */

    'pickup_wait_target_seconds' => (int) max(1, (int) env('DISPATCH_PICKUP_WAIT_TARGET_SECONDS', 300)),

];
