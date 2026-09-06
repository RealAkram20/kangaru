# ADR-0066: Acting as a walk-in client

**Status:** Accepted (26 August 2026)

**Extends:** ADR-0056, which built acting-as for `users` rows and left the
walk-in half of its own morph unimplemented — `ActAsSubject` says so in a
comment: *"the walk-in half of the morph is not implemented (ADR-0056 scope)."*

**Related:** ADR-0013, which made a walk-in a second principal on a second
guard and not a `users` row at all; ADR-0012, whose order requests are what a
walk-in rings about; ADR-0024, whose live ride is what a support agent will be
asked to fix.

## Context

ADR-0056 quotes the owner naming four populations head office can become:

> *"can log in as to any fleet, corporate client, walk-in client and drivers,
> as the head customer support purpose."*

Three of the four were reachable the moment `ImpersonationService` shipped,
because all three are `users` rows. The fourth was not reachable at all, and
the reason is structural rather than an oversight: ADR-0013 §1 made a walk-in a
`Customer` — *"deliberately as unlike `User` as possible"* — on its own guard,
with its own token, its own provider, and a tripwire test
(`CustomerGuardIsolationTest`) whose entire purpose is to prove that a staff
token cannot reach a customer route and a customer token cannot reach a staff
one.

So the walk-in is the population support can least reach and most often needs
to. A corporate client has a transport officer who can be telephoned and an
account manager who can look. A walk-in has a phone, a `KR-` reference, and a
ride that is either coming or not.

### What "help" actually means here

The surface is small enough to enumerate, which is worth doing before deciding
what support may touch:

| The walk-in's own surface | What support is rung about |
|---|---|
| `GET /customer/auth/me` | "Is my account even there?" |
| `GET /customer/order-requests` | "Did my order go through?" |
| `GET /customer/rides/active` | "Where is my car?" |
| `POST /customer/rides/active/cancellation` | "Cancel it, I have given up" |
| `POST /customer/trips/{trip}/rating` | — |
| `POST /customer/auth/logout` | — |

Four of the six are the support call. The fifth is nobody's support call. The
sixth is not an act support can perform at all, for a mechanical reason given
in §4.

## Decision

### 1. The subject may be a `Customer`, and the session already had room for it

`impersonation_sessions.subject_type` / `subject_id` is a morph, written that
way by ADR-0056 in anticipation of exactly this. Nothing about the row, the
time-box, the reason or the audit cross-reference changes. `ImpersonationService`
widens from `User` to `User|Customer`, and two of its four refusals become
inapplicable rather than being relaxed:

- **"You are already yourself"** cannot arise: a `Customer` is never an actor.
- **"Sessions do not chain"** cannot arise for the same reason. The check that
  a Kangaru account may not be a subject stays exactly as it is for `User`
  subjects, which is where chaining was actually possible.

The two that are about *state* both stay: one live session per actor, and the
`kangaru` + `support.act-as` gate. Becoming a member of the public is not a
lesser act than becoming a dispatcher.

### 2. Reach is full, minus the acts that establish identity

The owner's call, and it is the one that separates this from ADR-0056 §4's
treatment of drivers. A support agent acting as a walk-in may read everything
the walk-in reads **and may cancel their ride and place an order for them**.

The driver read-only rule is not being reversed and does not transfer. It
exists because a driver's live surface is *other people's* work — accepting an
offer takes a job off somebody on the road, and registering a device puts a
stranger's pickup address on a support agent's lock screen. A walk-in's live
surface is their own ride and nothing else. The failure modes are not the same
shape, so the same answer does not follow.

What stays denied is ADR-0056 §3's rule unchanged — *anything whose entire
purpose is to prove it was the person themselves.* On this surface that is
currently one route (§4), because ADR-0013 deferred customer password reset and
never built customer MFA. **The rule is what is being carried over, not the
list**: a customer password change, a second factor or an account closure
arrives already denied, because it will arrive holding `not-acting-as`.

**This is the sharpest thing in this ADR and it is deliberate.** A support agent
can dispatch a real car to a real address on a member of the public's account.
The Consequences say what that costs.

