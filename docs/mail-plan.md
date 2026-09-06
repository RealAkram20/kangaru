# The mail plan

> **Complete, M0 through M6, 24 August 2026.** Every package in §9 is built,
> tested and committed. What is deliberately not built is listed at the bottom
> of each package's worklog entry and summarised in §12 below.
>
> Start at §12 if you are picking this up: it says what exists, what is still
> blocked and why, and what nobody should rebuild.


Every email the platform sends, who receives it, and what has to be built
before any of it leaves the building.

| Document | What it holds |
|---|---|
| `docs/adr/0014-system-settings.md` | Where the SMTP credentials live, and why they are read at send time |
| `docs/adr/0028-admin-governed-sign-in-methods.md` | The one flow that already mails |
| **this file** | The packages, the catalogue, the copy rules |
| `docs/master-plan.md` | Outranks this file wherever they disagree |

Copy rule for this whole document and for every template it describes:
**no dashes.** No em dash, no en dash, no hyphen standing in for a pause.
Short sentences and full stops instead. This is the owner's instruction and it
is binding on subject lines and body copy.

---

## 1 · What exists today

Two mail paths that do not know about each other.

**Path one, the settings mailer.** `SettingsService::smtpMailer()` builds a
one off mailer from the `mail` settings group at send time, never at boot. It
has exactly two callers: the settings screen test send, and the password reset
code. Both call `$mailer->raw()`. There is no template, no layout, no queue.

**Path two, the notification mail channel.** `NotificationChannel::MAIL`
returns the string `mail`, which is Laravel's default mailer from `.env`.
`MAIL_MAILER` is `log` in both `.env` and `.env.example`, so every email on
this path is written to `storage/logs/laravel.log` and nobody receives it.
Three notification types are configured onto it: booking approved, booking
rejected, driver document reviewed.

**Live state on the development database:** `mail.enabled` is false, host and
from address are empty, so `mailConfigured()` returns false.
`auth.password_reset_enabled` is false. Nothing leaves the system today.

There are no Mailable classes, no `app/Mail` directory, and no mail blade
views beyond the vendor defaults.

### The hole this opens

`ClientOnboardingService::firstAdministrator()` and
`OperatorService::onboard()` both create an active account with a random 32
character password that nobody is ever told. Both carry comments saying the
account is reached by an invitation. No invitation exists. The client dialog
tells the operator *"They are invited to set their own password"* and that
sentence is currently false.

The forgot password escape hatch is closed twice over, by the disabled flag
and by the unconfigured mailer, so `/password/forgot` answers 409.

**A corporate client admin and a fleet owner are, today, accounts nobody can
sign into.** That is the first thing this plan fixes.

---

## 2 · The decision: one mail path

Everything sends through the settings mailer. The notification `mail` channel
is replaced by a `SettingsMailChannel` that resolves the same
`SettingsService::smtpMailer()` the test send proves.

Why this and not the framework default:

- A green test send in the settings screen must vouch for every real email.
  Two paths mean the test can pass while booking emails go to a log file,
  which is exactly today's state.
- The credentials are per deployment and editable by the owner without a
  release. That is the whole point of ADR-0014.
- `mailConfigured()` becomes the single gate. One boolean decides whether the
  platform mails at all, and every send path respects it.

Nothing sends synchronously. Mail goes on the queue with retries and a
backoff. A slow SMTP handshake must never be inside a dispatcher's request.

---

## 3 · Architecture

```
Event or state change
  │
  └─▶ Notification (Modules/Notifications/Notifications/*)
        │  via() reads config/notifications.php
        │
        ├─▶ TenantDatabaseChannel   the in app record, sync, cannot fail
        ├─▶ ExpoPushChannel         the handset, time critical only
        └─▶ SettingsMailChannel     queued, respects mailConfigured()
              │
              ├─ renders resources/views/mail/layout.blade.php
              ├─ plus one content view per email
              └─ sends via SettingsService::smtpMailer()
```

