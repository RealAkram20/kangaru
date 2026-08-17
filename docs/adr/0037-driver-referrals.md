# ADR-0037 — Driver referrals

**Status:** Accepted
**Date:** 2026-08-15
**Supersedes:** ADR-0029 §6, in part — the same narrow claim ADR-0034 and
ADR-0036 each superseded.
**Related:** ADR-0027 (driver applications), ADR-0029 (the driver ledger),
ADR-0034 (tips and bonuses), ADR-0036 (peak hours), ADR-0024 §7 (withholding a
person's details).

## Context

The Promotions mockup draws a **Refer a Friend** card: *"Earn UGX 10,000 when
they complete 10 trips."*

Nothing behind it existed — no referral code, no attribution, no qualifying
rule, no payout path. Drawing the card would have been a promise of money to a
driver's friend that nobody could pay, which is `docs/screen-rules.md` §1's
central case.

The owner was offered three options — drop it, ship an invite link with no
reward, or build the scheme — and chose to **build it**.

## Relationship to ADR-0029

As ADR-0034 and ADR-0036: §6's rule that the platform *records* money rather
than *moving* it is untouched. A referral reward is an amount the office comes
to owe, credited to the ledger and settled in cash at the depot like everything
else. What is superseded is the claim that no incentive scheme exists.

## Decision

### 1. A referral is attached when the office approves the application

ADR-0027 already puts every applicant in a queue a human empties. That approval
is where a referral is created: the applicant types a code into the sign-up
form, it is stored **unresolved**, and it is looked up at approval against
`drivers.referral_code`.

**The approval is the fraud control**, and it is the reason this scheme is
affordable at all. Every alternative attribution point — at sign-up, by link,
by phone number — pays out on something a stranger can manufacture. A person is
introduced only if somebody at the office decided to give them a job.

### 2. The code is never validated at submission

`StoreDriverApplicationRequest` has no `exists:drivers,referral_code` rule, and
that omission is the decision rather than an oversight.

Validating it would answer *"is this one of your drivers' codes?"* to an
unauthenticated caller, one guess at a time. That is the same lookup service
ADR-0027 §5 refuses to run for the email address, and it is worse here: the
answer hands an attacker a working code, and a working code is a way of
attributing your own recruits to somebody else's account.

A code that resolves to nobody is therefore **silently ignored at approval**.
The reviewer is giving somebody a job; a mistyped code is not a reason to
refuse them one, and it is not a reason to interrupt the person approving them
either.

### 3. The reward is paid after real work, not after a sign-up

`billing.referral_trip_target` completed trips, default 10.

A sign-up costs nothing to manufacture. A driver who has completed ten real
trips has been dispatched real work, carried real passengers and produced fares
the platform priced — so **the target is not a hurdle in front of the reward,
it is the verification.** Paying on approval would make the scheme's cost
proportional to how many names somebody could get past the office.

Qualification is checked on trip completion, by a listener on `TripCompleted`
separate from the one that credits the driver. Two listeners rather than one
because they pay *different people*: folding them together would put an
occasional payment to a third party behind the same `try` as the payment that
happens on every trip.

**It counts trips rather than incrementing a counter.** The count is the thing
the reward is owed against, and an increment that ran twice — an outbox retry,
a re-fired event — would pay early.

### 4. `referral` is its own ledger kind: unpaired, trip-less, uncommissioned

- **Unpaired**, like a bonus and a peak uplift. Nothing is in anybody's hand;
  the office simply comes to owe it.
- **Trip-less.** It carries no `trip_id`, because the trips that earned it are
  the *referred* driver's. Hanging it off one of them would file another
  driver's journey under this one's name on the Trips History screen.
- **No commission.** Taking a cut of an advertised reward would mean the figure
  the driver was shown and the figure they were paid differ, which is the one
  thing an incentive must not do. Same rule ADR-0034 §4 applies to a bonus.

### 5. The schema carries the integrity, not the service

Three constraints on `driver_referrals`, each removing an attack that does not
need a person to be fooled:

- **`referred_driver_id` is unique.** A person is introduced once, ever —
  including across two applications, which ADR-0027 §5 deliberately allows to
  be *submitted*.
- **A code resolves to an existing driver.** So a referrer must already have
  been approved themselves. **Cycles are therefore structurally impossible**
  rather than checked for: a driver cannot be introduced by somebody who did
  not exist when they applied. Self-referral is refused explicitly anyway,
  because it costs one comparison and the alternative is trusting an argument.
- **`code`, `trip_target` and `amount_minor` are frozen onto the row.** All
  three can change afterwards — a driver may be issued a new code, and both
  figures are admin-settable. A referral explained only by "the current reward"
  is one nobody can defend a year later. ADR-0029 §3's rule about writing the
  commission rate into an entry, applied again.

`qualified_at` and `ledger_entry_id` are written in one transaction under a row
lock, so a row claiming to have been paid that points at nothing cannot exist,
and two completions landing at once cannot both pay.

### 6. Codes are minted on demand, and are made to be read aloud

`drivers.referral_code` is null until somebody first opens the Promotions
screen, which is the first moment the code could be used. Every driver who
existed before this ADR would otherwise need backfilling, for a string nobody
had looked at.

Eight characters from an alphabet with no `O`, `0`, `I`, `1` or `L`. A referral
code is read across a table in a depot and typed into a phone by somebody who
has never seen it written down, and those five characters are where that goes
wrong. Drawn with `random_int`: a guessable code is a way of attributing
somebody else's recruits to yourself.

### 7. The referred driver is never named on the statement

The reward's description says *"a driver you introduced completed 10 trips"*,
never who. A wallet statement is permanent and scrollable, and ADR-0024 §7's
principle — a person's details are released for the moment that needs them, not
for ever — applies to a colleague as much as to a passenger. ADR-0034 §6
reached the same conclusion about naming a tipping passenger.

### 8. Off by default

`billing.referral_enabled` defaults to `false`, for ADR-0036 §5's reason plus
one of its own: switching this on also takes on the job of reading the
applications it will attract. An operator should do that deliberately.

## Consequences

- **The office has no console screen for any of this.** They cannot see who
  introduced whom, cannot see pending referrals, and cannot revoke one. The
  settlement queue has had the same gap since ADR-0032 and it is now three
  features deep. This is the single largest gap in the feature.
- **A driver cannot see who they introduced**, only how many and how many have
  qualified. That is deliberate under §7 for the statement, but the Promotions
  screen could honestly show a list of *states* — "1 driving, 2 not yet" —
  without names. Not built.
- **Nothing tells a driver their referral paid out.** They find it in their
  wallet, which is where ADR-0034 left a bonus. Same open question, same
  answer: the push channel exists and using it is its own decision.
- **A driver leaving does not un-pay a referral.** Somebody who introduces ten
  people who each do ten trips and then stop has been paid ten rewards, and
  that is by design — the trips were real and the fares were priced. An
  operator who finds this being farmed has the console dials and the approval
  queue, and no automatic clawback.
- **A referral cannot be attached to a driver the office created directly**, by
  `POST /drivers` rather than through the applications queue. The code is a
  field on the application, so a driver onboarded by hand has no way to name
  who brought them. Worth an office-side field when the console screen lands.
