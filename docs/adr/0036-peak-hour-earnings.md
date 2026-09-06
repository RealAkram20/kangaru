# ADR-0036 — Peak-hour earnings

**Status:** Accepted
**Date:** 2026-08-15
**Supersedes:** ADR-0029 §6, in part — the same narrow claim ADR-0034
superseded, extended once more. See *Relationship to ADR-0029 and ADR-0034*.
**Related:** ADR-0029 (the driver ledger), ADR-0034 (tips and bonuses),
ADR-0037 (referrals), ADR-0026 (walk-in pricing).

## Context

A driver-app mockup for a **Promotions** screen draws a *Peak Hours* card:
**"Earn 20% more · Today, 5 PM – 8 PM."**

Nothing on this platform could produce it. `DriverEarningsService`'s docblock
said so by name — *"no bonus, incentive, surge, streak or target anywhere in
the backend"* — and ADR-0034 removed only the first two words of that sentence.

The nearest real thing was misleading rather than close. `rate_card_versions`
carries `night_starts_at`, `night_ends_at` and `night_multiplier_bp`, and a
driver *does* earn more on a night trip, because their commission share is a
percentage of a larger fare. But that is a **tariff**: it raises what the
passenger pays, it is set per rate card and vehicle category, and it is a
pricing decision belonging to Billing. Labelling it "earn 20% more" on a
driver's screen would describe a price rise to the person who does not pay it.

The owner was given three options — draw the night rate honestly, drop the
card, or build a real scheme — and chose to **build a real scheme**.

## Relationship to ADR-0029 and ADR-0034

ADR-0029 §6 says of the driver ledger: *"No gateway, no mobile money, no
automatic payout, no invoice to a driver."* Unchanged here, and untouched: no
money moves through this platform. A peak uplift is an amount the office comes
to owe a driver, recorded as a credit and settled through the same cash
handover as everything else — exactly as ADR-0034's bonus is.

What is superseded is the same narrower claim ADR-0034 dealt with: that no
incentive of any kind exists. ADR-0034 removed *tips* and *bonuses* from that
sentence. This removes *surge*.

## Decision

### 1. It pays a percentage of the driver's share, not of the fare

The uplift is computed on `fare_earned` — what the driver actually made on the
trip after commission — and never on the gross fare.

This is the difference between a scheme whose cost the office can predict and
one whose cost tracks the tariff. A percentage of the gross would also mean an
expensive corporate journey paid a larger incentive than three short rides that
took the same three hours, which rewards the dispatch board rather than the
driver's evening.

**Nothing here changes what a passenger pays.** The tariff is untouched, the
night multiplier is untouched, and no invoice line moves. The uplift is the
platform's own money.

### 2. The window is a daily one, in the fleet's timezone

`billing.peak_starts_at` and `billing.peak_ends_at`, as `HH:MM`, resolved
against `settings.regional.timezone`.

**Modelled deliberately on `rate_card_versions.night_starts_at` / `_ends_at`**,
down to the lexicographic string comparison and the explicit handling of a
window that wraps past midnight. A second way of writing "a window of the day"
is a second way of getting the wrap wrong, and 22:00–02:00 is a plausible peak
in a nightlife district rather than a misconfiguration.

Two boundary rules, both chosen against silent failure:

- **Half open at the top.** A trip completing at exactly `peak_ends_at` is
  outside. The alternative leaves a one-second overlap where one window ends
  and the next begins — the kind of boundary nobody tests and everybody
  eventually hits.
- **Equal bounds are an empty window, not a whole day.** An operator who sets
  both to 17:00 has described no window; reading that as "always" would pay the
  uplift on every trip on the platform, which is the most expensive possible
  interpretation of a typo.

### 3. It is decided on `completed_at`, never on the clock

The uplift is written inside `DriverLedgerService::recordCompletedTrip()`'s
existing transaction, as a third entry beside the fare pair, and qualification
is tested against the trip's own `completed_at`.