New pieces:

| Piece | Path | What it does |
|---|---|---|
| `SettingsMailChannel` | `Modules/Notifications/Channels/` | Builds from settings, queues, skips silently when mail is off |
| `MailPreference` | `Modules/Notifications/Models/` | Per user, per type opt out |
| `Invitation` | `Modules/Administration/Models/` | Signed expiring token for the accept invite page |
| `mail/layout.blade.php` | `backend/resources/views/` | The one shell every email uses |
| `SendExpiringDocumentReminders` | `Modules/Drivers/Console/` | Daily, the only new scheduled command |
| `mail_deliveries` | migration | Append only log of what was sent, to whom, and whether it landed |

`mail_deliveries` is not optional. Support cannot answer "did the client get
the invoice" from a log file, and the platform positions itself on audit grade
correctness. One row per send, with the notification type, the recipient, the
subject, the queue attempt and the transport result.

---

## 4 · The template system

One layout, one content block, plain text alongside every HTML body.

### Deviations from DESIGN.md that the medium forces

These are raised rather than resolved quietly, per `docs/screen-rules.md`.

**Typography.** Sora, Inter and JetBrains Mono are self hosted and email
clients do not load web fonts. Outlook ignores them outright. The email stack
is `Inter, "Segoe UI", Roboto, Helvetica, Arial, sans-serif` and it will
render as Segoe UI or Arial for most readers. **Sora appears nowhere in an
email.** Headings are Inter SemiBold at a larger size. Reference codes such as
an invoice number stay monospace with a system stack, because a plate or an
invoice number misread is a support call.

**Icons.** DESIGN.md is Lucide only and no emoji, and that holds. But Gmail
strips inline SVG, Outlook renders it as nothing, and every major client
blocks remote images until the reader allows them. An email whose meaning
depends on an icon is an email that arrives meaningless.

Recommendation: **no icons in the body.** The logo appears once in the header
as a PNG with real alt text, and hierarchy is carried by type size, weight and
spacing. No status icons, no decorative glyphs, no emoji anywhere including
subject lines.

**Colour.** Tokens are inlined as hex at build time because email has no CSS
variables. The hex values come from DESIGN.md §1 and nowhere else. Navy
header, white body, green for the single action button. Status is never
carried by colour alone, so a rejected document says the word rejected.

**Dark mode.** Clients auto invert and make a mess of it. The layout declares
`color-scheme` and supplies a `prefers-color-scheme` block, and the logo ships
in a light variant for dark backgrounds.

### The shell

```
┌──────────────────────────────────────┐
│  navy band, logo, nothing else       │
├──────────────────────────────────────┤
│                                      │
│  One line heading, Inter SemiBold    │
│                                      │
│  One or two sentences of body.       │
│                                      │
│  ┌────────────────────────────┐      │
│  │ Fact          Value        │      │  the fact block,
│  │ Fact          Value        │      │  only where there
│  └────────────────────────────┘      │  are facts to give
│                                      │
│  [ One green button ]                │
│                                      │
├──────────────────────────────────────┤
│  Who sent this, why, and the         │
│  preferences link. Nothing else.     │
└──────────────────────────────────────┘
```

One action per email. If a reader has two things to do, they get two emails or
the second thing waits for the screen.

Width 600px, single column, no nested tables beyond what the shell needs, no
background images, no external CSS, no tracking pixel. Total under 100KB so
Gmail does not clip it.

---

## 5 · Copy rules

Screen rules §9 applies here with one change: an email has no surrounding
interface, so it may carry one sentence of context that a screen would not.
One sentence. Not a paragraph.

- **No dashes.** The owner's rule.
- **Subject says what happened, in under 45 characters.** "Booking approved
  for 14 September", not "Notification regarding your recent booking request".
- **Never open with "We are writing to inform you".** Say the thing.
- **No marketing.** No "we are excited". No signature block with a tagline.
- **Never explain the product.** The reader already uses it.
- **Money is currency shaped.** Amount plus ISO 4217, minor units, formatted
  by the existing money helpers. Never a bare number, never a hardcoded UGX.
