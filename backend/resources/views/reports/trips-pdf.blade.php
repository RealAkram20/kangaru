{{--
    Trip report, PDF. Deliberately plain: this document is evidence for a
    bank's transport reconciliation, so it favours legibility and a stated
    provenance over decoration. Inline styles because dompdf resolves no
    external stylesheets.
--}}
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>KangaruRide — Trip report</title>
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
        .incomplete { color: #b3541e; font-weight: bold; }
    </style>
</head>
<body>
    <h1>Trip report</h1>

    <p class="meta">
        @php
            $from = isset($filters['from']) ? date('j M Y', strtotime($filters['from'])) : 'the beginning';
            $to = isset($filters['to']) ? date('j M Y', strtotime($filters['to'])) : 'today';
        @endphp
        Trips commencing {{ $from }} to {{ $to }}
        · generated {{ $generatedAt->toDayDateTimeString() }}
    </p>

    <table class="summary">
        <tr>
            <td class="label">Trips</td>
            <td class="label">Completed</td>
            <td class="label">Distance</td>
            <td class="label">Time on the road</td>
            <td class="label">Records complete</td>
        </tr>
        <tr>
            <td class="value">{{ number_format($summary['trips']) }}</td>
            <td class="value">{{ number_format($summary['trips_completed']) }}</td>
            <td class="value">{{ number_format((float) $summary['distance_km'], 2) }} km</td>
            <td class="value">{{ number_format($summary['duration_minutes']) }} min</td>
            <td class="value">
                {{-- Never render an invented 100% over an empty set. --}}
                @if ($summary['completeness_percent'] === null)
                    n/a
                @else
                    {{ $summary['completeness_percent'] }}%
                @endif
            </td>
        </tr>
    </table>

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
                    @foreach ($row as $index => $cell)
                        <td class="{{ in_array($index, [10, 11, 12, 13], true) ? 'num' : '' }}">
                            @if ($index === 15 && $cell === 'No')
                                <span class="incomplete">{{ $cell }}</span>
                            @else
                                {{ $cell ?? '—' }}
                            @endif
                        </td>
                    @endforeach
                </tr>
            @empty
                <tr><td colspan="{{ count($headers) }}">No trips commenced in this period.</td></tr>
            @endforelse
        </tbody>
    </table>

    <div class="foot">
        KangaruRide · Shanitah General Enterprises Ltd · page <span class="pagenum"></span>
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
