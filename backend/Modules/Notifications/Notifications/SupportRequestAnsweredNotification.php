<?php

namespace Modules\Notifications\Notifications;

use Modules\Notifications\Enums\NotificationType;
use Modules\Support\Models\SupportRequest;

/**
 * Tells a driver the office has answered their report (ADR-0044 §4).
 *
 * **This is the half of the feature that makes the other half worth building.**
 * A report queue with no return path is the same silence a phone call into a
 * voicemail box is, and `master-plan.md` §2's completeness gate names exactly
 * this part as the one most often missing.
 *
 * The argument `NotificationType`'s docblock asks for — "a type not on
 * AGENTS.md's list needs an argument, not just a use case" — is that this is
 * the **only** message on this platform the recipient explicitly asked for.
 * Every other notification tells somebody about an event; this one answers a
 * question they wrote down themselves, and it is bounded at one per report.
 *
 * The answer itself is deliberately **not** in the push body. It is somebody's
 * account of a passenger dispute or a payment they are owed, and a lock screen
 * is read over a shoulder in traffic. The row says an answer arrived and where
 * to read it.
 */
class SupportRequestAnsweredNotification extends KangaruNotification
{
    public function __construct(
        private readonly int $requestId,
        private readonly string $topicLabel,
    ) {}

    public static function for(SupportRequest $request): self
    {
        return new self($request->id, $request->topic->label());
    }

    public function type(): NotificationType
    {
        return NotificationType::DRIVER_SUPPORT_ANSWERED;
    }

    public function subject(): string
    {
        // Names the topic, because a driver may have more than one report
        // open and "The office replied" alone would not say which.
        return "The office answered: {$this->topicLabel}";
    }

    public function body(): string
    {
        return 'Open your reports to read what they said.';
    }

    /**
     * Null, like every driver-facing notification on this platform.
     *
     * `url()` is a path into the staff SPA and a driver is not in a browser.
     * The app routes from `context()` below — `support_request_id` is what its
     * tap handler opens.
     */
    public function url(): ?string
    {
        return null;
    }

    /**
     * @return array<string, mixed>
     */
    public function context(): array
    {
        return [
            'support_request_id' => $this->requestId,
            'topic_label' => $this->topicLabel,
        ];
    }
}
