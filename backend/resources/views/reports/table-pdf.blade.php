{{--
    Any report, as a PDF. Deliberately plain: this document is evidence for
    a bank's transport reconciliation, so it favours legibility and a stated
    provenance over decoration. Inline styles because dompdf resolves no
    external stylesheets.

    Generic over the report: the title, the summary cells and the columns
    all arrive from the ReportSource. It replaced a trips-only view that
    indexed summary keys and column positions by hand — which meant a second
    report needed a second view, and the two would have drifted on styling
    the first time either was touched.
--}}
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>{{ $title }}</title>
    <style>
        @page { margin: 18mm 12mm 16mm; }
        body { font-family: DejaVu Sans, sans-serif; font-size: 7.5pt; color: #14181f; }
        h1 { font-size: 14pt; margin: 0 0 2mm; }
        .meta { font-size: 8pt; color: #55606f; margin-bottom: 4mm; }
        .summary { border: 1px solid #d8dee7; padding: 3mm; margin-bottom: 4mm; }
        .summary td { padding: 0 6mm 1mm 0; font-size: 8pt; }
        .summary .label { color: #55606f; }
        .summary .value { font-weight: bold; }
        table.rows { width: 100%; border-collapse: collapse; }
        table.rows th {
            background: #f2f5f9; text-align: left; padding: 1.6mm 1.2mm;
            border-bottom: 0.6pt solid #b9c2d0; font-size: 7pt;
        }
        table.rows td { padding: 1.4mm 1.2mm; border-bottom: 0.4pt solid #e6eaf0; }
        table.rows tr:nth-child(even) td { background: #fafbfd; }
        .num { text-align: right; }
        .foot { position: fixed; bottom: -10mm; left: 0; right: 0; font-size: 7pt; color: #55606f; }
    </style>
</head>
<body>
    <h1>{{ $heading }}</h1>

    <p class="meta">
        {{ $period }} · generated {{ $generatedAt->toDayDateTimeString() }}
    </p>

    @if (count($summaryCells) > 0)
        <table class="summary">
            <tr>
                @foreach ($summaryCells as $cell)
                    <td class="label">{{ $cell['label'] }}</td>
                @endforeach
            </tr>
            <tr>
                @foreach ($summaryCells as $cell)
                    <td class="value">{{ $cell['value'] }}</td>
                @endforeach
            </tr>
        </table>
    @endif

    <table class="rows">
        <thead>
            <tr>
                @foreach ($headers as $header)
                    <th>{{ $header }}</th>
                @endforeach
            </tr>
        </thead>
        <tbody>
            @forelse ($rows as $row)
                <tr>
                    @foreach ($row as $cell)
                        {{-- Right-aligned when the value is a number, rather
                             than by hardcoded column index: the old view
                             listed positions, which silently mis-aligned the
                             moment a column moved. --}}
                        <td class="{{ is_int($cell) || is_float($cell) ? 'num' : '' }}">
                            {{ $cell === null || $cell === '' ? '—' : $cell }}
                        </td>
                    @endforeach
                </tr>
            @empty
                <tr><td colspan="{{ count($headers) }}">{{ $emptyMessage }}</td></tr>
            @endforelse
        </tbody>
    </table>

    <div class="foot">
        KangaruRide · Shanitah General Enterprises Ltd
    </div>

    <script type="text/php">
        // dompdf's only way to number pages: it runs this at render time,
        // once the total is known.
        if (isset($pdf)) {
            $pdf->page_text(
                520, 812, "Page {PAGE_NUM} of {PAGE_COUNT}",
                $fontMetrics->getFont("DejaVu Sans"), 7, [0.33, 0.38, 0.44]
            );
        }
    </script>
</body>
</html>