- **Dates are timezone aware** and rendered in the recipient's zone with the
  zone named.
- **Every string goes through a lang file.** No concatenation. The second
  country is a translation, not a rewrite.
- **The preheader is written**, not left to leak the first line of the layout.

Worked example, the shape every template follows:

> **Subject:** Your licence expires in 30 days
>
> Your driving licence on file expires on 22 September 2026.
>
> Upload the renewed licence before then to stay on duty.
>
> | Document | Driving licence |
> | Expires | 22 September 2026 |
> | Fleet | Shanitah General Enterprises |
>
> [ Upload it now ]

---

## 6 · Who receives what

Three audiences, and the fleet split matters.

| Audience | Who | Reached at |
|---|---|---|
| **Head office** | Kangaru staff, `access_level = kangaru` | The platform contact address plus each staff account |
| **Fleet office** | Fleet owner, dispatcher, finance, `access_level = fleet` | Their own account address |
| **Drivers** | `access_level = driver` | Their account address |
| **Clients** | Corporate admins and staff, `access_level = client` | Their account address, plus the contract billing address for finance mail |

### The rule that cannot be broken

**An email about a fleet's operations goes to that fleet and to nobody else.**
Not to head office, and never to a second fleet. ADR-0062 already says head
office reads the directory and not the operations, and a recipient list is the
easiest place in the codebase to leak across that line, because it looks like
a helpful CC.

Recipient resolution lives in one place, is covered by a policy test per
notification type, and the cross fleet case is proved by mutation.

Finance mail for a client goes to `OperatorClient::billing_email` when it is
set, and falls back to the client administrator. A billing address is a
different person from an operations contact and treating them as one sends
invoices to a transport officer who cannot pay them.

### Preferences

Every recipient can turn off the types marked optional below. The types marked
required cannot be turned off, because they are security or money. A footer
link reaches the preference screen. No unsubscribe from a password reset.

---

## 7 · The catalogue

Legend for **State**: `live` sends today, `partial` exists as an in app
notification but does not mail, `new` does not exist at all, `blocked` cannot
be built honestly yet.

### 7a · Account and access, every audience

Required, none of these are optional.

| # | Event | Trigger | Subject | State |
|---|---|---|---|---|
| A1 | Account created, set your password | `ClientOnboardingService`, `OperatorService`, `UserAdminService`, `DriverAccountService` | Set your KangaruRide password | **new** |
| A2 | Invitation about to expire | 24h before token expiry | Your invitation expires tomorrow | **new** |
| A3 | Password reset code | `PasswordResetService::request()` | Your password reset code | live, needs the template |
| A4 | Password was changed | `AuthController::changePassword`, and reset success | Your password was changed | **new** |
| A5 | Sign in from a new device | `AuthService` on unrecognised device | New sign in on a new device | **new** |
| A6 | Two factor enrolled | `MfaService` enrol | Two factor is on | **new** |
| A7 | Two factor removed | `MfaService` disable | Two factor is off | **new** |
| A8 | Recovery codes running low | ADR-0010, at 2 remaining | You have 2 recovery codes left | **new** |
| A9 | Account suspended | `UserStatus` to suspended | Your account is suspended | **new** |
| A10 | Account reactivated | `UserStatus` to active | Your account is active again | **new** |
| A11 | Support opened your account | `ImpersonationService`, `ACCOUNT_ACCESSED_BY_SUPPORT` | Support opened your account | **partial** |
| A12 | Email address changed | profile update | Your sign in email changed | **new** |

A5 and A12 go to the **old** address as well as the new one. An attacker who
changes an address must not be able to silence the warning.

### 7b · Drivers

