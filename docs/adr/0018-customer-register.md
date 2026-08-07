# ADR-0018: The customer register

**Status:** Accepted (7 August 2026)

## Context

ADR-0013 built customer accounts and ADR-0015 made one a prerequisite for
ordering. Between them a member of the public can register, sign in, place
orders and see their own history.

No member of Shanitah's staff could see that any of this existed.

There was no listing, no profile, no search, and no way to stop an account
being used. Concretely:

- A dispatcher taking a call had nothing to look the caller up in. The only
  way to find somebody was through the walk-in queue, which shows orders,
  not people — so "has this number ordered before?" had no answer.
- An account placing abusive orders could be deleted, destroying the order
  history that is the evidence, or left alone. There was no third option.
- Nobody could answer "why can't I sign in?" — the platform did not record
  whether an account had a password, a Google identity, or both.

Akram raised this directly: *"I have not seen User account I mean clients …
these people are going to have account and wallet and all their
information … we need to track all their activities."*

## Decision

### 1. It is called the customer register, not clients

`Modules/Clients` and the Companies screen already mean the **corporate**
clients — the tenants who hold contracts. The people this ADR is about are
Shanitah's own retail account holders. One word for two populations is how a
support agent ends up searching the wrong list, so the individuals stay
"customers" everywhere: model, module, permission, URL and menu.

### 2. A staff-side surface, deliberately separate from the customer's own

```
GET    /api/v1/customers                        the register
GET    /api/v1/customers/{customer}             one profile
GET    /api/v1/customers/{customer}/activity    what they have asked for
POST   /api/v1/customers/{customer}/suspension  stop the account
DELETE /api/v1/customers/{customer}/suspension  restore it
```

Not under `/customer`, which marks the customer guard's own surface. These
run behind `auth:sanctum` with the staff guard and `CustomerPolicy`. Putting
them together would make the URL lie about who the caller is.

Search covers name, email and phone. The phone comparison strips
punctuation from **both** sides and matches on the national significant
number rather than as a substring — the first implementation used
`LIKE '%digits%'` and a customer stored as `+256 700 123 456` was
unfindable by a dispatcher typing `0700123456`, because the local leading
zero *replaces* the country code rather than appearing inside it. The one
form people read off a phone screen was the one form that did not work.

Cursor pagination, per AGENTS.md's rule for append-heavy lists: a dispatcher
scrolling for a caller must not have rows shuffle because somebody
registered while they looked.

### 3. Suspension, not deletion

An account's order history is the evidence behind any dispute about it, so
removing the account to stop somebody using it would destroy the record of
why they were stopped. `CustomerStatus` therefore has two states and no
third.

Three things happen together, and the second is the substance:

1. The status flips and the reason is stored beside it.
2. **Every token is revoked.** Flipping a column while a live Sanctum token
   keeps working means the person carries on ordering from the app already
   open on their phone — the same hole `UserAdminService::revokeTokens`
   closes for staff and ADR-0016 §5 closes for drivers.
3. The next sign-in is refused — with the **ordinary wrong-credentials
   answer**, deliberately, and after the password check. Answering "this
   account is suspended" to anyone who types an email would turn the login
   form into a way to enumerate which addresses are registered and which are
   in trouble. The customer hears why from a person, which is also the only
   route by which they can appeal it.

The reason is **required**, unlike the optional note on a declined leave
request. The difference is who reads it: this is the sentence a support
agent says out loud to a member of the public, and "no reason recorded" is
not an answer a platform should have to give.

Restoring clears the reason with the status. Keeping a stale "suspended
because…" beside an active account is how an agent tells somebody they are
blocked when they are not; the audit log holds the history, and it is
append-only.

### 4. `customers.view` is its own permission

Not folded into `staff.view`. Two populations with two different privacy
stories: staff are colleagues whose names and roles the desk needs, while
customers are members of the public whose phone numbers and travel history
fall under the **Data Protection and Privacy Act, 2019** (AGENTS.md
Compliance). One permission for both would mean anyone who can see the staff
list can see where every retail customer went last month.

Read is seeded on Super Admin, Operations Manager and Dispatcher — a
dispatcher answering the phone has to find the caller. `customers.manage`
(suspension) is not, because it is an act somebody has to answer for.

A **Corporate Admin holds neither**, and that is the load-bearing part. Their
staff are in `/users`; Shanitah's retail customers are not theirs to read.

### 5. Nothing here lets staff act as a customer

No password reset, no impersonation, no profile edit. The same line
`Modules/Administration` draws for staff accounts, drawn again for members of
the public and for a stronger reason: an administrator silently changing
someone's credentials is the one act an audit trail cannot tell apart from
impersonation.

What the profile *does* say is **how** they sign in — `has_password`,
`has_google` — without saying what the credential is. That is the first
question on "I cannot log in" (ADR-0013 §3) and answering it needs no secret.

### 6. Activity is its own endpoint

A support agent opens the profile to answer "who is this" and pulls the
history only when the question becomes "what happened". Loading a year of
orders to render a phone number is the N+1 of screens.

Today activity means order requests, and only those: ADR-0012's `converted`
status still does not create a Trip, so there is no trip history to join to.
When walk-in fulfilment lands, the timeline gains a second source rather than
changing shape.

## Consequences

Staff can find a customer by any of the three things a caller might give
them, see how that person signs in, read what they have ordered, and stop an
account without destroying its history.

`Customer` gains a `status` and an `orderRequests` relation. Both are
additive: the column defaults to `active`, so every existing row keeps
working with no backfill.

**The wallet is deliberately not in this ADR.** Akram asked for one in the
same breath, and it depends on a decision that has not been made — see
below. Building a balance before knowing whose it is would be guessing at
money, which is the one thing AGENTS.md's Money & Billing Standards say not
to do.

## The open question this ADR does not answer

Akram's framing was that these people are *"both walk-in client and our
corporate client staff"*. Today they are two principals that can never share
a wallet or a history:

- A **walk-in customer** is a `Customer` row behind the `customer` guard —
  no role, no tenant, no permission.
- A **corporate employee** is a `User` row with role `corporate_employee`,
  behind the staff guard, belonging to a tenant.

ADR-0013 split them deliberately, and the split is still right for
*authorization*. What it does not serve is a person who is both — a bank
employee who also takes a private weekend ride. Two options, neither started:

1. **One `Client` identity for both.** Cleanest for a shared wallet and a
   single activity timeline; touches two auth guards, ordering, bookings and
   billing.
2. **Keep both logins, add one shared client profile** that owns the wallet
   and the history. Lower risk; "one person, two logins" stays possible.

This ADR builds the register, which is common to both, and stops there.

## Alternatives considered

**Extending `/users` to cover customers.** Rejected in §4 — the privacy
boundary is the feature, not an implementation detail.

**Filtering the register client-side.** Rejected: with cursor pagination a
client-side filter sifts only the loaded page, and a dispatcher who cannot
find a caller concludes they are not registered. Worse than a slow search.

**Deleting abusive accounts.** Rejected in §3 — it destroys the evidence.

**Telling the suspended customer why at the login form.** Rejected in §3 —
it turns the form into an enumeration oracle.
