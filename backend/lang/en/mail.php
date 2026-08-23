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