### 2a. The audit row reads differently here, and it reads *better*

ADR-0056 §2 says `user_id` stays the **subject** so that a client's own trail
reads chronologically as their account's activity. That is not available for a
walk-in: `audit_logs.user_id` is a foreign key to `users`, and a `Customer` has
no row there. `AuditLog::actingUserId()` already answers `null` for anything
written on the customer guard — deliberately, and its docblock explains that
the alternative silently attributed a passenger's action to whichever employee
shared the number.

So a cancellation made by support on a walk-in's behalf writes `user_id = null`
and `impersonator_id = <the agent>`. The only named party on the row is the
person who actually did it, which is a *stronger* attribution than §2's shape,
not a weaker one — there is no reading of that row on which the customer
appears to have acted themselves.

What is lost is the chronology §2 was protecting, and it is lost for a
population that has no audit screen to read it in. When a walk-in ever gets one,
this is the paragraph to come back to.

### 3. A staff token reaches the customer surface, and only under a live session

`auth:customer` is replaced on the customer route group by a middleware that
answers the customer guard first and falls through to exactly one other case: a
**staff Sanctum token whose actor has a live acting-as session whose subject is
a `Customer`.** It then resolves that customer as the request's user.

Three properties, and each is the reason for a test:

- **A staff token with no session is refused**, so `CustomerGuardIsolationTest`
  keeps saying what it always said. The guard split is not being loosened; a
  named, recorded, expiring exception is being cut through it.
- **No customer token is minted.** ADR-0056 §1's *"never mints a client-app
  token"* holds unchanged, and it is what keeps the exception revocable: end
  the session and the reach ends with it, with nothing left in a browser.
- **The customer is resolved from the session, never from the request.** There
  is no id in the URL to tamper with, which is the same property ADR-0013 §4
  chose for `/rides/active` and for the same reason.

### 4. Logging out is refused, and the reason is mechanical rather than moral

`CustomerAuthController::logout` revokes `currentAccessToken()`. Under an
acting-as session the current token is the **support agent's own staff token**,
so a support agent pressing sign-out on the customer surface would sign
themselves out of the console and revoke the credential the session runs on.

It is on the deny-list rather than being made to work, because there is no
version of it worth building: ending the session is what the agent means, the
banner already offers it, and "sign out" on somebody else's account is not an
act with a sensible meaning.

### 5. While acting as a walk-in, the staff console is closed

ADR-0056 §1: *"Permissions are the subject's, and only the subject's… the
actor's own `kangaru` reach is set aside entirely while the session is open."*
For a `User` subject that is structural — the swap replaces the actor, so there
is no reach left to carry. For a `Customer` subject there is nothing to swap
to on the staff guard, so without this the property would silently not hold,
and acting-as-a-walk-in would be the one session that kept its own powers.

So a staff request made while a `Customer` session is live is **refused**,
against a short allow-list that fails closed:

| Allowed | Why |
|---|---|
| `auth.me` | The console shell cannot render without it, banner included |
| `auth.logout` | Never trap somebody in a session they cannot leave |
| `support.act-as.show` | The banner asks this to know it should be drawn |
| `support.act-as.destroy` | The way out |

An allow-list by route name and not a deny-list, which is `ClientScope`'s shape
and the opposite of `RefuseWhileActingAs`'s — and the difference is the point.
A deny-list that misses a route permits it; this one refuses what it has not
heard of, so a staff route added next month is closed here until somebody
decides otherwise in a diff.

A walk-in has no permissions at all, so "the subject's permissions and only
theirs" is, correctly, almost nothing.

### 6. The person is told, by email

ADR-0056 §5 asks that **individuals** — *"drivers and walk-in customers"* —
also be notified, and the shipped `ImpersonationService` notifies only drivers.
This closes that half.

Sent through `Notification::route('mail', …)` rather than to the model, which
is the applicant path `SettingsMailChannel` already documents: `Customer` is
not `Notifiable`, has no in-app inbox to write a row to, and giving it one is a
notifications feature this ADR has no business shipping. The mail channel
already handles an anonymous recipient; the database channel already drops a
non-`User` silently. So the disclosure arrives and nothing else has to change.

