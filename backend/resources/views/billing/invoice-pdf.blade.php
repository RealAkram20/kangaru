{{--
    The invoice, as a file a finance officer can forward and file.

    ## Why this exists as well as a link

    The owner asked for both (mail plan §10). Finance staff forward the PDF to
    a colleague and attach it to a payment request; auditors follow the link to
    the live record. Serving only one of those loses one of them.

    ## Rendered by dompdf, which is why this looks like 2005

    Tables, inline styles, no flexbox and no grid. dompdf supports a narrow
    slice of CSS and fails silently on the rest, so anything clever here comes
    out as a blank page rather than as an error. The report PDF beside this one
    made the same choices for the same reason.

    Hex values rather than tokens, transcribed from DESIGN.md §1, on the same
    footing as the email layout: there are no CSS variables in this renderer
    either.

    ## Every figure comes from the invoice row

    Nothing is recalculated here. PRODUCT.md's positioning is that an invoice
    is reproducible from stored data, and a template that added its own
    arithmetic would be a second place for the total to come from.
--}}
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{{ $invoice->invoice_number }}</title>
<style>
    @page { margin: 28mm 18mm; }
    body {
        font-family: DejaVu Sans, sans-serif;
        font-size: 10pt;
        color: #1A2233;
        margin: 0;
    }
    .muted { color: #5B6472; }
    .right { text-align: right; }
    h1 { font-size: 20pt; margin: 0 0 2mm; color: #001028; }
    table { width: 100%; border-collapse: collapse; }
    .lines th {
        text-align: left;
        font-size: 8pt;
        letter-spacing: 0.4pt;
        text-transform: uppercase;
        color: #5B6472;
        border-bottom: 1px solid #D6DAE1;
        padding: 0 0 2mm;
    }
    .lines td { padding: 2.5mm 0; border-bottom: 1px solid #E6E8EC; vertical-align: top; }
    .total td { padding-top: 4mm; font-size: 12pt; font-weight: bold; color: #001028; border: 0; }
</style>
</head>
<body>

<table>
<tr>
    <td>
        <h1>Invoice</h1>
        <div class="muted">{{ $appName }}</div>
    </td>
    <td class="right">
        {{-- Monospace-ish and large: an invoice number misread is a payment
             applied to the wrong document, which is a reconciliation somebody
             does by hand a month later. --}}
        <div style="font-size: 13pt; font-weight: bold; color: #001028;">{{ $invoice->invoice_number }}</div>
        <div class="muted">Issued {{ $invoice->issued_at->isoFormat('D MMMM YYYY') }}</div>
    </td>
</tr>
</table>

<table style="margin-top: 10mm;">
<tr>
    <td style="width: 50%;">
        <div class="muted" style="font-size: 8pt; text-transform: uppercase; letter-spacing: 0.4pt;">Billed to</div>
        <div style="margin-top: 1.5mm;">{{ $billedTo }}</div>
    </td>
    <td style="width: 50%;">
        @if ($servedBy !== null)
            <div class="muted" style="font-size: 8pt; text-transform: uppercase; letter-spacing: 0.4pt;">Served by</div>
            <div style="margin-top: 1.5mm;">{{ $servedBy }}</div>
        @endif
    </td>
</tr>
</table>

<table class="lines" style="margin-top: 10mm;">
<thead>
<tr>
    <th>Description</th>
    <th class="right" style="width: 30mm;">Amount</th>
</tr>
</thead>
<tbody>
@forelse ($lines as $line)
    <tr>
        <td>{{ $line['description'] }}</td>
        <td class="right">{{ $line['amount'] }}</td>
    </tr>
@empty
    {{-- An invoice with no lines should not exist, and if one reaches here
         the document says so rather than printing an empty box that reads as
         a rendering fault. --}}
    <tr><td colspan="2" class="muted">This invoice has no lines.</td></tr>
@endforelse
</tbody>
<tfoot>
<tr class="total">
    <td class="right">Total</td>
    <td class="right">{{ $total }}</td>
</tr>
</tfoot>
</table>

<p class="muted" style="margin-top: 14mm; font-size: 8pt;">
    {{ $appName }} · {{ $invoice->invoice_number }}
</p>

</body>
</html>