| # | Event | Trigger | Subject | State | Optional |
|---|---|---|---|---|---|
| D1 | Application received | `DriverApplicationService` submit | We have your application | **new** | no |
| D2 | A document was rejected | `APPLICATION_DOCUMENT_REJECTED` | One document needs another go | **partial** | no |
| D3 | Application approved | `DriverApplicationStatus::APPROVED` | You are approved. Here is how to sign in | **new** | no |
| D4 | Application rejected | `DriverApplicationStatus::REJECTED` | Your application was not approved | **new** | no |
| D5 | Document verified | `DRIVER_DOCUMENT_REVIEWED` | Your licence is verified | **live on the log path** | no |
| D6 | Document rejected with a reason | same type | Your licence was not accepted | **live on the log path** | no |
| D7 | Document expires in 30 days | `SendExpiringDocumentReminders`, new command | Your licence expires in 30 days | **new** | no |
| D8 | Document expires in 7 days | same command | Your licence expires in 7 days | **new** | no |
| D9 | Document expired | same command | Your licence expired today | **new** | no |
| D10 | Trip cancelled after you accepted | `TripStatus::CANCELLED` | Your trip on 14 September was cancelled | **new** | no |
| D11 | Weekly summary | after `AwardWeeklyBonuses` | Your week: 42 trips | **new** | yes |
| D12 | Weekly bonus awarded | `WeeklyBonusService::award()` | You earned the weekly bonus | **new** | yes |
| D13 | Settlement confirmed | `SettlementRequestStatus::CONFIRMED` | Your settlement is confirmed | **new** | no |
| D14 | Settlement declined | `SettlementRequestStatus::DECLINED` | Your settlement was declined | **new** | no |
| D15 | Payout account changed | `DriverPayoutAccountController` | Your payout account changed | **new** | no |
| D16 | Closure request answered | `DRIVER_CLOSURE_ANSWERED` | Your closure request has an answer | **partial** | no |
| D17 | Support request answered | `DRIVER_SUPPORT_ANSWERED` | Your support request has an answer | **partial** | yes |
| D18 | Walk in contract approved | `WalkInContractService` | Your walk in contract is approved | **new** | no |
| D19 | Walk in contract declined | `WalkInContractService` | Your walk in contract was declined | **new** | no |
| D20 | Time off approved or declined | `AvailabilityStatus` | Your time off request has an answer | **new** | yes |
| D21 | Referral reward earned | `ReferralService` | Your referral earned a reward | **new** | yes |

D15 goes to the address on file **before** the change, for the same reason as
A12.

### 7c · Clients

| # | Event | Trigger | Subject | State | Optional |
|---|---|---|---|---|---|
| C1 | Your account is ready | `ClientOnboardingService` | Your KangaruRide account is ready | **new** | no |
| C2 | Booking approved | `BookingApproved` event | Booking approved for 14 September | **live on the log path** | yes |
| C3 | Booking rejected | `BookingRejected` event | Booking not approved | **live on the log path** | no |
| C4 | Booking cancelled | `BookingStatus::CANCELLED` | Your booking was cancelled | **new** | no |
| C5 | Driver assigned | `BookingStatus::ASSIGNED` | A driver is assigned to your booking | **new** | yes |
| C6 | Trip completed with summary | `TripCompleted` event | Trip complete. Here is the summary | **new** | yes |
| C7 | Invoice issued | `InvoiceService` issue | Invoice INV 2026 0431 | **new** | no |
| C8 | Credit note issued | `CreditNoteService` | Credit note CRN 2026 0088 | **new** | no |
| C9 | Approaching credit limit | `OperatorClient::credit_limit_minor` | You are near your credit limit | **new** | no |
| C10 | Credit limit reached | same | You reached your credit limit | **new** | no |
| C11 | A fleet asked to serve you | `OperatorClient::REQUESTED`, ADR-0060 | Shanitah asked to serve your company | **new** | no |
| C12 | You approved a fleet | `ClientOnboardingService::approve()` | You approved Shanitah | **new** | no |
| C13 | A contract ended | `ClientOnboardingService::end()` | Your contract with Shanitah has ended | **new** | no |
| C14 | Staff member added | client staff create | A new administrator was added | **new** | no |
| C15 | Order request received | `ORDER_REQUEST_RECEIVED` | Your order request is with us | **partial** | no |
| C16 | Trip disputed, we are looking | `TripStatus::DISPUTED` | We are reviewing trip 4471 | **new** | no |
| C17 | Report export ready | `REPORT_EXPORT_READY` | stays in app | deliberately not email | n/a |