Failure to notify never fails the session, exactly as for a driver.

## Consequences

**A support agent can order a car in a member of the public's name.** This is
the cost of Decision 2 and it should be stated without softening: the trip is
real, the driver is dispatched, the fare is owed, and the walk-in's own trail
will say their account did it — with `impersonator_id` beside it naming who
actually did. ADR-0056 §2 is what makes that survivable, and it is the reason
that decision was never optional.

**Rating a driver is reachable, and it is the one act on this list that is
somebody's testimony rather than their transaction.** A star and a sentence
attributed to a customer who did not write them lands on a driver's record and
follows them. It is left reachable because the owner's decision was reach minus
the identity acts and a rating is not one of them — but it is the first thing
to revisit if the deny-list is ever reopened, and it is written down here so
that revisiting it does not require rediscovering it.

**The guard split now has an exception, and it is the second-most load-bearing
test in the codebase.** `CustomerGuardIsolationTest` proved a property that is
no longer unconditional. It must now prove the *conditional* version — refused
without a session, permitted with one, refused again when the session expires —
or ADR-0013 §2 has quietly become a comment.

**Two middlewares now know about acting-as, where there was one.** The cost is
real; the alternative was worse. Putting the customer-guard exception inside
`ActAsSubject` would have made one class responsible for two guards, and
putting the staff-console hold anywhere but beside the swap would have split
one rule across two files.

**The console has a state where most of it answers 403.** Deliberate, and the
banner is what makes it legible rather than broken-looking. A support agent who
navigates back into the console mid-session sees the banner, the refusal names
the session, and the way out is one button — which is §3 of ADR-0056 applied to
a case it did not anticipate.

## Scope

**In:** a `Customer` subject on the existing session; the customer-guard
exception and its three properties; the logout denial; the staff-console hold
and its allow-list; the walk-in's email disclosure; the console's way in from
the walk-in register and its way back out; and tests for each.

**Out, deliberately:**

- **An in-app inbox for walk-ins.** §6 explains why the disclosure is email
  only. Giving `Customer` a notifications surface is a product decision with a
  screen attached, and it is not this.
- **Acting as a walk-in from the driver app or any client.** Console only,
  which is ADR-0056 §1 unchanged.
- **Reopening the driver read-only rule.** Decision 2 explains why the two
  cases differ; nothing here touches ADR-0056 §4.
- **A walk-in's own view of who accessed their account.** They are told by
  email and the row is in `audit_logs`, and there is still no screen where a
  person reads their own access history — the gap
  `AccountAccessedBySupportNotification::url()` already names.

## Alternatives considered

**Read-only, like a driver.** Much the safer decision, and it was put to the
owner as the recommendation. Rejected by them, and the reasoning is sound on
its own terms: ADR-0056 already rejected a read-only acting-as platform-wide
because *"roughly half of what support does is fix the thing"*, and a walk-in
whose ride is stuck is the clearest instance of that in the product. A support
tool that can watch a customer's car fail to arrive and not cancel it sends the
call to an engineer.

**Mint a short-lived customer token instead of crossing the guard.** Simpler to
implement — the customer surface would need no change at all. Rejected because
it breaks ADR-0056 §1's *"never mints a client-app token"*, and that rule earns
its keep: a token is a credential that outlives the session in a browser, and
ending a session would no longer end the reach. The whole point of the
time-box is that it cannot be carried out of the room.

**Let the support agent use the walk-in's own password.** It is how this is
done in a great many support desks. Rejected for the reason `AuthController`
refused password reset in the first place, which ADR-0056 quotes: it is *"the
one act an audit trail cannot tell apart from impersonation."* The trail would
show the customer doing it, with nothing to say otherwise.

**Keep the actor's staff reach during a walk-in session.** The path of least
work — Decision 5 would simply not exist. Rejected because it would make
acting-as-a-walk-in the only session that is additive rather than substitutive,
and the account it would be additive for is the one account that can become
anybody.
