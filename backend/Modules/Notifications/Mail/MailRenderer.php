<?php

namespace Modules\Notifications\Mail;

use Illuminate\Contracts\View\Factory as ViewFactory;
use Illuminate\Support\Facades\Storage;
use Modules\Administration\Services\SettingsService;

/**
 * Turns a `MailContent` into the two bodies that go on the wire.
 *
 * Separated from `SettingsMailChannel` so a template can be rendered without
 * sending anything. That is what the template tests use, and it is what makes
 * "does this email look right" answerable without an SMTP server, which
 * matters because there is no SMTP server on a developer's machine and
 * checking mail in a browser beats guessing.
 */
class MailRenderer
{
    public function __construct(
        private readonly SettingsService $settings,
        private readonly ViewFactory $views,
    ) {}

    /**
     * @return array{html: string, text: string}
     */
    public function render(MailContent $content, string $reason, ?string $preferencesUrl = null): array
    {
        $data = [
            'content' => $content,
            'reason' => $reason,
            'preferencesUrl' => $preferencesUrl,
            'appName' => $this->appName(),
            'logoUrl' => $this->logoUrl(),
        ];

        return [
            'html' => $this->views->make('mail.layout', $data)->render(),
            'text' => $this->normaliseText($this->views->make('mail.layout-text', $data)->render()),
        ];
    }

    public function appName(): string
    {
        return (string) $this->settings->get('branding', 'app_name');
    }

    /**
     * The logo, absolute, or null.
     *
     * Null is a supported outcome and the layout renders the app name in its
     * place. A broken image in the header of the first email a client ever
     * receives is worse than no image, and a deployment that has not uploaded
     * a logo yet is the normal state of a fresh install.
     *
     * Absolute because a relative path in an email client resolves against
     * nothing. Same reason `KangaruNotification::toMail()` made its action URL
     * absolute.
     */
    public function logoUrl(): ?string
    {
        $path = $this->settings->get('branding', 'logo_path');

        if (! is_string($path) || $path === '') {
            return null;
        }

        // Already absolute: a deployment may point at a CDN or at the
        // marketing site rather than at the public disk.
        if (str_starts_with($path, 'http://') || str_starts_with($path, 'https://')) {
            return $path;
        }

        return Storage::disk('public')->url($path);
    }

    /**
     * Blade leaves the text template full of the blank lines its own control
     * structures sat on.
     *
     * Left alone, a plain text email arrives with six-line gaps between
     * paragraphs and reads as broken rather than as plain. Collapsing runs of
     * blank lines to one is the whole fix, and it is done here rather than by
     * contorting the template, because a template written around whitespace is
     * a template nobody can edit safely.
     */
    private function normaliseText(string $text): string
    {
        $text = preg_replace("/\r\n|\r/", "\n", $text) ?? $text;
        $text = preg_replace("/[ \t]+\n/", "\n", $text) ?? $text;
        $text = preg_replace("/\n{3,}/", "\n\n", $text) ?? $text;

        return trim($text)."\n";
    }
}
