<?php

namespace Modules\Notifications\Console;

use Illuminate\Console\Command;
use Modules\Notifications\Mail\MailContent;
use Modules\Notifications\Mail\MailRenderer;

/**
 * Renders the email shell to files so somebody can look at it.
 *
 * ## Why this exists
 *
 * `docs/screen-rules.md` §8: *"Run or render the thing. Green tests over
 * formatters do not prove a screen mounts."* An email is the surface where
 * that is hardest to obey, because there is no route to open and no dev
 * server to point at, and the failure modes are all visual. The first version
 * of the shell passed every test it had while rendering a header band at
 * 1.00:1 against the page ground, which is to say no header band, and green
 * links at 2.08:1, which is under half the AA floor. A test could not have
 * seen either. A browser saw both in one screenshot.
 *
 * Three samples rather than one, because they exercise different halves of
 * the layout: one with facts and an action, one with facts and a different
 * action label, and one with neither. The third is the one that catches a
 * shell which only holds together when it is full.
 *
 * Open the files in a browser and toggle the OS between light and dark.
 */
class PreviewMail extends Command
{
    protected $signature = 'mail:preview {--out= : Directory to write to. Defaults to storage/app/mail-preview.}';

    protected $description = 'Render the email layout to HTML and text files so it can be checked in a browser';

    public function handle(MailRenderer $renderer): int
    {
        // Cast, because `option()` is typed array|bool|string on the
        // framework's contract even for a value option like this one.
        $out = $this->option('out');
        $dir = is_string($out) && $out !== '' ? $out : storage_path('app/mail-preview');

        if (! is_dir($dir) && ! mkdir($dir, 0777, true) && ! is_dir($dir)) {
            $this->error("Could not create {$dir}.");

            return self::FAILURE;
        }

        foreach ($this->samples() as $name => $content) {
            ['html' => $html, 'text' => $text] = $renderer->render(
                $content,
                'You are receiving this because you have a KangaruRide account for Nakumatt Ltd.',
                // The third sample has none, which is how a required email
                // renders: offering a switch and then refusing it is worse
                // than not offering one.
                $name === 'no-action' ? null : 'http://localhost:5173/settings/notifications',
            );

            file_put_contents("{$dir}/mail-{$name}.html", $html);
            file_put_contents("{$dir}/mail-{$name}.txt", $text);

            $this->line(sprintf('  %-12s %6d bytes html   %5d bytes text', $name, strlen($html), strlen($text)));
        }

        $this->newLine();
        $this->info("Written to {$dir}");
        $this->line('Open them in a browser and toggle the OS theme. Gmail clips anything over 100KB.');

        return self::SUCCESS;
    }

    /**
     * @return array<string, MailContent>
     */
    private function samples(): array
    {
        return [
            'with-facts' => new MailContent(
                subject: 'Set your KangaruRide password',
                heading: 'Your account is ready',
                paragraphs: [
                    'Shanitah General Enterprises created a KangaruRide account for you at Nakumatt Ltd.',
                    'Choose a password and you are in.',
                ],
                facts: [
                    'Company' => 'Nakumatt Ltd',
                    'Signs in as' => 'grace@nakumatt.test',
                    'Invitation expires' => '30 August 2026',
                ],
                actionLabel: 'Set your password',
                actionUrl: 'http://localhost:5173/invite/8f2a91c4de',
                footnote: 'If you were not expecting this, ignore it and nothing happens.',
            ),
            'long-values' => new MailContent(
                subject: 'Your licence expires in 30 days',
                heading: 'Your licence expires in 30 days',
                paragraphs: [
                    'Your driving licence on file expires on 22 September 2026.',
                    'Upload the renewed licence before then to stay on duty.',
                ],
                facts: [
                    'Document' => 'Driving licence',
                    'Expires' => '22 September 2026',
                    'Fleet' => 'Shanitah General Enterprises Ltd',
                ],
                actionLabel: 'Upload it now',
                actionUrl: 'http://localhost:5173/documents',
            ),
            'no-action' => new MailContent(
                subject: 'Your password reset code',
                heading: 'Your reset code is 402317',
                paragraphs: ['It expires in 15 minutes. If you did not ask for it, your password has not changed.'],
            ),
        ];
    }
}
