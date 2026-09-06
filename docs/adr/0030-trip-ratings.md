# ADR-0030: Trip ratings

**Status:** Accepted (14 August 2026)

**Depends on:** ADR-0013 (customer accounts — the only principal who can
rate), ADR-0024 (walk-in fulfilment — the trips that have a customer on
them), ADR-0022 (token scope).

## Context

The Driver App's home screen shows a rating. Nothing on this platform has
ever asked anybody for one, so it rendered an em dash.

The gap is worth closing carefully rather than quickly. A rating is the one
number on that screen that is *about the driver as a person* rather than
about their work, and drivers in this market are acutely aware that a score
can end their income. Whatever this platform starts collecting, it will be
read that way from the first day.

## Decision

**The customer rates the driver, once, after the trip completes. One to five
stars, optional, immutable. The driver's score is the mean of their recent
ratings, and is withheld until there are enough of them to mean anything.**

### 1. Who may rate, and only then

`POST /api/v1/customer/trips/{trip}/rating`, on the `customer` guard
(ADR-0013 §2).

Three conditions, all necessary:

- the trip's `customer_id` is the caller — you rate your own ride;
- the trip is `trip_completed` — a rating before the end is a rating of a
  journey that has not happened, and rating a cancelled trip is a way to
  punish a driver for a decision that may have been the passenger's;
- no rating exists for that trip yet.

There is no staff route to write one. An office that can score its own
drivers has a rating that measures the office, and the value of a passenger
rating is precisely that it does not.

### 2. Immutable, and honest about why

A rating cannot be edited or withdrawn. That is the strict choice, and it is
taken because the alternative is worse in this specific market: an editable
rating is a lever, and a driver who knows a passenger can revise a score
downward after the fact has been handed a reason to accommodate demands that
have nothing to do with driving.

A mistaken rating is corrected the way every other mistake here is — by an
administrator, with an audit trail, through a deletion that is visible.

### 3. Withheld until it means something

`GET /me/stats` returns `rating` as **null until five ratings exist**, and
the app renders null as an em dash.

One three-star rating is not a 3.0; it is one person's afternoon. Publishing
it as a score invites a driver to read a single bad interaction as a
permanent standing, and invites the office to act on noise. Five is a
judgement call, stated here so it can be argued with rather than discovered
in the code.

`rating_count` is returned alongside, so the app can say how many the score
rests on rather than presenting a bare number.

### 4. The mean of the recent, not of all time

The score is the mean of the **last 50 ratings**. Same reasoning as
ADR-0029's rolling window and the acceptance rate before it: a score
computed over all time stops being feedback and becomes a brand, and a
driver who has improved cannot demonstrate it.

### 5. Stored per trip, not aggregated onto the driver

`trip_ratings`: `trip_id` (unique), `customer_id`, `driver_id`, `stars`
(1–5), `comment` (nullable, 500), timestamps.

`driver_id` is denormalised deliberately — it is the query this exists to
serve, and the trip's driver can be reassigned, which must not silently move
a rating from the person who earned it to somebody who did not.

No aggregate column on `drivers`, for the reason ADR-0029 §1 gives about
balances: a number with no history cannot be disputed.

### 6. What the driver may see

The score, the count, and nothing else. **Not who rated them, and not when a
specific rating arrived** — a driver who can tie a one-star to a passenger
and a time has been handed the means to retaliate, and the pickup address is
in the trip record.

Comments are collected but not exposed to the driver in this phase. They are
for the office; releasing free text written about a named person to that
person is its own decision and this ADR does not make it.

## Consequences

Drivers get a rating that comes from the people they actually carried. The
office gets a signal it did not have, and the comments behind it.

Only walk-in rides can be rated, because they are the trips with a customer
account attached (ADR-0024 §1). A corporate trip's passenger is an employee
of a client and has no account here; rating them is a different feature with
a different principal.

`trip_ratings` is a new table this ADR owns. `GET /me/stats` gains `rating`
and `rating_count`.

## Alternatives considered

**The office rates drivers.** Rejected in §1: it measures the office.

**Driver rates the passenger too.** Wanted eventually, and out of scope: it
needs its own decision about what a passenger's score is *for*, and a score
nobody acts on is data collected for its own sake.

**Show the score from the first rating.** Rejected in §3 — one rating is not
a score.

**Let a customer amend a rating.** Rejected in §2, on the specific ground
that it converts a rating into leverage over a driver.

**An aggregate column on `drivers`.** Rejected in §5, same reasoning as
ADR-0029 §1.
