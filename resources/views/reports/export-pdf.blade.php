<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body { font-family: DejaVu Sans, sans-serif; font-size: 11px; color: #0f172a; }
        h1 { font-size: 18px; margin-bottom: 8px; }
        table { width: 100%; border-collapse: collapse; margin-top: 16px; }
        th, td { border: 1px solid #e2e8f0; padding: 8px; text-align: left; }
        th { background: #f8fafc; font-weight: 700; }
        .summary { margin: 20px 0; }
        .summary-item { padding: 8px 0; border-bottom: 1px solid #f1f5f9; }
    </style>
</head>
<body>
    <h1>Customer Report: {{ $customer->name }}</h1>
    <div class="summary">
        <div class="summary-item"><strong>Total Invoices:</strong> {{ $summary->total_invoices }}</div>
        <div class="summary-item"><strong>Total Billed (AED):</strong> {{ number_format($summary->total_billed, 2) }}</div>
        <div class="summary-item"><strong>Tax Collected (AED):</strong> {{ number_format($summary->total_tax_collected, 2) }}</div>
        <div class="summary-item"><strong>Outstanding (AED):</strong> {{ number_format($summary->outstanding, 2) }}</div>
    </div>
    <h2>Invoice Breakdown</h2>
    <table>
        <thead>
            <tr>
                <th>Invoice</th>
                <th>Date</th>
                <th>Services</th>
                <th>Taxable</th>
                <th>Non-Taxable</th>
                <th>VAT</th>
                <th>Total</th>
                <th>Status</th>
            </tr>
        </thead>
        <tbody>
            @foreach($invoiceBreakdown as $row)
            <tr>
                <td>{{ $row->invoice->invoice_number }}</td>
                <td>{{ $row->invoice->invoice_date?->format('d M Y') }}</td>
                <td>{{ $row->services_count }}</td>
                <td>{{ number_format((float) $row->invoice->subtotal_taxable, 2) }}</td>
                <td>{{ number_format((float) $row->invoice->subtotal_non_taxable, 2) }}</td>
                <td>{{ number_format((float) $row->invoice->vat_amount, 2) }}</td>
                <td>{{ number_format((float) $row->invoice->grand_total, 2) }}</td>
                <td>{{ ucfirst(str_replace('_', ' ', $row->payment_status)) }}</td>
            </tr>
            @endforeach
        </tbody>
    </table>
</body>
</html>
