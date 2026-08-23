{{--
    The one shell every KangaruRide email uses.

    Read `docs/mail-plan.md` §4 before changing anything here. Three rules in
    it are load-bearing and look like arbitrary restrictions if you meet them
    only in this file:

    1. **Inline styles, hex values, tables.** Email has no CSS variables, no
       external stylesheet and no reliable flexbox. The hex values below are
       transcribed from DESIGN.md §1 and this file is the only place in the
       codebase allowed to hold a raw hex outside DESIGN.md itself and the
       token definitions. Change a colour there first, then here.

    2. **No web fonts.** Sora, Inter and JetBrains Mono are self-hosted and no
       mail client will fetch them. Outlook ignores @font-face entirely. Most
       readers see Segoe UI or Arial and that is the intended outcome, so the
       stack is ordered to degrade sensibly rather than to pretend.

    3. **No icons.** DESIGN.md is Lucide-only and that still holds, but Gmail
       strips inline SVG, Outlook renders it as nothing, and every major client
       blocks remote images until the reader allows them. An email whose
       meaning depends on an icon arrives meaningless. The logo is the one
       image, it carries real alt text, and the layout is correct without it.
--}}
<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
{{-- Declares that the page handles both, which stops Gmail and Outlook
     force-inverting the palette into something unreadable. Paired with the
     media query below; neither works alone. --}}
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>{{ $content->subject }}</title>
<style>
    /* Dark mode. Measured, not eyeballed: the first version of this block
       shipped a header band at #001028 on a page ground of #001028, which is
       1.00:1 and means the band was not there at all, and green links at
       2.08:1 which is less than half the AA floor.

       The rules that fixed it are DESIGN.md's own. §3 "Text on navy surfaces"
       makes primary text #FBFBFB, so links on navy are white and underlined
       rather than a green invented for the occasion. §1 makes brand-navy-soft
       the elevated surface on navy, so the band and the card share it and the
       page ground stays brand-navy behind them.

       Measured after the change, against #0A1F3D:
         body text #FBFBFB   15.90:1
         links     #FBFBFB   15.90:1
         muted     #979DA9    6.04:1 */
    @media (prefers-color-scheme: dark) {
        .kr-body { background-color: #001028 !important; }
        .kr-card { background-color: #0A1F3D !important; }
        .kr-band { background-color: #0A1F3D !important; border-bottom: 1px solid #293348 !important; }
        .kr-text { color: #FBFBFB !important; }
        .kr-muted { color: #979DA9 !important; }
        .kr-rule { border-color: #293348 !important; }
        .kr-fact { background-color: #001028 !important; }
        .kr-link { color: #FBFBFB !important; }
    }
    /* Under 480px the fact rows stop being two columns. A label and a value
       squeezed side by side on a handset wrap into each other and the reader
       cannot tell which value belongs to which label. */
    @media only screen and (max-width: 480px) {
        .kr-shell { width: 100% !important; }
        .kr-pad { padding-left: 24px !important; padding-right: 24px !important; }
        .kr-fact-label, .kr-fact-value { display: block !important; width: 100% !important; text-align: left !important; }
        .kr-fact-value { padding-top: 2px !important; }
    }
</style>
</head>
<body class="kr-body" style="margin:0; padding:0; background-color:#F4F5F7; -webkit-font-smoothing:antialiased;">

{{-- The preview line. Hidden in the body, read by the inbox list. The run of
     zero-width joiners after it stops Gmail pulling the footer in to pad the
     preview out to its preferred length. --}}
<div style="display:none; font-size:1px; line-height:1px; max-height:0; max-width:0; opacity:0; overflow:hidden;">
    {{ $content->preheaderLine() }}
    {!! str_repeat('&#8204;&nbsp;', 60) !!}
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="kr-body" style="background-color:#F4F5F7;">
<tr>
<td align="center" style="padding:24px 12px;">

    <table role="presentation" class="kr-shell" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:600px;">

        {{-- Navy band. Logo only. Nothing else has earned a place above the
             heading, and a nav bar in an email is a website that got lost. --}}
        <tr>
        <td align="left" class="kr-band" style="background-color:#001028; border-radius:12px 12px 0 0; padding:24px 32px;">
            @if ($logoUrl)
                <img src="{{ $logoUrl }}" width="132" alt="{{ $appName }}" style="display:block; border:0; width:132px; max-width:132px; height:auto;">
            @else
                <span style="font-family:Inter,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:18px; font-weight:600; color:#FBFBFB; letter-spacing:-0.2px;">{{ $appName }}</span>
            @endif
        </td>
        </tr>

        <tr>
        <td class="kr-card kr-pad" style="background-color:#FFFFFF; padding:32px;">

            <h1 class="kr-text" style="margin:0 0 16px; font-family:Inter,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:22px; line-height:30px; font-weight:600; color:#001028; letter-spacing:-0.3px;">{{ $content->heading }}</h1>

            @foreach ($content->paragraphs as $paragraph)
                <p class="kr-text" style="margin:0 0 14px; font-family:Inter,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:15px; line-height:24px; color:#1A2233;">{{ $paragraph }}</p>
            @endforeach

            @if ($content->facts !== [])
                {{-- Facts are rows, never sentences. A date buried in a
                     paragraph is a date somebody misreads. --}}
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="kr-fact" style="margin:20px 0 4px; background-color:#F7F8FA; border-radius:8px;">
                    @foreach ($content->facts as $label => $value)
                    <tr>
                        <td class="kr-fact-label kr-muted" style="padding:10px 16px; font-family:Inter,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:13px; line-height:20px; color:#5B6472;">{{ $label }}</td>
                        <td class="kr-fact-value kr-text" align="right" style="padding:10px 16px; font-family:Inter,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:14px; line-height:20px; font-weight:500; color:#001028;">{{ $value }}</td>
                    </tr>
                    @endforeach
                </table>
            @endif

            @if ($content->hasAction())
                {{-- One button. See MailContent for why there is never a
                     second one.

                     **brand-green-hover (#016B2E), not brand-green.** DESIGN.md
                     §3 allows brand-green for a semibold label by treating it
                     as large text, but WCAG's large-text threshold is 18.66px
                     bold and this label is 15px/600, so it does not qualify:
                     white on brand-green measures 4.01:1, under the 4.5:1
                     floor. DESIGN.md provides the escape hatch itself in the
                     same section, and it costs nothing here because an email
                     has no hover state for the hover colour to collide with.
                     White on #016B2E measures 6.46:1. --}}
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 4px;">
                <tr>
                <td align="center" bgcolor="#016B2E" style="border-radius:8px;">
                    <a href="{{ $content->actionUrl }}" style="display:inline-block; padding:12px 28px; font-family:Inter,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:15px; line-height:20px; font-weight:600; color:#FFFFFF; text-decoration:none; border-radius:8px; background-color:#016B2E;">{{ $content->actionLabel }}</a>
                </td>
                </tr>
                </table>

                {{-- The copyable link. A button alone strands anybody whose
                     client mangles the href, and "click the button" is not
                     advice they can act on. --}}
                <p class="kr-muted" style="margin:14px 0 0; font-family:Inter,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:12px; line-height:18px; color:#5B6472; word-break:break-all;">{{ __('mail.layout.link_fallback') }} <span class="kr-link" style="font-family:Consolas,'Courier New',monospace; color:#015E35;">{{ $content->actionUrl }}</span></p>
            @endif

            @if ($content->footnote)
                <p class="kr-muted" style="margin:20px 0 0; font-family:Inter,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:13px; line-height:20px; color:#5B6472;">{{ $content->footnote }}</p>
            @endif

        </td>
        </tr>

        {{-- Who sent this, why it arrived, and how to stop it. Nothing else.
             No tagline, no social links, no marketing: screen rules §9 holds
             here, and a footer is where it is broken most often. --}}
        <tr>
        <td class="kr-card kr-pad kr-rule" style="background-color:#FFFFFF; border-top:1px solid #E6E8EC; border-radius:0 0 12px 12px; padding:20px 32px 24px;">
            <p class="kr-muted" style="margin:0; font-family:Inter,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:12px; line-height:19px; color:#5B6472;">
                {{ $reason }}
                @if ($preferencesUrl)
                    <br><a href="{{ $preferencesUrl }}" class="kr-link" style="color:#015E35; text-decoration:underline;">{{ __('mail.layout.preferences') }}</a>
                @endif
            </p>
        </td>
        </tr>

        <tr>
        <td align="center" style="padding:18px 32px 0;">
            <p class="kr-muted" style="margin:0; font-family:Inter,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:11px; line-height:17px; color:#8A919C;">{{ $appName }}</p>
        </td>
        </tr>

    </table>

</td>
</tr>
</table>

</body>
</html>