C7 and C8 go to the billing address. C2 to C6 go to the operations contact.
That split is the point of §6.

**C9 and C10 depend on a balance the platform can produce.** `credit_limit_minor`
exists on the contract, but there is no invoice status column and no payment
record, so *outstanding balance* has no honest source today. Until it does,
these two are **blocked** and must not ship with an invented figure.

### 7d · Fleet office admins

Mostly optional and mostly digestible. A dispatcher who gets an email per
booking will filter the whole sender to a folder and then miss the one that
matters.

| # | Event | Trigger | Subject | State | Optional |
|---|---|---|---|---|---|
| F1 | Booking waiting for approval | `BookingStatus::PENDING` | Booking waiting for approval | **new** | yes, digest |
| F2 | New driver application | `DriverApplicationService` submit | New driver application | **new** | yes |
| F3 | Documents waiting for review | `DriverDocumentStatus::PENDING` | Documents waiting for review | **new** | yes, digest |
| F4 | Driver asked to close an account | `DriverClosureService` | A driver asked to close an account | **new** | no |
| F5 | Driver asked for settlement | `DriverSettlementRequestService` | A driver asked for settlement | **new** | no |
| F6 | New support request | `SupportRequestStatus::OPEN` | New support request | **new** | yes |
| F7 | Time off requested | `AvailabilityStatus::REQUESTED` | Time off request from Sarah Namuli | **new** | yes |
| F8 | Trip disputed | `TripStatus::DISPUTED` | Trip 4471 is disputed | **new** | no |
| F9 | Passenger no show | `TripStatus::NO_SHOW` | Passenger no show on trip 4471 | **new** | yes |
| F10 | Nobody took an offer | `DispatchOfferStatus::EXPIRED` with no successor | Nobody took the offer for trip 4471 | **new** | no |
| F11 | Odometer does not match GPS | `DistanceGrade` poor | Odometer does not match GPS on trip 4471 | **new** | no |
| F12 | Plan limit reached | `PlanAllowance::require()` | You reached your driver limit | **new** | no |
| F13 | A client answered your request | `OperatorClient` approve or refuse | Nakumatt Ltd approved your request | **new** | no |
| F14 | New client onboarded | `ClientOnboardingService::onboard()` | New client onboarded | **new** | yes |
| F15 | Daily digest | scheduled, 07:00 fleet local | Today at a glance | **new** | yes |
| F16 | Document expiring on a driver | `SendExpiringDocumentReminders` | 3 drivers have documents expiring | **new** | yes, digest |

F10 is the one on this list that costs money when it is missed. A passenger is
on a kerb and no driver took the job. It is required and it is immediate.

### 7e · Head office admins

Small list on purpose. Head office reads the directory, not the operations.

| # | Event | Trigger | Subject | State | Optional |
|---|---|---|---|---|---|
| H1 | New fleet onboarded | `OperatorService::onboard()` | New fleet on the platform | **new** | yes |
| H2 | A fleet has no account left | ADR-0059 §5 invariant | Shanitah has no account left | **new** | no |
| H3 | Driver asked for a Kangaru contract | `WalkInContractService` | A driver asked for a Kangaru contract | **new** | no |
| H4 | A fleet changed plan | `Operator` plan change | Shanitah changed plan | **new** | yes |
| H5 | Mail is failing | 3 consecutive transport failures | Mail is failing | **new** | no |
| H6 | Fleet suspended or reactivated | `OperatorService::setStatus()` | Shanitah is suspended | **new** | yes |

