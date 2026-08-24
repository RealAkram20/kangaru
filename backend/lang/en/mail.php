<?php

/*
|--------------------------------------------------------------------------
| Email copy
|--------------------------------------------------------------------------
|
| Every user-facing string in every email. PRODUCT.md requires new work to be
| i18n-safe with "no concatenated or hardcoded user-facing strings", and an
| email is the surface where that is easiest to get wrong, because a sentence
| assembled in PHP looks perfectly reasonable until the second country
| arrives and the word order changes.
|
| ## The copy rules, which are binding here
|
| From `docs/mail-plan.md` §5, and the owner's instruction:
|
| - **No dashes.** No em dash, no en dash, no hyphen standing in for a pause.
|   Short sentences and full stops instead.
| - **The subject says what happened**, in under 45 characters, so it survives
|   a phone's inbox list. "Booking approved for 14 September", never
|   "Notification regarding your recent booking request".
| - **Never open with "We are writing to inform you".** Say the thing.
| - **No marketing**, no "we are excited", no tagline in the footer.
| - **Never explain the product.** The reader already uses it.
| - Screen rules §9 applies. An email may carry one sentence of context that a
|   screen would not, because it arrives with no interface around it. One.
|
| ## What is not here yet
|
| The three notifications that already mail (booking approved, booking
| rejected, driver document reviewed) still hold their copy in their own
| PHP classes. They belong to other agents' packages and are migrated into
| this file in their own pass rather than rewritten underneath them.
|
*/

