<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body { font-family: DejaVu Sans, sans-serif; font-size: 11px; color: #0f172a; }
        h1 { font-size: 18px; margin-bottom: 4px; }
        .meta { font-size: 10px; color: #64748b; margin-bottom: 16px; }
        .kpis { display: table; width: 100%; margin: 16px 0; }
        .kpi-row { display: table-row; }
        .kpi-cell { display: table-cell; padding: 10px 16px; border: 1px solid #e2e8f0; }
        .kpi-label { font-size: 10px; color: #64748b; }
        .kpi-value { font-size: 16px; font-weight: 700; }
    </style>
</head>
<body>
    <h1>Dashboard Summary</h1>
    @if($company)
        <div class="meta">{{ $company->company_name }}</div>
    @endif
    <div class="meta">Period: {{ $from->format('d M Y') }} – {{ $to->format('d M Y') }}</div>
    <div class="meta">Generated: {{ now()->format('d M Y H:i') }}</div>

    <div class="kpis">
        <div class="kpi-row">
            <div class="kpi-cell">
                <div class="kpi-label">Total Invoices</div>
                <div class="kpi-value">{{ $totalInvoices }}</div>
            </div>
            <div class="kpi-cell">
                <div class="kpi-label">Total Revenue (AED)</div>
                <div class="kpi-value">{{ number_format($totalRevenue, 2) }}</div>
            </div>
            <div class="kpi-cell">
                <div class="kpi-label">VAT Collected (AED)</div>
                <div class="kpi-value">{{ number_format($vatCollected, 2) }}</div>
            </div>
            <div class="kpi-cell">
                <div class="kpi-label">Outstanding (AED)</div>
                <div class="kpi-value">{{ number_format($outstanding, 2) }}</div>
            </div>
        </div>
    </div>
</body>
</html>