H2 closes a gap the worklog already names: *"`fleets_without_an_account` is a
number on a dashboard, not an alert. If ADR-0059 §5's invariant breaks,
somebody has to be looking."* This is the somebody.

H5 cannot send through the mailer that is failing. It writes a Sentry event
and an in app notification, and mails only if a fallback address is set.

---

## 8 · What is deliberately not email

Named so nobody builds it later by accident.

- **Trip offered to a driver.** Push only, and it stays push only. The offer
  window is measured in seconds and an email arrives after the job is gone.
  `TripOfferedNotification` is right as it is.
- **Trip offer withdrawn.** Silent by design, see `pushIsSilent()`.
- **Driver arrived, trip started, passenger onboard.** In app and push. A
  client who gets five emails per trip stops reading all of them.
- **Report export ready.** The requester asked seconds ago and is still on the
  page. `config/notifications.php` already says in app only and it is correct.
- **Anything about a fleet's operations to head office.** §6.

---

## 9 · Packages

Each is shippable on its own and leaves the platform working.

| | Package | What it delivers | Exit criteria |
|---|---|---|---|
| **M0** | The one path | `SettingsMailChannel`, queued, `mailConfigured()` gate, `mail_deliveries` log | The three configured notification types stop going to a log file. Test send and a real send prove the same path. |
| **M1** | The shell | `mail/layout.blade.php`, plain text partner, dark mode, preheader, lang files | A3 renders in the template. Checked in Gmail, Outlook web, Apple Mail, Gmail Android. |
| **M2** | The invitation | `Invitation` model, signed expiring token, public accept page, A1 and A2 | A corporate admin and a fleet owner created today can sign in tomorrow without anybody reading them a password. **This is the blocker on go live.** |
| **M3** | Security mail | A4 to A12, D15 | Every credential and identity change mails, and the change of address case mails both addresses. Proved by mutation. |
| **M4** | Drivers | D1 to D21, plus `SendExpiringDocumentReminders` | A licence cannot expire without three warnings. |
| **M5** | Clients | C1 to C8, C11 to C16 | An invoice reaches a billing address. C9 and C10 stay blocked and are recorded as such. |
| **M6** | Admins and digests | F1 to F16, H1 to H6, preferences screen | F10 and H2 fire immediately. Everything else respects the digest setting. |

M0 and M2 are the go live minimum. M1 is what stops the first email looking
like a phishing attempt.

### Definition of done, per AGENTS.md

Every package ships with the OpenAPI contract updated, tests, the module
README, policy coverage on any new endpoint, and a Sentry report on the
failure path proved by triggering it.

---

## 10 · Decisions taken, 23 August 2026

Answered by the owner. These are settled and the packages below assume them.

1. **Delivery infrastructure: the existing SMTP account.** No new subscription
   and no self hosted relay. The credentials go into the settings screen,
   which is what ADR-0014 built the shelf for. Three things still have to be
   verified against that account before M0 is called done, because each one
   fails silently:
   - the account permits the configured **from address**. Most providers
     reject a from address on a domain they have not verified, and the
     rejection arrives as a transport error nobody reads.
   - **SPF, DKIM and DMARC** resolve for the sending domain. Without them the
     invoice lands in spam and finance staff say the platform never sent it.
   - the **daily send limit** covers the busiest day. A Workspace or cPanel
     mailbox typically caps at a few hundred a day, and the digest plus a
     document reminder sweep can pass that in one morning. `mail_deliveries`
     is what will show it happening.
2. **From address: one platform address.** One domain to authenticate and one
   reputation to protect. A client contracted with Shanitah receives mail
   signed KangaruRide, and the fleet is named in the body instead. Per fleet
   sending domains are refused, not deferred: each would need its own DMARC
   alignment or the mail reads as spoofing.
3. **Invoices: PDF attached and a link.** Finance staff forward the PDF and
   auditors follow the link to the live record. This adds an invoice PDF
   renderer, which does not exist yet, to package M5.
