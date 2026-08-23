{{--
    The message frame every KangaruRide email renders inside.

    Published from Laravel's own `mail::message` with one change: the footer.

    The framework's reads "© 2026 KangaruRide. All rights reserved." — a
    copyright notice on an operational message to a driver about their driving
    licence. It asserts nothing anybody needs and it is the last thing on the
    page, which is the position a *useful* line should have.

    What replaces it is the line a recipient actually wants at the bottom of an
    automated message: who sent it, and the fact that replying will not reach a
    person. `AGENTS.md` asks every message to say what to do next, and for this
    one the honest answer is "not here".

    Everything else — header, body, subcopy, layout — resolves to the
    framework's components, so a Laravel upgrade that changes their markup
    keeps working.
--}}
<x-mail::layout>
{{-- Header --}}
<x-slot:header>
<x-mail::header :url="config('app.frontend_url') ?: config('app.url')">
{{ config('app.name') }}
</x-mail::header>
</x-slot:header>

{{-- Body --}}
{!! $slot !!}

{{-- Subcopy --}}
@isset($subcopy)
<x-slot:subcopy>
<x-mail::subcopy>
{!! $subcopy !!}
</x-mail::subcopy>
</x-slot:subcopy>
@endisset

{{-- Footer --}}
<x-slot:footer>
<x-mail::footer>
{{ config('app.name') }} — this message is automated, so please do not reply to it.
</x-mail::footer>
</x-slot:footer>
</x-mail::layout>
