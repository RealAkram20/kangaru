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