4. **Everything ships, M0 to M6.** The full catalogue.

Still open, and it does not block anything:

- **Digest timing.** F15 at 07:00 in the fleet's local timezone assumes a
  fleet has a timezone. Today it does not, so F15 inherits the platform
  default until an `operators.timezone` column exists.

---

## 11 · Claiming this work

Add an entry to `docs/agent-worklog.md` before writing code. The shared files
this plan touches, and which every package will need a minimal diff on:

- `backend/config/notifications.php`
- `Modules/Notifications/Enums/NotificationType.php`
- `Modules/Notifications/Enums/NotificationChannel.php`
- `backend/routes/console.php`
- `docs/api/openapi.yaml`

Nobody rewrites another agent's template. New emails are new files.

---

## 12 · What was built, and what was not

### Built

| | Package | What landed |
|---|---|---|
| **M0** | The one path | `SettingsMailChannel`, `mail_deliveries`, four gates. The framework mailer was `log`; three notification types had been writing to a log file since they shipped. |
| **M1** | The shell | One blade layout plus a plain text partner, `MailRenderer`, `mail:preview`. Three contrast failures found by rendering it, none catchable by a test. |
| **M2** | The invitation | A fleet owner and a corporate client admin can sign in. Before it, both were active accounts nobody could open. |
| **M3** | Security | Nine warnings, the email menu, `known_devices`. `recoveryCodesAreLow()` had existed since ADR-0010 with nothing calling it. |
| **M4** | Drivers | Ten emails and `drivers:remind-expiring-documents`, which AGENTS.md named and nothing had built. |
| **M5** | Clients | Invoices to the billing address, with the PDF and the link. C11 closed a hole ADR-0060 §5 left open. |
| **M6** | Admins | Seven office alerts, the preferences screen, and `fleets_without_an_account` as an alert rather than a number. |

### Still blocked, and why

**C9 and C10, the credit limit emails.** `operator_clients.credit_limit_minor`
exists. *Outstanding balance* does not: there is no invoice status column and
no payment record, so the figure has no honest source. Unchanged since this
plan was written. They do not ship with an invented number.

### Not built, with reasons

| | Why |
|---|---|
| D10 trip cancelled after acceptance | No driver-facing cancellation event. `trip.offer_withdrawn` covers the offer stage only. |
| D11 weekly earnings summary | A money digest is a screen-rules §1 question and no figure has been verified producible. |
| D20 time off answered | `AvailabilityStatus` has three cases and **`AvailabilityService` has no method that moves between them.** |
| D21 referral reward | `ReferralService` reads `rewardMinor()` and **nothing anywhere pays a reward.** |
| F10 nobody took the offer | The exhausted-dispatch case is spread across `advance()`, `retryUnoffered()` and a config window. Wants a domain event that does not exist. |
| F11 odometer against GPS | Same shape: `DistanceGrade` is computed but nothing raises an event on a poor grade. |
| F15 daily digest | Waits on `operators.timezone`, which does not exist. 07:00 in whose morning? |

D20 and D21 are the two worth somebody's decision: both are an enum and a
config value with no service behind them, which is the same shape
`recoveryCodesAreLow()` had before M3. **An unwired feature is only honest if
something says it is unwired**, and neither of those says so.

### One migration this plan did not do

The notifications that predate it — booking decisions, trip progress, document
reviews, closure and support answers — still hold their copy in PHP rather than
in `lang/en/mail.php`. `MailKeysTest` names them explicitly as bespoke. Moving
them is a separate pass, deliberately: rewriting other agents' sentences is the
collision the worklog exists to prevent.

### The one operational thing before any of this sends

`mailConfigured()` is **false** on the development database and
`auth.password_reset_enabled` is **false**. Nothing leaves the building until
somebody puts the SMTP credentials into Settings → Email and presses the test
send. Everything else is built and waiting on that.