**A rule that consulted "now" would pay a driver by their signal rather than by
their hours.** The driver app queues completions through the offline outbox
(ADR-0023), so a trip finished at 19:50 in a basement car park may reach the
server at 20:30 — and under a clock-based rule that driver silently loses the
uplift they earned, with nothing anywhere recording why.

Writing it in that transaction rather than in a second listener is what makes
it idempotent: `driver_ledger_entries`' unique index on `(trip_id, kind)` is
the guard that stops a retried completion paying twice, and it only protects
rows written under the lock that method already holds.

A trip with no `completed_at` earns nothing. The platform does not know when it
finished, and `docs/screen-rules.md` §1's refusal to invent a value applies to
a timestamp the money turns on as much as to a figure on a screen.

### 4. `peak_earned` is its own ledger kind, unpaired

**Its own kind, not a larger `fare_earned`.** The fare entry states the
driver's share *at the commission rate written into its own description*
(ADR-0029 §3); folding an uplift into it would make that sentence stop adding
up. Two rows say what happened, one row would say something that cannot be
checked.

**Unpaired, like a bonus.** There is no negative counterpart, because no extra
cash reached the driver's hand — the passenger paid the ordinary tariff and
`cash_collected` already records all of it. The balance moves by the whole
uplift and settles through the ordinary handover.

It joins `LedgerEntryKind::earnings()`, so it appears in the earnings total and
on the earnings breakdown. A scheme that pays a driver and is then absent from
the screen answering *"what did I make"* is a scheme they cannot check.

### 5. Off by default

`billing.peak_enabled` defaults to `false`, like `bonus_enabled` and
`maps.routing_enabled` before it.

The argument is `WeeklyBonusService`'s and this scheme needs it more: a scheme
that switches itself on at deploy is an unbudgeted liability against every
driver on the platform, and where a weekly bonus bills once a week, an uplift
bills on **every trip**. Turning it on is a deliberate act, and the console's
billing settings card is where it happens.

### 6. The app is told the resolved window, never the rule

`GET /me/promotions` serves the window as two ISO instants for today, an
`active` flag, and the uplift percentage — computed on the server, for this
driver, at this moment.

It is never sent `peak_starts_at` as a policy to interpret. This is the finding
the audit agent recorded and this codebase has now written down four times: a
threshold shipped inside a handset goes on asserting the old number after the
office changes it, on devices nobody can reach. The percentage travels as a
*number* rather than as a sentence, because "Earn 20% more" is English and
PRODUCT.md's i18n-ready constraint puts the wording in the app.

**When the scheme is off, the endpoint returns `null` and the app draws
nothing.** Not a zero, and not a card reading "0%": `docs/screen-rules.md` §1
refuses a zero standing in for a figure that does not exist, and a peak-hours
card on a fleet that runs no peak scheme is exactly that, dressed as a
measurement.

## Consequences

- The uplift is a real, recurring cost that scales with trip volume inside the
  window. It is off by default and both dials are in the console, which is the
  whole of the control — **there is no budget cap and no monthly ceiling.** An
  operator who sets a 100% uplift over a 23-hour window has doubled their
  driver payroll and nothing will stop them. A cap is the obvious next thing to
  want and is deliberately not in this ADR.
- **A driver cannot see, on the trip itself, that it earned an uplift.** The
  Ride Complete screen shows the fare and the share; the `peak_earned` row
  appears on the wallet statement and in the earnings breakdown. Surfacing it
  at the moment it is earned is a good idea and is not built.
- **Nothing tells a driver the peak window is about to start.** The Promotions
  screen says when it is, if they open it. A push notification is the obvious
  use and would be the second thing the push channel has ever carried
  (`TripOfferedNotification` is the first), which is its own decision.
- The window is one per fleet. Different peaks for different cities, or for
  weekdays against weekends, would need a table rather than four settings keys.
