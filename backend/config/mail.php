<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Default Mailer
    |--------------------------------------------------------------------------
    |
    | This option controls the default mailer that is used to send all email
    | messages unless another mailer is explicitly specified when sending
    | the message. All additional mailers can be configured within the
    | "mailers" array. Examples of each type of mailer are provided.
    |
    */

    'default' => env('MAIL_MAILER', 'log'),

    /*
    |--------------------------------------------------------------------------
    | Transport for the settings-built mailer
    |--------------------------------------------------------------------------
    |
    | `SettingsService::smtpMailer()` builds its own mailer at send time from
    | the SMTP details the owner saved, rather than from anything in this file.
    | That is deliberate (ADR-0014): a boot-time read would make `migrate` on a
    | fresh database depend on the table it is about to create.
    |
    | This key exists only so a test can reach that method without a mail
    | server. `Mail::fake()` does not intercept `Mail::build()`, so the path
    | was previously uncoverable. phpunit.xml sets it to `array`; leave it
    | alone everywhere else.
    |
    */

    'settings_transport' => env('MAIL_SETTINGS_TRANSPORT', 'smtp'),

    /*
    |--------------------------------------------------------------------------
    | Mailer Configurations
    |--------------------------------------------------------------------------
    |
    | Here you may configure all of the mailers used by your application plus
    | their respective settings. Several examples have been configured for
    | you and you are free to add your own as your application requires.
    |
    | Laravel supports a variety of mail "transport" drivers that can be used
    | when delivering an email. You may specify which one you're using for
    | your mailers below. You may also add additional mailers if needed.
    |
    | Supported: "smtp", "sendmail", "mailgun", "ses", "ses-v2",
    |            "postmark", "resend", "log", "array",
    |            "failover", "roundrobin"
    |
    */

    'mailers' => [

        'smtp' => [
            'transport' => 'smtp',
            'scheme' => env('MAIL_SCHEME'),
            'url' => env('MAIL_URL'),
            'host' => env('MAIL_HOST', '127.0.0.1'),
            'port' => env('MAIL_PORT', 2525),
            'username' => env('MAIL_USERNAME'),
            'password' => env('MAIL_PASSWORD'),
            'timeout' => null,
            'local_domain' => env('MAIL_EHLO_DOMAIN', parse_url((string) env('APP_URL', 'http://localhost'), PHP_URL_HOST)),
        ],

        'ses' => [
            'transport' => 'ses',
        ],

        'postmark' => [
            'transport' => 'postmark',
            // 'message_stream_id' => env('POSTMARK_MESSAGE_STREAM_ID'),
            // 'client' => [
            //     'timeout' => 5,
            // ],
        ],

        'resend' => [
            'transport' => 'resend',
        ],

        'sendmail' => [
            'transport' => 'sendmail',
            'path' => env('MAIL_SENDMAIL_PATH', '/usr/sbin/sendmail -bs -i'),
        ],

        'log' => [
            'transport' => 'log',
            'channel' => env('MAIL_LOG_CHANNEL'),
        ],

        'array' => [
            'transport' => 'array',
        ],

        'failover' => [
            'transport' => 'failover',
            'mailers' => [
                'smtp',
                'log',
            ],
            'retry_after' => 60,
        ],

        'roundrobin' => [
            'transport' => 'roundrobin',
            'mailers' => [
                'ses',
                'postmark',
            ],
            'retry_after' => 60,
        ],

    ],

    /*
    |--------------------------------------------------------------------------
    | Global "From" Address
    |--------------------------------------------------------------------------
    |
    | You may wish for all emails sent by your application to be sent from
    | the same address. Here you may specify a name and address that is
    | used globally for all emails that are sent by your application.
    |
    */

    'from' => [
        'address' => env('MAIL_FROM_ADDRESS', 'hello@example.com'),
        'name' => env('MAIL_FROM_NAME', env('APP_NAME', 'Laravel')),
    ],

    /*
    |--------------------------------------------------------------------------
    | Markdown Mail
    |--------------------------------------------------------------------------
    |
    | Framework defaults, and nothing in this application uses them.
    |
    | This block used to carry a custom `kangaru` theme and a published view
    | path, and a comment saying "booking decisions, export notices, closure
    | answers and document reviews all render through `mail::message`, so a
    | theme is the only edit that reaches all of them at once". That was true
    | when it was written and is not true now: no `MailMessage` and no
    | `Mailable` remains in the codebase, so the markdown renderer was
    | unreachable and the published theme was styling nothing.
    |
    | Both overrides were deleted with mail plan M3 rather than left in place.
    | A stylesheet that appears to control every email and controls none of
    | them is worse than no stylesheet: the next person to change a colour
    | would have changed it there and seen no effect.
    |
    | **Emails are built as `MailContent` and rendered by `MailRenderer`**
    | through `resources/views/mail/layout.blade.php` and its plain text
    | partner. See `Modules/Notifications/README.md` and `docs/mail-plan.md`
    | §4. If you find yourself writing a Mailable, that is the thing to reach
    | for instead.
    |
    */

    'markdown' => [
        'theme' => env('MAIL_THEME', 'default'),

        'paths' => [
            resource_path('views/vendor/mail'),
        ],
    ],

];
