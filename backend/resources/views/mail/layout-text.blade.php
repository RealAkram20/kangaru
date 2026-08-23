{{--
    The plain text half of every email.

    Not optional and not a fallback nobody sees. Two audiences read this one
    rather than the HTML: spam filters, which score a multipart message with
    an empty or auto-generated text part lower than one written on purpose;
    and drivers upcountry whose mail app is set to text to save data, which
    PRODUCT.md's operating context makes a real population rather than a
    hypothetical one.

    It carries the same facts as the HTML in the same order. If the two ever
    disagree, this file is the one that is wrong, because the HTML is what the
    template tests render.
--}}
{{ $content->heading }}

@foreach ($content->paragraphs as $paragraph)
{{ $paragraph }}

@endforeach
@if ($content->facts !== [])
@foreach ($content->facts as $label => $value)
{{ $label }}: {{ $value }}
@endforeach

@endif
@if ($content->hasAction())
{{ $content->actionLabel }}:
{{ $content->actionUrl }}

@endif
@if ($content->footnote)
{{ $content->footnote }}

@endif
--
{{ $reason }}
@if ($preferencesUrl)
{{ __('mail.layout.preferences') }}: {{ $preferencesUrl }}
@endif

{{ $appName }}
