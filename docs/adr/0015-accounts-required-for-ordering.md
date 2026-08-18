# ADR-0015: Accounts required for ordering, and the customer profile

**Status:** Accepted

**Supersedes:** ADR-0012 §3 (anonymous walk-in ordering)

## Context

ADR-0012 built the walk-in order as a *lead*: an unauthenticated write that
collected a name, a phone number and an optional email — exactly what a
dispatcher needs to call somebody back — and deliberately no credential.
That was the right decision when it was made, because no customer-account
endpoint existed to honour a password, and collecting one would have been
theatre.

ADR-0013 then built customer accounts: a separate `Customer` principal, its
own guard, register/login/me/logout, and §4's provision that a customer
token *may* accompany the public order write so the order links to the
account. What it did not do was give anyone a way to create one — no
sign-up screen was ever built, so `POST /customer/auth/register` had no
caller and every walk-in order filed as anonymous.

Two consequences followed, and both are why this ADR exists:

1. The order form still asked for a name and phone on every single order,
   including from people who had ordered ten times before. It could not do
   otherwise: it had nowhere to remember them.
2. `apiClient` stripped the `Authorization` header from every `/public/*`
   request. That rule was written to stop a *staff* token leaking onto an
   anonymous write, which is still correct — but it also made ADR-0013 §4
   unreachable from the only client we ship.

Separately, the product needs more of a customer than a display name:
given and family names for correct address, and gender to support a
same-gender captain preference — a routine safety expectation for women
travelling in Kampala, and one a dispatcher currently handles by memory.

## Decision

**1. Placing an order requires a customer account.** The order flow's
contact step becomes a sign-up step: create an account, or sign in to one.
There is no guest path past it. A signed-in customer never sees the step at
all — it is removed from the flow rather than pre-filled, so the progress
rail is honest about how many steps remain.

The contact details on an order request are read from the account
(`contact_name`, `contact_phone`, `contact_email`) rather than from form
state, so they cannot drift from the account after a profile edit.

**2. The staff session no longer identifies the orderer.** The public order
page previously pre-filled from `useAuth`, letting a signed-in dispatcher
order as themselves. It now answers to the `customer` guard alone. A
dispatcher taking an order over the phone belongs in the order tray at
`/order-requests`, which is built for exactly that and records who handled
it; the public form pretending to be that tool was the confusion.

**3. `customers.name` is replaced by `first_name` + `last_name`, and gains
`gender`.** Composed rather than duplicated: `Customer::name` is an
accessor over the pair, so every existing reader — the dispatcher queue via
`OrderRequestResource`, order notifications — is unchanged. Storing both a
composed name and its parts would be two sources for one fact, which
AGENTS.md forbids.

`gender` is **optional**, and `null` (never asked) is deliberately distinct
from `prefer_not_to_say` (asked, declined) so a later screen can tell
silence from a stated preference. The Data Protection and Privacy Act, 2019
wants a stated purpose for every field we hold; gender has one, but a
purpose is a reason to offer the question, not to gate a taxi behind
answering it.

**4. `apiClient` sends the customer token — and only the customer token —
to `/public/*`.** The staff-token exclusion stands unchanged. A 401 from a
customer or public route clears the customer token only, and never
redirects to `/login`, which is the staff sign-in and not this person's.

## Consequences

Conversion on the walk-in funnel will fall. A password is real friction,
and some proportion of first-time visitors will abandon at it — that is the
price of the thing being bought here, which is a customer we can recognise
on their second order, contact about a trip, and show a history to. The
dispatcher desk and the published phone number remain the no-account path
for anyone who will not create one, and the landing page should keep saying
so.

The order tray gains a real account behind most rows instead of a typed
name, which is what makes "this is their fourth order this month" possible
at all.

The honeypot on the order form stays, but it now guards a form behind a
password rather than an open write, so its value is smaller. The rate
limits on both `/customer/auth/*` (5/min/IP) and the order write (3/min/IP)
are doing the real work.

**Not built here, and deliberately:** there is no customer profile screen,
so a name typed at sign-up cannot yet be corrected, and a gender left
unanswered cannot be added later. There is no password reset. Both are
needed before this is a product people live with; neither blocks the order
flow, which is what this ADR is about. Google sign-up remains a *prefill*
of the sign-up form, not an identity — a real Google sign-in must verify
the ID token server-side against Google's keys (ADR-0013 §3), and until
that exists the button must not claim to be authentication.

## Alternatives considered

**Keep guest ordering, offer the account.** Preserves the funnel and
honours ADR-0012. Rejected as the primary path because it leaves two order
routes to build, test and reason about forever, and because the anonymous
one is the one that always wins on a form — meaning the account would go on
being the thing nobody has. Worth revisiting if the abandonment above turns
out to be severe; the server still accepts an anonymous order, so this is a
frontend decision that can be walked back without a migration.

**Collect the name after sign-up.** A shorter sign-up (email, password,
phone) with a follow-up "what should we call you?". Rejected because it
needs a customer profile-update endpoint that does not exist, and because
it trades one step for two.

**Drop the name entirely and let `contact_name` go nullable.** Was chosen
briefly and reversed: the dispatcher queue lists people by name, and a
queue of phone numbers is a queue nobody can work. The nullable cascade
would have reached `customers`, `order_requests`, the tray, and
notifications, to save one field on one screen.
