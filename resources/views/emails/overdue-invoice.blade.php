<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body { font-family: sans-serif; color: #334155; line-height: 1.6; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .card { background: #f8fafc; border-radius: 12px; padding: 24px; margin: 20px 0; }
        .amount { font-size: 24px; font-weight: 700; color: #0f172a; }
        .btn { display: inline-block; background: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 600; margin-top: 16px; }
        .muted { color: #64748b; font-size: 14px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Overdue Invoice Reminder</h1>
        <p>Invoice <strong>{{ $invoice->invoice_number }}</strong> for {{ $invoice->customer->name }} is overdue.</p>
        <div class="card">
            <div class="muted">Outstanding amount</div>
            <div class="amount">{{ number_format($invoice->outstandingAmount(), 2) }} AED</div>
            <p>Due date: {{ $invoice->invoice_date?->format('d M Y') }}</p>
            <a href="{{ url('/invoices/' . $invoice->id) }}" class="btn">View Invoice</a>
        </div>
    </div>
</body>
</html>