return [

    'layout' => [
        'link_fallback' => 'Or paste this into your browser:',
        /*
         | The default button label, used only when a notification has not
         | said what the reader is about to do. A subclass that knows should
         | override it: "Upload it now" beats this every time, and a button
         | whose label names the destination rather than the task is a button
         | people do not press.
         */
        'open' => 'Open :app',
        'preferences' => 'Choose which emails you get',
    ],

    /*
     | The footer line that says why this email arrived.
     |
     | Not decoration. A transactional email with no stated reason is
     | indistinguishable from a phishing attempt, and the first email a new
     | client ever receives from this platform is one asking them to set a
     | password. Naming the account and the reason is what makes it credible.
     */
    'reason' => [
        'account' => 'You are receiving this because it affects the security of your :app account.',
        'driver' => 'You are receiving this because you drive on :app.',
        'client' => 'You are receiving this because you have a :app account for :company.',
        'fleet' => 'You are receiving this because you work at :company on :app.',
        'platform' => 'You are receiving this because you are a :app administrator.',
        'applicant' => 'You are receiving this because you applied to drive on :app.',
    ],

    /*
     | A1. The first email most users of this platform ever receive, and the
     | one most likely to be mistaken for a phishing attempt.
     |
     | Every line here is doing work against that. It names who created the
     | account, it names the company, it shows the address the account signs
     | in as, and it says plainly what happens if the reader was not expecting
     | it. Remove any one of those and it reads like a stranger asking for a
     | password.
     |
     | What it deliberately does not say: anything about what KangaruRide is.
     | The reader either works at a company that just signed up, or the email
     | is not for them, and a paragraph of product copy helps neither.
     */
    'invited' => [
        'subject' => 'Set your :app password',
        'heading' => 'Your account is ready',
        'opening' => 'An account was created for you on :app for :company.',
        'opening_by' => ':inviter created a :app account for you at :company.',
        'body' => 'Choose a password and you are in.',
        'action' => 'Set your password',
        'fact_company' => 'Company',
        'fact_email' => 'Signs in as',
        'fact_expires' => 'Link expires',
        'footnote' => 'If you were not expecting this, ignore it and nothing happens.',
    ],

    /*
     | A2. One reminder, and never a second. It carries no link because it
     | genuinely cannot: the token is a digest in the database and the
     | plaintext was destroyed when the first email was built.
     */
    'invitation_expiring' => [
        'subject' => 'Your invitation expires tomorrow',
        'heading' => 'Your invitation expires tomorrow',
        'body' => 'The link in your invitation email stops working tomorrow.',
        'lost' => 'If you no longer have that email, ask the person who set up your account to send it again.',
        'fact_expires' => 'Expires',
    ],

    /*
     | M6, the office families.
     |
     | Every one of these is a queue, not an interruption. Somebody has asked
     | the office for something and is waiting; the email exists so that
     | waiting has a bound when nobody happens to be at the board.
     |
     | So each says who and what, and points at the screen where the work is
     | done. None carries the driver's reason, the passenger's number or the
     | amount in dispute: an office inbox is read on a shared machine at a
     | depot desk, and those details live behind the permission that lets
     | somebody act on them.
     */
    'office' => [

        'fact_driver' => 'Driver',
        'fact_fleet' => 'Fleet',
        'fact_limit' => 'Limit',
        'fact_plan' => 'Plan',
        'fact_when' => 'Raised',

        'fleet_closure_requested' => [
            'subject' => ':driver asked to close their account',
            'heading' => ':driver asked to close their account',
            'body' => 'Nothing happens until somebody answers.',
            'action' => 'Open the request',
        ],

        'fleet_settlement_requested' => [
            'subject' => ':driver asked for a settlement',
            'heading' => ':driver asked for a settlement',
            'body' => 'Their balance does not change until somebody answers.',
            'action' => 'Open the request',
        ],

        'fleet_support_requested' => [
            'subject' => ':driver raised a support request',
            'heading' => ':driver raised a support request',
            'body' => 'They are waiting for an answer in the app.',
            'action' => 'Open the request',
        ],

        /*
         | The only office email that arrives at the moment somebody is
         | blocked, so it is the only one that says what to do about it.
         */
        'fleet_plan_limit_reached' => [
            'subject' => 'You have reached your plan limit',
            'heading' => 'You have reached your plan limit',
            'body' => 'Nobody can add another until you remove one or move to a larger plan.',
            'action' => 'Open your plan',
        ],

        'platform_fleet_onboarded' => [
            'subject' => ':fleet joined the platform',
            'heading' => ':fleet joined the platform',
            'body' => 'Their owner has been emailed an invitation to sign in.',
            'action' => 'Open the fleet',
        ],

        /*
         | ADR-0059 §5. The worklog has carried this as an open gap since K4:
         | "a number on a dashboard, not an alert. If the invariant breaks,
         | somebody has to be looking." Nobody may switch this one off.
         */
        // Keyed off the enum value `platform.fleet.no_account`, not off the
        // case name. `MailKeysTest` pins the whole set so this cannot drift
        // again: the first version said `has_no_account` and rendered the raw
        // key into somebody's subject line.
        'platform_fleet_no_account' => [
            'subject' => ':fleet has nobody who can sign in',
            'heading' => ':fleet has nobody who can sign in',
            'body' => 'Support cannot act as a fleet with no accounts. Somebody has to be invited before anything else can be done for them.',
            'action' => 'Open the fleet',
        ],

        'platform_walk_in_contract_requested' => [
            'subject' => ':driver asked for a walk in contract',
            'heading' => ':driver asked for a walk in contract',
            'body' => 'Their fleet has consented. It is yours to approve or refuse.',
            'action' => 'Open the request',
        ],

    ],

    /*
     | M5, the client family.
     |
     | Two audiences inside one client. Operations mail goes to the account
     | that raised the booking; finance mail goes to the contract's billing
     | address, which may belong to somebody with no account here at all. A
     | transport officer who books cars and the person who pays the bill are
     | different people at a bank.
     |
     | The invoice email carries the PDF *and* the link, which is the owner's
     | decision: finance staff forward the file, auditors follow the link to
     | the reproducible record.
     */
    'client' => [

        'fact_number' => 'Number',
        'fact_total' => 'Total',
        'fact_issued' => 'Issued',
        'fact_fleet' => 'Fleet',
        'fact_since' => 'Serving you since',
        'fact_until' => 'Ended',

        'client_invoice_issued' => [
            'subject' => 'Invoice :number',
            'heading' => 'Your invoice is ready',
            'body' => 'The PDF is attached. The link opens the full record, with every trip it covers.',
            'action' => 'Open the invoice',
        ],

        'client_credit_note_issued' => [
            'subject' => 'Credit note :number',
            'heading' => 'A credit note has been issued',
            'body' => 'It reduces what you owe on the invoice it refers to. The link opens the record.',
            'action' => 'Open the credit note',
        ],

        /*
         | ADR-0060 §5. Until this email existed, the `requested` row sat in a
         | table waiting for a client who had no way of knowing it was there.
         */
        'client_contract_requested' => [
            'subject' => ':fleet asked to serve your company',
            'heading' => ':fleet asked to serve your company',
            'body' => 'Nothing changes until you answer. They cannot see your trips, your invoices or your staff unless you approve them.',
            'action' => 'Answer the request',
        ],

        'client_contract_approved' => [
            'subject' => 'You approved :fleet',
            'heading' => 'You approved :fleet',
            'body' => 'They can now run trips for your company.',
            'action' => 'Open your fleets',
        ],

        'client_contract_ended' => [
            'subject' => 'Your contract with :fleet has ended',
            'heading' => 'Your contract with :fleet has ended',
            'body' => 'They will not be offered new trips for you. Your past trips and invoices are unchanged.',
            'action' => 'Open your fleets',
        ],

    ],

    /*
     | M4, the driver family. One class, `DriverEventNotification`, keyed by
     | notification type.
     |
     | Written to be read standing beside a car, in the sun, mid-shift. The
     | subject says the whole thing so it survives a phone's inbox list, the
     | body says what to do about it, and every date and amount goes in the
     | fact block rather than into a sentence where it can be misread.
     |
     | `next` is optional. A key that is absent is skipped rather than printed,
     | because not every event has a next step and "mail.driver.x.next" in
     | somebody's inbox is worse than saying nothing.
     */
    'driver' => [

        'fact_document' => 'Document',
        'fact_expires' => 'Expires',
        'fact_expired_on' => 'Expired',
        'fact_fleet' => 'Fleet',
        'fact_amount' => 'Amount',
        'fact_when' => 'When',
        'fact_week' => 'Week',
        'fact_trips' => 'Trips',

        'driver_application_received' => [
            'subject' => 'We have your application',
            'heading' => 'We have your application',
            'body' => 'The office will check your documents and come back to you.',
            'next' => 'You do not need to do anything yet.',
        ],

        'driver_application_approved' => [
            'subject' => 'You are approved to drive',
            'heading' => 'You are approved to drive',
            'body' => 'Sign in to the KangaruRide driver app with the email and password you used to apply.',
        ],

        'driver_application_rejected' => [
            'subject' => 'Your application was not approved',
            'heading' => 'Your application was not approved',
            'body' => 'The office has decided not to take your application further.',
        ],

        /*
         | The one AGENTS.md asked for by name and nothing ever built.
         | `driver_documents.expires_at` has been a column since ADR-0052 and
         | nothing read it on a schedule, so a licence could lapse with the
         | driver and the office both finding out when a traffic officer did.
         */
        'driver_document_expiring' => [
            'subject' => 'Your document is about to expire',
            'heading' => 'Your document is about to expire',
            /*
             | Was "Upload the renewed one before then", which read fine in the
             | plan and badly in the rendered email: "then" pointed at a date
             | that had since moved into the fact block, so the sentence
             | referred backwards to nothing. Found by rendering it, not by
             | reading it.
             */
            'body' => 'Upload the renewed one so you can keep working. The date is below.',
            'next' => 'Open the driver app and go to your documents.',
        ],

        'driver_document_expired' => [
            'subject' => 'Your document has expired',
            'heading' => 'Your document has expired',
            'body' => 'Upload the renewed one to go back on duty.',
            'next' => 'Open the driver app and go to your documents.',
        ],

        'driver_settlement_confirmed' => [
            'subject' => 'Your settlement is confirmed',
            'heading' => 'Your settlement is confirmed',
            'body' => 'The office has recorded it against your balance.',
        ],

        'driver_settlement_declined' => [
            'subject' => 'Your settlement was declined',
            'heading' => 'Your settlement was declined',
            'body' => 'Your balance has not changed.',
            'next' => 'Talk to your office if this is not what you expected.',
        ],

        'driver_walk_in_contract_approved' => [
            'subject' => 'Your walk in contract is approved',
            'heading' => 'Your walk in contract is approved',
            'body' => 'You can now be offered walk in trips as well as your fleet work.',
        ],

        'driver_walk_in_contract_refused' => [
            'subject' => 'Your walk in contract was refused',
            'heading' => 'Your walk in contract was refused',
            'body' => 'Your fleet work is not affected.',
        ],

        'driver_weekly_bonus_awarded' => [
            'subject' => 'You earned the weekly bonus',
            'heading' => 'You earned the weekly bonus',
            'body' => 'It is on your balance.',
        ],

    ],

    /*
     | M3, the security family. One class, `SecurityEventNotification`, and a
     | key per event.
     |
     | Every one of these is written for a reader who did NOT do the thing.
     | The person who clicked already knows; this email is the tripwire for the
     | person who did not, so each one ends with `not_you` and none of them
     | carries a link. A button offering to undo a change would be the single
     | most valuable thing on this platform to forge, because it is a link in a
     | security email that people are primed to click.
     |
     | None of them quotes the credential that changed. Not the password, not
     | the code, not the account number, not even masked. An email that repeats
     | the detail it is warning about hands that detail to whoever is reading
     | the mailbox, which in the case this exists for is the attacker.
     */
    'security' => [

        'not_you' => 'If this was not you, call your office now.',

        'fact_when' => 'When',
        'fact_ip' => 'From',
        'fact_remaining' => 'Codes left',

        'account_password_changed' => [
            'subject' => 'Your password was changed',
            'heading' => 'Your password was changed',
            'body' => 'Every device signed in to your account was signed out.',
        ],

        /*
         | Keyed on the browser, not the location, so this does not fire every
         | time a driver's mobile address changes. See the known_devices
         | migration.
         */
        'account_signed_in_new_device' => [
            'subject' => 'New sign in on a new device',
            'heading' => 'Somebody signed in on a new device',
            'body' => 'Your account was used from a browser it has not been used from before.',
        ],

        'account_mfa_enabled' => [
            'subject' => 'Two factor is on',
            'heading' => 'Two factor is on',
            'body' => 'Signing in now needs a code from your authenticator app. Keep your recovery codes somewhere safe.',
        ],

        'account_mfa_disabled' => [
            'subject' => 'Two factor is off',
            'heading' => 'Two factor is off',
            'body' => 'Signing in now needs only your password.',
        ],

        /*
         | ADR-0008 builds no administrator reset on purpose, so running out is
         | not an inconvenience. It is the end of the account.
         */
        'account_recovery_codes_low' => [
            'subject' => 'You are running out of recovery codes',
            'heading' => 'You are running out of recovery codes',
            'body' => 'You just used one to sign in. Generate a new set before the last one is gone, because nobody can reset two factor for you.',
        ],

        'account_suspended' => [
            'subject' => 'Your account is suspended',
            'heading' => 'Your account is suspended',
            'body' => 'You cannot sign in until somebody at your office turns it back on.',
        ],

        'account_reactivated' => [
            'subject' => 'Your account is active again',
            'heading' => 'Your account is active again',
            'body' => 'Sign in with the password you already had.',
        ],

        /*
         | Sent to the old address as well as the new one. The copy addressed
         | to the old mailbox is the last message the real owner will ever get
         | about this account if somebody else made the change.
         */
        'account_email_changed' => [
            'subject' => 'Your sign in email changed',
            'heading' => 'Your sign in email changed',
            'body' => 'This account now signs in with a different email address. This warning went to both the old address and the new one.',
        ],

        'driver_payout_account_changed' => [
            'subject' => 'Your payout account changed',
            'heading' => 'Your payout account changed',
            'body' => 'The office now pays your earnings into a different account.',
        ],

    ],

    /*
     | The settings screen test send. Not a notification, so it has no type
     | and nobody can switch it off.
     */
    'test' => [
        'subject' => ':app test email',
        'heading' => 'SMTP is working',
        'body' => 'This was sent from your platform settings using the SMTP details you saved.',
        'fact_host' => 'Sent through',
        'fact_from' => 'From address',
        'footnote' => 'Nobody else received this.',
        'reason' => 'You are receiving this because you asked for a test email from :app settings.',
    ],

];
