{{--
    The KangaruRide notification email.

    Published from Laravel's own `notifications::email` and cut down. Four
    things the framework's version says that this one does not, each removed
    for a reason rather than for brevity's own sake:

    1. **"Hello!"** — a heading that greets nobody, on every message the
       platform sends. It pushed the actual sentence below the fold on a
       phone. A real greeting still renders; the placeholder does not.
    2. **"Regards, KangaruRide"** — a sign-off on an automated message from a
       system, above a footer that already says who sent it. Twice in eight
       words.
    3. **"Whoops!"** on an error-level message. Nothing this platform emails
       anybody is a whoops.
    4. **The two-line subcopy** explaining what to do if a button does not
       work. Shortened rather than dropped: it is genuinely load-bearing in
       clients that strip buttons, and a driver whose mail app renders no
       button is exactly the person who needs the address.

    What is left is a heading only when there is something to head, the
    sentences, and the action. `AGENTS.md` asks every error to say what
    happened and what to do next; the same standard reads better as two short
    lines than as five polite ones.
--}}
<x-mail::message>
{{-- Greeting. Rendered only when a notification set one — never a generic. --}}
@if (! empty($greeting))
# {{ $greeting }}
@endif

{{-- Intro Lines --}}
@foreach ($introLines as $line)
{{ $line }}

@endforeach

{{-- Action Button --}}
@isset($actionText)
<?php
    $color = match ($level) {
        'success', 'error' => $level,
        default => 'primary',
    };
?>
<x-mail::button :url="$actionUrl" :color="$color">
{{ $actionText }}
</x-mail::button>
@endisset

{{-- Outro Lines --}}
@foreach ($outroLines as $line)
{{ $line }}

@endforeach

{{-- Salutation. Only a deliberate one; no automatic "Regards". --}}
@if (! empty($salutation))
{{ $salutation }}
@endif

{{-- Subcopy: one line, and only when there is a button to fall back from. --}}
@isset($actionText)
<x-slot:subcopy>
@lang('If the button does not work, use this address:') <span class="break-all">[{{ $displayableActionUrl }}]({{ $actionUrl }})</span>
</x-slot:subcopy>
@endisset
</x-mail::message>
